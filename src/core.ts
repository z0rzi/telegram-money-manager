import { Context, Markup, Telegraf } from "telegraf";
import { ReplyKeyboardMarkup } from "typegram";
import DB from "./db";

export type Ctx = Context;
export type Accumulator = Record<string, string> & {
  ctx: Ctx;
  command: string;
  db: DB;
};
export type ThenCb<Mtype = string> = (
  acc: Accumulator,
  message: Mtype
) => Promise<void | boolean> | void | boolean;

let listener = null as null | ((ctx: Ctx, message: string) => void);

const textCommands = new Map<string, (ctx: Ctx) => void>();
const rxCommands = new Map<RegExp, (ctx: Ctx) => void>();

let commandDefinitions: {
  command: string;
  description: string;
  important: boolean;
}[] = [];

const token = process.env.BOT_TOKEN || "";

const bot = new Telegraf(token);

bot.use(Telegraf.log());

bot.command("start", async (ctx) => {
  await ctx.reply(
    "To get started, use the following commands:\n\n- /set_user\n- /add_account\n- /add_category\n- /add_budget (optional)\n\nOnce you're done with that, you can add an expense by simply typing the amount."
  );
});

bot.hears(/^.+$/, (ctx, next) => {
  const message = ctx.message.text.replace(/@[a-z_]+$/, "");
  if (textCommands.has(message)) {
    textCommands.get(message)!(ctx);
    return;
  }

  if (listener) {
    listener(ctx, message);
    return;
  }

  for (const [command, cb] of rxCommands) {
    if (command.test(message)) {
      cb(ctx);
      return;
    }
  }

  if (message.startsWith("/")) {
    next();
    return;
  }

  next();
});

bot.hears(/.*/, async (ctx) => {
  let reply = "Unknown command.\n\nUse /help to find the command you need.";

  await ctx.reply(reply);
});

class Subject<T> {
  private _value: T;
  private _subscribers: ((value: T) => void)[] = [];

  constructor(value?: T) {
    if (value != null) this._value = value;
  }

  get value() {
    return this._value;
  }

  get subscribersCount() {
    return this._subscribers.length;
  }

  subscribe(subscriber: (value: T) => void) {
    this._subscribers.push(subscriber);
  }

  unsubscribe(subscriber: (value: T) => void) {
    this._subscribers = this._subscribers.filter((s) => s !== subscriber);
  }

  next(value: T) {
    this._value = value;
    this._subscribers.forEach((s) => s(value));
  }

  destroy() {
    this._subscribers = [];
  }
}

async function getMainOptionsKeyboard(chatId: number) {
  const currentDb = DB.getDbForChat(chatId);

  let options = [] as string[];

  if (!currentDb) {
    options = ["/set_user"];
  } else {
    const hasAccounts = currentDb.getAccounts().length > 0;
    const hasCategories = currentDb.getCategories().length > 0;

    if (!hasAccounts || !hasCategories) {
      options = ["/add_account", "/add_category"];
    }
  }

  if (!options.length) {
    options = commandDefinitions
      .filter((c) => c.important)
      .map((c) => c.command);
  }

  return Markup.keyboard(options, { columns: 2 }).resize();
}

/**
 * A generic function to handle one element of the interaction chain.
 * When the user answers, this function will be called to determine wheat we do next.
 *
 * @param acc The accumulator object, the user can store stuff in there
 * @param previousSubject The subject of the previous element in the chain
 * @param prompt The prompt to show to the user (cannot be empty)
 * @param callback The callback to call when the user answers
 * @param keyboardGetter A function that returns the keyboard to show to the user
 * @param answerParser A function that parses the answer from the user
 * @param skipElementTester A function that determines if the current element should be skipped
 */
function handleChain<T>(
  acc: Accumulator,
  previousSubject: Subject<void>,
  prompt: string | ((acc: Accumulator) => string),
  callback: ThenCb<T>,
  keyboardGetter?: () => null | Markup.Markup<ReplyKeyboardMarkup>,
  answerParser?: (
    acc: Accumulator,
    message: string
  ) => Promise<null | T> | null | T,
  skipElementTester?: (
    acc: Accumulator,
    message: string
  ) => Promise<null | T> | null | T
) {
  /**
   * The subject corresponding to the current element in the chain.
   * When this subject is resolved, the next element in the chain will be called.
   */
  const newSubject = new Subject<void>();

  previousSubject.subscribe(async () => {
    const keyboard = keyboardGetter && keyboardGetter();

    if (prompt instanceof Function) {
      prompt = prompt(acc);
    }

    await acc.ctx.sendMessage(prompt, keyboard ?? Markup.removeKeyboard());

    // Do we skip this element?
    const shortcutResult =
      (skipElementTester && (await skipElementTester(acc, prompt))) || null;
    if (shortcutResult != null) {
      // Yes, we do skip this element.
      callback(acc, shortcutResult);
      newSubject.next();
      return;
    }

    // We don't skip this element, so we wait for the user to answer.
    listener = async (ctx: Ctx, message: string) => {
      if (!acc.ctx) acc.ctx = ctx;
      listener = null;

      let cbRes: boolean | void | null = null;
      if (callback) {
        let actualMessage = message as T;
        if (answerParser) {
          const parsedMessage = answerParser(acc, message);
          if (!parsedMessage) {
            ctx.reply("Invalid answer.");
            return;
          }
          actualMessage = parsedMessage as T;
        }

        cbRes = await callback(acc, actualMessage);
      }

      if (!newSubject.subscribersCount || cbRes === false) {
        // This is the last element in the chain, we restore the keyboard to the default one
        acc.ctx.sendMessage(
          "All done",
          await getMainOptionsKeyboard(acc.ctx!.chat!.id)
        );
      } else {
        newSubject.next();
      }
    };
  });

  return afterCommand(acc, newSubject);
}

