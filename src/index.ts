import * as dotenv from "dotenv";
dotenv.config();

import * as db from "./db";
import { Telegraf, Context, Markup } from "telegraf";

const MONTHS_TO_SHOW = 3;

const token = process.env.BOT_TOKEN || "";

const bot = new Telegraf(token);

type Ctx = Context;

bot.use(Telegraf.log());

class Subject<T> {
  private _value: T;
  private _subscribers: ((value: T) => void)[] = [];

  constructor(value?: T) {
    if (value != null) this._value = value;
  }

  get value() {
    return this._value;
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

let listener = null as null | ((ctx: Ctx, message: string) => void);

bot.command("help", (ctx) => {
  ctx.reply(
    "Available commands:\n\n" + allCommands.map((c) => c.command).join("\n")
  );
});

bot.hears(/^.+$/, (ctx, next) => {
  const message = ctx.message.text;
  if (commands.has(message)) {
    commands.get(message)!(ctx);
    return;
  }

  if (message.startsWith("/")) {
    next();
    return;
  }

  if (listener) {
    listener(ctx, message);
    return;
  }

  next();
});

bot.hears(/.*/, (ctx) => {
  let reply = "Unknown command.\n\nAvailable commands are:\n\n";
  allCommands.forEach((c) => (reply += `${c.command}\n  ${c.description}\n\n`));
  ctx.replyWithMarkdownV2(reply.replace(/[\.\-_]/g, "\\$&"));
});

type ThenCb<Mtype = string> = (
  acc: Record<string, string> & { ctx?: Ctx },
  ctx: Ctx,
  message: Mtype
) => void | boolean;

const commands = new Map<string, (ctx: Ctx) => void>();

function afterCommand(
  acc: Record<string, string> & { ctx: Ctx },
  _before: Subject<void>
) {
  return {
    text: (prompt: string, callback: ThenCb) => {
      const newSubject = new Subject<void>();
      _before.subscribe(() => {
        if (prompt) acc.ctx.reply(prompt);

        listener = async (ctx: Ctx, message: string) => {
          if (!acc.ctx) acc.ctx = ctx;

          listener = null;
          if (callback) {
            const res = callback(acc, ctx, message);
            if (res === false) return;
          }
          newSubject.next();
        };
      });

      return afterCommand(acc, newSubject);
    },
    confirm: (prompt: string, callback: ThenCb<boolean>) => {
      const newSubject = new Subject<void>();

      _before.subscribe(() => {
        acc.ctx.reply(
          prompt,
          Markup.keyboard(["Yes", "No"]).oneTime().resize()
        );

        listener = async (ctx: Ctx, message: string) => {
          Markup.removeKeyboard();
          if (!acc.ctx) acc.ctx = ctx;

          listener = null;
          if (callback) {
            const res = callback(acc, acc.ctx, message === "Yes");
            if (res === false) return;
          }
          newSubject.next();
        };
      });

      return afterCommand(acc, newSubject);
    },
    choice: (
      prompt: string,
      choicesGetter: () => { label: string; payload: string }[],
      callback: ThenCb<string>,
      colsAmount = 1
    ) => {
      const newSubject = new Subject<void>();

      _before.subscribe(() => {
        const choices = choicesGetter();
        acc.ctx.reply(
          prompt,
          Markup.keyboard(
            choices.map((choice) => choice.label),
            { columns: colsAmount }
          )
            .oneTime()
            .resize()
        );

        listener = async (ctx: Ctx, message: string) => {
          Markup.removeKeyboard();
          if (!acc.ctx) acc.ctx = ctx;

          const selectedChoice = choices.find(
            (choice) => choice.label === message
          );

          listener = null;
          if (callback) {
            const res = callback(acc, acc.ctx, selectedChoice!.payload);
            if (res === false) return;
          }
          newSubject.next();
        };
      });

      return afterCommand(acc, newSubject);
    },
    tap: (callback: ThenCb<void>) => {
      const newSubject = new Subject<void>();
      _before.subscribe(() => {
        const res = callback(acc, acc.ctx!);
        if (res === false) return;
        newSubject.next();
      });

      return afterCommand(acc, newSubject);
    },
  };
}

let allCommands: { command: string; description: string }[] = [];

function onCommand(command: string, description: string) {
  allCommands.push({ command, description });
  const acc = {} as Record<string, string> & { ctx?: Ctx };

  const subject = new Subject<void>();

  const cb = (ctx: Ctx) => {
    acc.ctx = ctx;
    subject.next();
  };
  commands.set(command, cb);

  return afterCommand(acc as Record<string, string> & { ctx: Ctx }, subject);
}

onCommand("/add_account", "Adds a new bank account")
  .text("Icon of the account?", (acc, ctx, message) => {
    acc.icon = message;
  })
  .text("Title of the account?", (acc, ctx, message) => {
    const title = message;

    acc.title = title;

    ctx.reply(acc.icon + " " + title);
  })
  .confirm("Are you sure?", (acc, ctx, ok) => {
    if (ok) {
      db.addAccount(acc.icon, acc.title);
      ctx.reply(acc.icon + " " + acc.title + " added.");
    } else {
      ctx.reply("Cancelled.");
      return false;
    }
  });

onCommand("/get_accounts", "Lists the accounts").tap((acc, ctx) => {
  ctx.reply(
    db
      .getAccounts()
      .map((a) => a.icon + " " + a.name)
      .join("\n") || "No accounts yet...\nUse /add_account to add one."
  );
});

onCommand("/add_category", "Adds a new expense category")
  .text("Icon of the category?", (acc, ctx, message) => {
    acc.icon = message;
  })
  .text("Title of the category?", (acc, ctx, message) => {
    const title = message;

    acc.title = title;

    ctx.reply(acc.icon + " " + title);
  })
  .confirm("Are you sure?", (acc, ctx, ok) => {
    if (ok) {
      db.addCategory(acc.icon, acc.title);
      ctx.reply(acc.icon + " " + acc.title + " added.");
    } else {
      ctx.reply("Cancelled.");
      return false;
    }
  });

onCommand("/get_categories", "Lists all the expense categories").tap(
  (acc, ctx) => {
    ctx.reply(
      db
        .getCategories()
        .map((a) => a.icon + " " + a.name)
        .join("\n") || "No categories yet...\nUse /add_category to add one."
    );
  }
);

onCommand("/add_expense", "Spend money")
  .tap((acc, ctx) => {
    // Making sure that we have accounts and categories
    const accounts = db.getAccounts();
    if (!accounts.length) {
      ctx.reply("No accounts yet...\nUse /add_account to add one.");
      return false;
    }

    const categories = db.getCategories();
    if (!categories.length) {
      ctx.reply("No categories yet...\nUse /add_category to add one.");
      return false;
    }
  })
  .choice(
    "Which account?",
    () =>
      db.getAccounts().map((a) => ({
        label: `${a.icon} ${a.name}`,
        payload: a.id.toString(),
      })),
    (acc, ctx, message) => {
      acc.account_id = message;
    },
    2
  )
  .choice(
    "Which category?",
    () =>
      db.getCategories().map((a) => ({
        label: `${a.icon} ${a.name}`,
        payload: a.id.toString(),
      })),
    (acc, ctx, message) => {
      acc.category_id = message;
    },
    2
  )
  .text("How much did you spend?", (acc, ctx, message) => {
    const amount = +message;

    if (isNaN(amount)) {
      ctx.reply("Cancelled - please enter a number next time.");
      return false;
    }

    acc.amount = String(amount);
  })
  .text("Title?", (acc, ctx, message) => {
    acc.title = message;
  })
  .tap((acc, ctx) => {
    const budgets = db.getBudgets();
    const budget = budgets.find((b) => b.category_id === +acc.category_id);

    db.addExpense(
      +acc.account_id,
      +acc.category_id,
      +acc.amount,
      Date.now(),
      acc.title
    );

    ctx.reply("Expense added.");

    if (budget) {
      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);

      const expenses = db.getExpenses(+startOfMonth);

      const categories = db.getCategories();
      const category = categories.find((c) => c.id === +acc.category_id)!;

      const totalForCategory = expenses.reduce(
        (acc, cur) =>
          cur.category_id === category.id ? acc + cur.amount : acc,
        0
      );

      const percentage = totalForCategory / budget.value;

      ctx.reply(
        `You've spent ${totalForCategory}€ in ${
          category.name
        } for this month, which is ${(percentage * 100).toFixed(
          2
        )}% of your monthly budget.`
      );
    }
  });

onCommand("/set_budget", "Set a monthly budget on a category")
  .tap((acc, ctx) => {
    // Making sure that we have categories
    const categories = db.getCategories();
    if (!categories.length) {
      ctx.reply("No categories yet...\nUse /add_category to add one.");
      return false;
    }
  })
  .choice(
    "Which category?",
    () =>
      db.getCategories().map((a) => ({
        label: `${a.icon} ${a.name}`,
        payload: a.id.toString(),
      })),
    (acc, ctx, message) => {
      acc.category_id = message;
    },
    2
  )
  .text("How much can you spend per month?", (acc, ctx, message) => {
    const amount = +message;

    if (isNaN(amount)) {
      ctx.reply("Cancelled - please enter a number next time.");
      return false;
    }

    acc.amount = String(amount);

    db.addBudget(+acc.amount, +acc.category_id);

    ctx.reply("Budget set.");
  });

onCommand("/get_budgets", "Lists the budgets for each category").tap(
  (acc, ctx) => {
    const budgets = db.getBudgets();
    const categories = db.getCategories();

    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const expenses = db.getExpenses(+startOfMonth);
    const expenseByCategory = new Map<number, number>();

    for (const category of categories) {
      const categoryExpenses = expenses.filter(
        (e) => e.category_id === category.id
      );
      const totalForCategory = categoryExpenses.reduce(
        (acc, cur) => acc + cur.amount,
        0
      );
      expenseByCategory.set(category.id, totalForCategory);
    }

    ctx.reply(
      budgets
        .map((b) => {
          const category = categories.find((c) => c.id === b.category_id)!;
          const totalForCategory = expenseByCategory.get(b.category_id)!;
          const percentage = totalForCategory / b.value;

          return (
            b.value +
            "€ - " +
            category.icon +
            " " +
            category.name +
            "\n" +
            `    ${percentage * 100}% used for this month`
          );
        })
        .join("\n\n") || "No budgets yet...\nUse /set_budget to add one."
    );
  }
);

function escapeMd(text: string) {
  return text.replace(/[\-\.\_]/g, "\\$&");
}

function formatExpense(expense: db.Expense) {
  const category = db
    .getCategories()
    .find((c) => c.id === expense.category_id)!;

  const date = new Date(expense.date);
  const strDate = date.toISOString().split("T")[0];

  return `${strDate} ${category.icon} ${expense.description} ${expense.amount}€`;
}

onCommand("/get_last_expenses", "Get the last 100 expenses").tap((acc, ctx) => {
  const allExpenses = db.getExpenses();

  const expenses = allExpenses.slice(0, 100);

  let answer = "";

  for (const expense of expenses) {
    answer += escapeMd(formatExpense(expense)) + "\n";
  }

  answer = answer.trim();

  ctx.replyWithMarkdownV2(answer);
});

onCommand("/remove_expense", "Remove an expense").choice(
  "Which expense?",
  () => {
    const allExpenses = db.getExpenses();

    const choices = allExpenses.map((e) => ({
      label: formatExpense(e),
      payload: e.id.toString(),
    }));

    return choices;
  },
  (acc, ctx, message) => {
    const expenseId = +message;

    db.removeExpense(expenseId);

    ctx.reply("Expense removed.");
  }
);

onCommand("/change_expense_date", "Change the date of an expense")
  .choice(
    "Which expense?",
    () => {
      const allExpenses = db.getExpenses();

      const choices = allExpenses.map((e) => ({
        label: formatExpense(e),
        payload: e.id.toString(),
      }));

      return choices;
    },
    (acc, ctx, message) => {
      acc.expense_id = message;
    }
  )
  .choice(
    "Which year?",
    () => {
      const now = new Date();
      return [
        {
          label: "Last year",
          payload: (now.getFullYear() - 1).toString(),
        },
        {
          label: "This year",
          payload: now.getFullYear().toString(),
        },
      ];
    },
    (acc, ctx, message) => {
      acc.year = message;
    },
    2
  )
  .choice(
    "Which month?",
    () => {
      const options = [] as { label: string; payload: string }[];
      for (let i = 0; i < 12; i++) {
        options.push({
          label: new Date(2021, i, 1).toLocaleString("default", {
            month: "long",
          }),
          payload: i.toString(),
        });
      }

      return options;
    },
    (acc, ctx, message) => {
      acc.month = message;
    },
    3
  )
  .choice(
    "Which day?",
    () => {
      const options = [] as { label: string; payload: string }[];
      for (let i = 0; i < 31; i++) {
        options.push({
          label: String(i + 1),
          payload: String(i + 1),
        });
      }

      return options;
    },
    (acc, ctx, message) => {
      acc.day = message;
    },
    3
  )
  .tap((acc, ctx) => {
    const expenseId = +acc.expense_id;
    const year = +acc.year;
    const month = +acc.month;
    const day = +acc.day;

    const date = Date.UTC(year, month, day);

    db.changeExpenseDate(expenseId, +date);

    ctx.reply("Expense date changed.");
  });

onCommand("/get_biggest_expenses", "Get biggest expenses for each month").tap(
  (acc, ctx) => {
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - MONTHS_TO_SHOW, 1);
    startDate.setHours(0, 0, 0, 0);

    // const categories =

    const allExpenses = db.getExpenses(+startDate);

    let answer = "";

    let dateBefore = new Date(startDate);
    let dateAfter = new Date(startDate);
    dateAfter.setMonth(dateAfter.getMonth() + 1);
    while (+dateBefore < Date.now()) {
      const expenses = allExpenses.filter(
        (e) => +e.date >= +dateBefore && +e.date < +dateAfter
      );

      expenses.sort((a, b) => b.amount - a.amount);

      const monthName = dateBefore.toLocaleString("default", { month: "long" });

      answer += `__${monthName}__ :\n`;
      for (const expense of expenses) {
        answer += escapeMd(formatExpense(expense)) + "\n";
      }
      answer += "\n";

      dateBefore.setMonth(dateBefore.getMonth() + 1);
      dateAfter.setMonth(dateAfter.getMonth() + 1);
    }

    answer = answer.trim();

    ctx.replyWithMarkdownV2(answer);
  }
);

