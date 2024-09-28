import { Context, Markup, Telegraf } from "telegraf";
import { ReplyKeyboardMarkup } from "typegram";

type Ctx = Context;
type Accumulator = Record<string, string> & { ctx: Ctx; command: string };
type ThenCb<Mtype = string> = (
  acc: Accumulator,
  ctx: Ctx,
  message: Mtype
) => void | boolean;

let listener = null as null | ((ctx: Ctx, message: string) => void);

const textCommands = new Map<string, (ctx: Ctx) => void>();
const rxCommands = new Map<RegExp, (ctx: Ctx) => void>();

let commandDefinitions: {
  command: string;
  description: string;
  important: boolean;
}[] = [
  {
    command: "/help",
    description: "Shows this help",
    important: true,
  },
];

const token = process.env.BOT_TOKEN || "";

const bot = new Telegraf(token);

bot.use(Telegraf.log());

bot.command("help", (ctx) => {
  ctx.reply(
    "Available commands:\n\n" +
      commandDefinitions.map((c) => c.command).join("\n")
  );
});

bot.hears(/^.+$/, (ctx, next) => {
  const message = ctx.message.text;
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

bot.hears(/.*/, (ctx) => {
  let reply = "Unknown command.\n\nThe main commands are:\n\n";
  commandDefinitions
    .filter((c) => c.important)
    .forEach((c) => (reply += `${c.command}\n  ${c.description}\n\n`));

  ctx.reply(reply);
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
}

function getMainOptionsKeyboard() {
  return Markup.keyboard(
    [...commandDefinitions.filter((c) => c.important).map((c) => c.command)],
    { columns: 2 }
  )
    .resize()
    .selective();
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
  prompt: string,
  callback: ThenCb<T>,
  keyboardGetter?: () => null | Markup.Markup<ReplyKeyboardMarkup>,
  answerParser?: (acc: Accumulator, ctx: Ctx, message: string) => null | T,
  skipElementTester?: (acc: Accumulator, ctx: Ctx, message: string) => null | T
) {
  /**
   * The subject corresponding to the current element in the chain.
   * When this subject is resolved, the next element in the chain will be called.
   */
  const newSubject = new Subject<void>();

  previousSubject.subscribe(() => {
    const keyboard = keyboardGetter && keyboardGetter();
    acc.ctx.reply(prompt, keyboard ?? undefined);

    // Do we skip this element?
    const shortcutResult =
      (skipElementTester && skipElementTester(acc, acc.ctx!, prompt)) || null;
    if (shortcutResult != null) {
      // Yes, we do skip this element.
      callback(acc, acc.ctx!, shortcutResult);
      newSubject.next();
      return;
    }

    // We don't skip this element, so we wait for the user to answer.
    listener = async (ctx: Ctx, message: string) => {
      if (!acc.ctx) acc.ctx = ctx;
      listener = null;

      if (callback) {
        let actualMessage = message as T;
        if (answerParser) {
          const parsedMessage = answerParser(acc, ctx, message);
          if (!parsedMessage) {
            ctx.reply("Invalid answer.");
            return;
          }
          actualMessage = parsedMessage as T;
        }

        const res = callback(acc, ctx, actualMessage);

        if (res === false) return;
      }

      if (!newSubject.subscribersCount) {
        // This is the last element in the chain, we restore the keyboard to the default one
        acc.ctx.sendMessage("All done", getMainOptionsKeyboard());
      } else {
        newSubject.next();
      }
    };
  });

  return afterCommand(acc, newSubject);
}

function afterCommand(acc: Accumulator, _before: Subject<void>) {
  return {
    text: (prompt: string, callback: ThenCb) =>
      handleChain(acc, _before, prompt, callback),

    confirm: (prompt: string, callback: ThenCb<boolean>) =>
      handleChain(
        acc,
        _before,
        prompt,
        callback,
        () => Markup.keyboard(["Yes", "No"], { columns: 2 }).oneTime().resize(),
        (_0, _1, message) => message === "Yes"
      ),

    choice: (
      prompt: string,
      choicesGetter: () => { label: string; payload: string }[],
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
          choices = choicesGetter();

          if (choices.length <= 1) return null;

          return Markup.keyboard(
            choices.map((c) => c.label),
            { columns: colsAmount }
          )
            .oneTime()
            .resize();
        },
        (acc, ctx, message) => {
          const selectedChoice = choices.find(
            (choice) => choice.label === message
          );
          if (!selectedChoice) return null;

          return selectedChoice!.payload;
        },
        (acc, ctx) => {
          if (choices.length === 1) {
            ctx.reply(choices[0].label + " selected.");
            return choices[0].payload;
          }

          return null;
        }
      );
    },

    tap: (callback: ThenCb<void>) => {
      const newSubject = new Subject<void>();
      _before.subscribe(() => {
        const res = callback(acc, acc.ctx!);
        if (res === false) return;
        if (!newSubject.subscribersCount) {
          // This is the last element in the chain, we restore the keyboard to the default one
          acc.ctx.sendMessage("All done", getMainOptionsKeyboard());
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

  const cb = (ctx: Ctx) => {
    acc.ctx = ctx;
    acc.command = ctx?.message?.["text"] || "";
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