function afterCommand(acc: Accumulator, _before: Subject<void>) {
  return {
    text: (prompt: string | ((acc: Accumulator) => string), callback: ThenCb) =>
      handleChain(acc, _before, prompt, callback),

    confirm: (
      prompt: string | ((acc: Accumulator) => string),
      callback: ThenCb<boolean>
    ) =>
      handleChain(
        acc,
        _before,
        prompt,
        callback,
        () => Markup.keyboard(["Yes", "No"], { columns: 2 }).oneTime().resize(),
        (_0, message) => message === "Yes"
      ),

    choice: (
      prompt: string | ((acc: Accumulator) => string),
      choicesGetter: (acc: Accumulator) => { label: string; payload: string }[],
      callback: ThenCb<string>,
      colsAmount = 1
    ) => {
      let choices: { label: string; payload: string }[] = [];

      return handleChain(
        acc,
        _before,
        prompt,
        callback,
        () => {
          choices = choicesGetter(acc);

          if (choices.length <= 1) return null;

          return Markup.keyboard(
            choices.map((c) => c.label),
            { columns: colsAmount }
          )
            .oneTime()
            .resize();
        },
        (_, message) => {
          const selectedChoice = choices.find(
            (choice) => choice.label === message
          );
          if (!selectedChoice) return null;

          return selectedChoice!.payload;
        },
        async (acc) => {
          if (choices.length === 1) {
            await acc.ctx.reply(
              "Only one available option.\n" + choices[0].label + " selected."
            );
            return choices[0].payload;
          }

          return null;
        }
      );
    },

    tap: (callback: ThenCb<void>) => {
      const newSubject = new Subject<void>();
      _before.subscribe(async () => {
        const res = callback(acc);
        if (!newSubject.subscribersCount || res === false) {
          // This is the last element in the chain, we restore the keyboard to the default one
          acc.ctx.sendMessage(
            "All done",
            await getMainOptionsKeyboard(acc.ctx!.chat!.id)
          );
          newSubject.destroy();
        } else {
          newSubject.next();
        }
      });

      return afterCommand(acc, newSubject);
    },

    /**
     * Stops the chain if an error is thrown.
     */
    checkError: (callback: ThenCb<void>) => {
      const newSubject = new Subject<void>();
      _before.subscribe(async () => {
        let res: boolean | void;

        try {
          res = await callback(acc);
        } catch (e) {
          await acc.ctx.reply(e.message);
          return;
        }

        if (!newSubject.subscribersCount || res === false) {
          // This is the last element in the chain, we restore the keyboard to the default one
          acc.ctx.sendMessage(
            "All done",
            await getMainOptionsKeyboard(acc.ctx!.chat!.id)
          );
          newSubject.destroy();
        } else {
          newSubject.next();
        }
      });

      return afterCommand(acc, newSubject);
    },
  };
}

export function onCommand(
  command: string | RegExp,
  description: string,
  important = false
) {
  const acc = {} as Accumulator;

  const subject = new Subject<void>();

  const cb = async (ctx: Ctx) => {
    // Getting the chat id
    const chatId = ctx?.chat?.id;
    if (!chatId) return;

    const db = DB.getDbForChat(chatId);

    if (!db && command !== "/set_user") {
      await ctx.reply(
        "I have no registered user yet for this conversation.\nYou can set the user with /set_user."
      );
      return;
    }

    acc.ctx = ctx;
    acc.command = ctx?.message?.["text"] || "";
    acc.db = db!;
    subject.next();
  };
  if (typeof command === "string") {
    commandDefinitions.push({ command, description, important });
    textCommands.set(command, cb);
  } else {
    commandDefinitions.push({
      command: String(command),
      description,
      important,
    });
    rxCommands.set(command, cb);
  }

  return afterCommand(acc, subject);
}

bot.launch();