onCommand("/get_expenses_by_category", "Get expenses by category").tap(
  (acc, ctx) => {
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - MONTHS_TO_SHOW, 1);
    startDate.setHours(0, 0, 0, 0);

    const allExpenses = db.getExpenses(+startDate);

    let answer = "";

    let dateBefore = new Date(startDate);
    let dateAfter = new Date(startDate);
    dateAfter.setMonth(dateAfter.getMonth() + 1);

    const categories = db.getCategories();

    while (+dateBefore < Date.now()) {
      const monthExpenses = allExpenses.filter(
        (e) => +e.date >= +dateBefore && +e.date < +dateAfter
      );

      monthExpenses.sort((a, b) => b.amount - a.amount);

      const monthName = dateBefore.toLocaleString("default", { month: "long" });

      answer += `__${monthName}__ :\n`;
      for (const category of categories) {
        const categoryExpenses = monthExpenses.filter(
          (e) => e.category_id === category.id
        );

        const totalForCategory = categoryExpenses.reduce(
          (acc, cur) => acc + cur.amount,
          0
        );

        if (totalForCategory > 0) {
          answer += `${category.icon} ${category.name} : ${totalForCategory}€\n`;
        }
      }
      answer += "\n";

      dateBefore.setMonth(dateBefore.getMonth() + 1);
      dateAfter.setMonth(dateAfter.getMonth() + 1);
    }

    answer = answer.trim();

    ctx.replyWithMarkdownV2(answer);
  }
);

bot.launch();
