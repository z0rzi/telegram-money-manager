import * as dotenv from "dotenv";
dotenv.config();

import * as db from "./db";
import { onCommand } from "./core";
import { escapeMd, formatNum } from "./utils";
import { formatExpense } from "./utils";

const MONTHS_TO_SHOW = 3;

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

onCommand("/remove_account", "Removes an account", false)
  .choice(
    "Which account?",
    () => {
      const accounts = db.getAccounts();

      const choices = accounts.map((a) => ({
        label: `${a.icon} ${a.name}`,
        payload: a.id.toString(),
      }));

      return choices;
    },
    (acc, ctx, message) => {
      acc.account_id = message;
    },
    2
  )
  .confirm(
    "Are you sure? All the expenses related to this account will be removed forever.",
    (acc, ctx, ok) => {
      if (ok) {
        db.removeAccount(+acc.account_id);
        ctx.reply("Account removed.");
      } else {
        ctx.reply("Cancelled.");
        return false;
      }
    }
  );

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

onCommand("/add_expense", "Spend money", true)
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
        `You've spent ${formatNum(totalForCategory, true)} in ${
          category.name
        } for this month, which is ${formatNum(
          percentage * 100
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

onCommand("/get_budgets", "Lists the budgets for each category", true).tap(
  (acc, ctx) => {
    const consumptions = db.calculateBudgetConsumption();
    const categories = db.getCategories();

    let answer = "";

    for (const [categoryId, consumption] of consumptions) {
      const category = categories.find((c) => c.id === categoryId)!;
      const totalForCategory = consumption.consumption;
      const percentage = totalForCategory / consumption.budget;

      answer += `${formatNum(consumption.budget, true)} - ${category.icon} ${
        category.name
      }\n`;
      answer += `    ${formatNum(
        percentage * 100
      )}% used for this month (${formatNum(
        consumption.consumption,
        true
      )})\n\n`;
    }

    ctx.reply(answer);
  }
);

onCommand("/get_last_expenses", "Get the last 100 expenses").tap((acc, ctx) => {
  const allExpenses = db.getExpenses();

  const expenses = allExpenses.slice(0, 100);

  let answer = "";

  const categories = db.getCategories();

  for (const expense of expenses) {
    answer += escapeMd(formatExpense(expense, categories)) + "\n";
  }

  answer = answer.trim();

  ctx.replyWithMarkdownV2(answer);
});

onCommand("/remove_expense", "Remove an expense", true).choice(
  "Which expense?",
  () => {
    const allExpenses = db.getExpenses();

    const categories = db.getCategories();
    const choices = allExpenses.map((e) => ({
      label: formatExpense(e, categories),
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
      const categories = db.getCategories();

      const choices = allExpenses.map((e) => ({
        label: formatExpense(e, categories),
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

onCommand(
  "/get_biggest_expenses",
  "Get biggest expenses for each month",
  true
).tap((acc, ctx) => {
  const startDate = new Date();
  startDate.setMonth(startDate.getMonth() - MONTHS_TO_SHOW, 1);
  startDate.setHours(0, 0, 0, 0);

  const categories = db.getCategories();

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
      answer += escapeMd(formatExpense(expense, categories)) + "\n";
    }
    answer += "\n";

    dateBefore.setMonth(dateBefore.getMonth() + 1);
    dateAfter.setMonth(dateAfter.getMonth() + 1);
  }

  answer = answer.trim();

  ctx.replyWithMarkdownV2(answer);
});

onCommand("/get_expenses_by_category", "Get expenses by category", true).tap(
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
          answer += `${category.icon} ${category.name} : ${formatNum(
            totalForCategory,
            true
          )}\n`;
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

onCommand(/^[0-9\.]+$/, "Add an expense")
  .choice(
    "Adding an expense.\nWhich account?",
    () => {
      const accounts = db.getAccounts();

      const choices = accounts.map((a) => ({
        label: `${a.icon} ${a.name}`,
        payload: a.id.toString(),
      }));

      return choices;
    },
    (acc, ctx, message) => {
      acc.account_id = message;
    },
    2
  )
  .choice(
    "Which category?",
    () => {
      const categories = db.getCategories();

      const choices = categories.map((c) => ({
        label: `${c.icon} ${c.name}`,
        payload: c.id.toString(),
      }));

      return choices;
    },
    (acc, ctx, message) => {
      acc.category_id = message;
    },
    2
  )
  .text("Title?", (acc, ctx, message) => {
    acc.title = message;
  })
  .tap((acc, ctx) => {
    db.addExpense(
      +acc.account_id,
      +acc.category_id,
      +acc.command,
      Date.now(),
      acc.title
    );

    ctx.reply("Expense added.");

    const consumption = db.calculateBudgetConsumption();

    const catId = +acc.category_id;

    if (consumption.has(catId)) {
      const categories = db.getCategories();
      const category = categories.find((c) => c.id === catId)!;

      const totalForCategory = consumption.get(catId)!.consumption;
      const budget = consumption.get(catId)!.budget;

      const percentage = totalForCategory / budget;

      ctx.reply(
        `You've spent ${formatNum(totalForCategory, true)} in ${
          category.name
        } for this month, which is ${formatNum(
          percentage * 100
        )}% of your monthly budget.`
      );
    }
  });
