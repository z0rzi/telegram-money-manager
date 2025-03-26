import * as dotenv from "dotenv";
dotenv.config();

import { onCommand } from "./core";
import DB from "./db";
import { askAi } from "./ai";
import { escapeMd, formatExpense, formatNum } from "./utils";

const MONTHS_TO_SHOW = 3;

function checkCategoriesExist(db: DB) {
  const categories = db.getCategories();
  if (!categories.length) {
    throw new Error("No categories yet...\nUse /add_category to add one.");
  }
}

function checkAccountsExist(db: DB) {
  const accounts = db.getAccounts();
  if (!accounts.length) {
    throw new Error("No accounts yet...\nUse /add_account to add one.");
  }
}

function createPercentBar(percent: number) {
  const barLength = 22;
  const filledLength = Math.round(Math.min(percent, 1) * barLength);

  // const filledChar = "█";
  // const emptyChar = "░";
  const filledChar = "━";
  const emptyChar = "┈";

  let out = filledChar.repeat(filledLength);
  out += emptyChar.repeat(barLength - filledLength);

  if (percent > 1) {
    out = out.slice(0, -1) + '!!!'
  }

  return out;
}

onCommand("/add_account", "Adds a new bank account")
  .text("Icon of the account?", (acc, message) => {
    acc.icon = message;
  })
  .text("Title of the account?", async (acc, message) => {
    const title = message;

    acc.title = title;

    await acc.ctx.reply(acc.icon + " " + title);
  })
  .confirm("Are you sure?", async (acc, ok) => {
    if (ok) {
      acc.db.addAccount(acc.icon, acc.title);
      await acc.ctx.reply(acc.icon + " " + acc.title + " added.");
    } else {
      await acc.ctx.reply("Cancelled.");
      return false;
    }
  });

onCommand("/get_accounts", "Lists the accounts").tap(async (acc) => {
  await acc.ctx.reply(
    acc.db
      .getAccounts()
      .map((a) => a.icon + " " + a.name)
      .join("\n") || "No accounts yet...\nUse /add_account to add one."
  );
});

onCommand("/remove_account", "Removes an account", false)
  .checkError((acc) => {
    checkAccountsExist(acc.db);
  })
  .choice(
    "Which account?",
    (acc) => {
      const accounts = acc.db.getAccounts();

      const choices = accounts.map((a) => ({
        label: `${a.icon} ${a.name}`,
        payload: a.id.toString(),
      }));

      return choices;
    },
    (acc, message) => {
      acc.account_id = message;
    },
    2
  )
  .confirm(
    "Are you sure? All the expenses related to this account will be removed forever.",
    async (acc, ok) => {
      if (ok) {
        acc.db.removeAccount(+acc.account_id);
        await acc.ctx.reply("Account removed.");
      } else {
        await acc.ctx.reply("Cancelled.");
        return false;
      }
    }
  );

onCommand("/add_category", "Adds a new expense category")
  .text("Icon of the category?", (acc, message) => {
    acc.icon = message;
  })
  .text("Title of the category?", async (acc, message) => {
    const title = message;

    acc.title = title;

    await acc.ctx.reply(acc.icon + " " + title);
  })
  .confirm("Are you sure?", async (acc, ok) => {
    if (ok) {
      acc.db.addCategory(acc.icon, acc.title);
      await acc.ctx.reply(acc.icon + " " + acc.title + " added.");
    } else {
      await acc.ctx.reply("Cancelled.");
      return false;
    }
  });

onCommand("/get_categories", "Lists all the expense categories").tap(
  async (acc) => {
    await acc.ctx.reply(
      acc.db
        .getCategories()
        .map((a) => a.icon + " " + a.name)
        .join("\n") || "No categories yet...\nUse /add_category to add one."
    );
  }
);

onCommand("/remove_category", "Remove a category and all its expenses")
  .checkError((acc) => {
    checkCategoriesExist(acc.db);
  })
  .choice(
    "Which category?",
    (acc) =>
      acc.db.getCategories().map((a) => ({
        label: `${a.icon} ${a.name}`,
        payload: a.id.toString(),
      })),
    (acc, message) => {
      acc.category_id = message;
    },
    2
  )
  .confirm(
    "Are you sure? All expenses in this category will be removed forever.",
    async (acc, ok) => {
      if (ok) {
        const categoryId = +acc.category_id;
        // Remove all expenses for this category
        const expenses = acc.db.getExpenses().filter(e => e.category_id === categoryId);
        for (const expense of expenses) {
          acc.db.removeExpense(expense.id);
        }
        // Remove the category itself
        acc.db.removeCategory(categoryId);
        await acc.ctx.reply("Category and all its expenses removed.");
      } else {
        await acc.ctx.reply("Cancelled.");
        return false;
      }
    }
  );

onCommand("/change_category", "Change the name or icon of a category")
  .checkError((acc) => {
    checkCategoriesExist(acc.db);
  })
  .choice(
    "Which category?",
    (acc) => {
      const categories = acc.db.getCategories();

      const choices = categories.map((a) => ({
        label: `${a.icon} ${a.name}`,
        payload: a.id.toString(),
      }));

      return choices;
    },
    (acc, message) => {
      acc.category_id = message;
    },
    2
  )
  .choice(
    "What do you want to change?",
    () => [
      { label: "The name", payload: "name" },
      { label: "The icon", payload: "icon" },
    ],
    (acc, message) => {
      acc.change = message;
    }
  )
  .text(
    (acc) => {
      if (acc.change === "name") {
        return "Type the new name";
      }
      return "Type the new icon";
    },
    (acc, message) => {
      if (acc.change === "name") {
        acc.db.changeCategoryName(+acc.category_id, message);
      } else {
        acc.db.changeCategoryIcon(+acc.category_id, message);
      }
    }
  );

onCommand("/add_expense", "Spend money", true)
  .checkError((acc) => {
    checkAccountsExist(acc.db);
    checkCategoriesExist(acc.db);
  })
  .choice(
    "Which account?",
    (acc) =>
      acc.db.getAccounts().map((a) => ({
        label: `${a.icon} ${a.name}`,
        payload: a.id.toString(),
      })),
    (acc, message) => {
      acc.account_id = message;
    },
    2
  )
  .choice(
    "Which category?",
    (acc) =>
      acc.db.getCategories().map((a) => ({
        label: `${a.icon} ${a.name}`,
        payload: a.id.toString(),
      })),
    (acc, message) => {
      acc.category_id = message;
    },
    2
  )
  .text("How much did you spend?", async (acc, message) => {
    const amount = +message;

    if (isNaN(amount)) {
      await acc.ctx.reply("Cancelled - please enter a number next time.");
      return false;
    }

    acc.amount = String(amount);
  })
  .text("Title?", (acc, message) => {
    acc.title = message;
  })
  .tap(async (acc) => {
    const budgets = acc.db.getBudgets();
    const budget = budgets.find((b) => b.category_id === +acc.category_id);

    acc.db.addExpense(
      +acc.account_id,
      +acc.category_id,
      +acc.amount,
      Date.now(),
      acc.title
    );

    await acc.ctx.reply("Expense added.");

    if (budget) {
      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);

      const expenses = acc.db.getExpenses(+startOfMonth);

      const categories = acc.db.getCategories();
      const category = categories.find((c) => c.id === +acc.category_id)!;

      const totalForCategory = expenses.reduce(
        (acc, cur) =>
          cur.category_id === category.id ? acc + cur.amount : acc,
        0
      );

      const percentage = totalForCategory / budget.value;

      await acc.ctx.reply(
        `You've spent ${formatNum(totalForCategory, true)} in ${
          category.name
        } for this month, which is ${formatNum(
          percentage * 100
        )}% of your monthly budget.`
      );
    }
  });

onCommand("/set_budget", "Set a monthly budget on a category")
  .checkError((acc) => {
    checkCategoriesExist(acc.db);
  })
  .choice(
    "Which category?",
    (acc) =>
      acc.db.getCategories().map((a) => ({
        label: `${a.icon} ${a.name}`,
        payload: a.id.toString(),
      })),
    (acc, message) => {
      acc.category_id = message;
    },
    2
  )
  .text("How much can you spend per month?", async (acc, message) => {
    const amount = +message;

    if (isNaN(amount)) {
      await acc.ctx.reply("Cancelled - please enter a number next time.");
      return false;
    }

    acc.amount = String(amount);

    acc.db.addBudget(+acc.amount, +acc.category_id);

    await acc.ctx.reply("Budget set.");
  });

onCommand("/get_budgets", "Lists the budgets for each category", true).tap(
  async (acc) => {
    const consumptions = acc.db.calculateBudgetConsumption();
    const categories = acc.db.getCategories();

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
      )})\n${createPercentBar(percentage)}\n\n`;
    }

    await acc.ctx.reply(answer);
  }
);

onCommand("/get_last_expenses", "Get the last 100 expenses")
  .checkError((acc) => {
    checkAccountsExist(acc.db);
    checkCategoriesExist(acc.db);
  })
  .tap(async (acc) => {
    const allExpenses = acc.db.getExpenses();

    const expenses = allExpenses.slice(0, 100);

    let answer = "";

    const categories = acc.db.getCategories();

    for (const expense of expenses.reverse()) {
      answer += escapeMd(formatExpense(expense, categories)) + "\n";
    }

    answer = answer.trim();

    await acc.ctx.replyWithMarkdownV2(answer);
  });

onCommand("/remove_expense", "Remove an expense", true)
  .checkError((acc) => {
    checkAccountsExist(acc.db);
    checkCategoriesExist(acc.db);
  })
  .choice(
    "Which expense?",
    (acc) => {
      const allExpenses = acc.db.getExpenses();

      const categories = acc.db.getCategories();
      const choices = allExpenses.reverse().map((e) => ({
        label: formatExpense(e, categories),
        payload: e.id.toString(),
      }));

      return choices;
    },
    async (acc, message) => {
      const expenseId = +message;

      acc.db.removeExpense(expenseId);

      await acc.ctx.reply("Expense removed.");
    }
  );

onCommand("/change_expense_date", "Change the date of an expense")
  .checkError((acc) => {
    checkAccountsExist(acc.db);
    checkCategoriesExist(acc.db);
  })
  .choice(
    "Which expense?",
    (acc) => {
      const allExpenses = acc.db.getExpenses();
      const categories = acc.db.getCategories();

      const choices = allExpenses.map((e) => ({
        label: formatExpense(e, categories),
        payload: e.id.toString(),
      }));

      return choices;
    },
    (acc, message) => {
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
    (acc, message) => {
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
    (acc, message) => {
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
    (acc, message) => {
      acc.day = message;
    },
    3
  )
  .tap(async (acc) => {
    const expenseId = +acc.expense_id;
    const year = +acc.year;
    const month = +acc.month;
    const day = +acc.day;

    const date = Date.UTC(year, month, day);

    acc.db.changeExpenseDate(expenseId, +date);

    await acc.ctx.reply("Expense date changed.");
  });

onCommand(
  "/get_biggest_expenses",
  "Get biggest expenses for each month",
  true
).tap(async (acc) => {
  const startDate = new Date();
  startDate.setMonth(startDate.getMonth() - MONTHS_TO_SHOW, 1);
  startDate.setHours(0, 0, 0, 0);

  const categories = acc.db.getCategories();

  const allExpenses = acc.db.getExpenses(+startDate);

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
    for (const expense of expenses.slice(0, 10)) {
      answer += escapeMd(formatExpense(expense, categories)) + "\n";
    }
    answer += "\n";

    dateBefore.setMonth(dateBefore.getMonth() + 1);
    dateAfter.setMonth(dateAfter.getMonth() + 1);
  }

  answer = answer.trim();

  await acc.ctx.replyWithMarkdownV2(answer);
});

onCommand("/get_category_expenses", "Get all expenses for a category", true)
  .checkError((acc) => {
    checkAccountsExist(acc.db);
    checkCategoriesExist(acc.db);
  })
  .choice(
    "Which category?",
    (acc) =>
      acc.db.getCategories().map((a) => ({
        label: `${a.icon} ${a.name}`,
        payload: a.id.toString(),
      })),
    (acc, message) => {
      acc.category_id = message;
    },
    2
  )
  .tap(async (acc) => {
    const allExpenses = acc.db.getExpenses();
    const categories = acc.db.getCategories();
    
    const categoryExpenses = allExpenses.filter(
      (e) => e.category_id === +acc.category_id
    );

    let answer = "";
    for (const expense of categoryExpenses.reverse()) {
      answer += escapeMd(formatExpense(expense, categories)) + "\n";
    }

    answer = answer.trim() || "No expenses found for this category.";

    await acc.ctx.replyWithMarkdownV2(answer);
  });

onCommand("/ask_ai", "Ask AI about your expenses", true)
  .checkError((acc) => {
    checkCategoriesExist(acc.db);
  })
  .choice(
    "About which category?",
    (acc) => [
      { label: "📊 All categories", payload: "all" },
      ...acc.db.getCategories().map((a) => ({
        label: `${a.icon} ${a.name}`,
        payload: a.id.toString(),
      })),
    ],
    (acc, message) => {
      acc.category_id = message;
    },
    2
  )
  .choice(
    "For which time period?",
    () => {
      const now = new Date();
      const thisMonth = now.toLocaleString('default', { month: 'long' });
      const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1)
        .toLocaleString('default', { month: 'long' });
      
      return [
        { label: `This month (${thisMonth})`, payload: "this_month" },
        { label: `Last month (${lastMonth})`, payload: "last_month" },
        { label: "Since start of year", payload: "this_year" },
        { label: "All time", payload: "all_time" },
      ];
    },
    (acc, message) => {
      acc.time_period = message;
    }
  )
  .text("What would you like to know about these expenses?", async (acc, question) => {
    try {
      // Get time range
      const now = new Date();
      let startDate: number;
      switch (acc.time_period) {
        case "this_month":
          startDate = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
          break;
        case "last_month":
          startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime();
          break;
        case "this_year":
          startDate = new Date(now.getFullYear(), 0, 1).getTime();
          break;
        default: // all_time
          startDate = 0;
      }

      // Get expenses
      let expenses = acc.db.getExpenses(startDate);
      const categories = acc.db.getCategories();
      
      // Filter by category if needed
      if (acc.category_id !== "all") {
        expenses = expenses.filter(e => e.category_id === +acc.category_id);
      }

      // Format expenses for AI
      const formattedExpenses = expenses.map(e => {
        const category = categories.find(c => c.id === e.category_id)!;
        return formatExpense(e, categories);
      });

      // Prepare prompt
      const messages = [
        {
          role: "system" as const,
          content: "You are a helpful financial analysis assistant. Analyze the expenses data and answer the user's question concisely but thoroughly. Use markdown formatting if needed for clarity."
        },
        {
          role: "user" as const,
          content: `Here are the expenses:\n${formattedExpenses.join("\n")}\n\nQuestion: ${question}`
        }
      ];

      await acc.ctx.reply("Analyzing your expenses...");
      
      const answer = await askAi(messages);
      await acc.ctx.replyWithMarkdownV2(escapeMd(answer));

    } catch (error) {
      console.error("AI analysis error:", error);
      await acc.ctx.reply("Sorry, I encountered an error while analyzing your expenses. Please try again later.");
    }
  });

onCommand("/get_expenses_overview", "Get expenses by category", true)
  .checkError((acc) => {
    checkAccountsExist(acc.db);
    checkCategoriesExist(acc.db);
  })
  .tap(async (acc) => {
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - MONTHS_TO_SHOW, 1);
    startDate.setHours(0, 0, 0, 0);

    const allExpenses = acc.db.getExpenses(+startDate);

    let answer = "";

    let dateBefore = new Date(startDate);
    let dateAfter = new Date(startDate);
    dateAfter.setMonth(dateAfter.getMonth() + 1);

    const categories = acc.db.getCategories();
    const budgets = acc.db.getBudgets();

    while (+dateBefore < Date.now()) {
      const monthExpenses = allExpenses.filter(
        (e) => +e.date >= +dateBefore && +e.date < +dateAfter
      );

      monthExpenses.sort((a, b) => b.amount - a.amount);

      const monthName = dateBefore.toLocaleString("default", { month: "long" });

      let totalForMonth = 0;

      answer += `__${monthName}__ :\n`;
      for (const category of categories) {
        const categoryExpenses = monthExpenses.filter(
          (e) => e.category_id === category.id
        );

        const totalForCategory = categoryExpenses.reduce(
          (acc, cur) => acc + cur.amount,
          0
        );
        totalForMonth += totalForCategory;

        if (totalForCategory > 0) {
          answer += `${category.icon} ${escapeMd(
            category.name
          )} :\n      ${escapeMd(formatNum(totalForCategory, true))}`;

          const budget = budgets.find((b) => b.category_id === category.id);
          if (budget) {
            answer += escapeMd(` /${formatNum(budget.value, true)}`) + "\n";
            answer += escapeMd(createPercentBar(totalForCategory / budget.value));
          }

          answer += `\n`;
        }
      }
      answer += `Total: ${escapeMd(formatNum(totalForMonth, true))}\n`;
      answer += "\n";

      dateBefore.setMonth(dateBefore.getMonth() + 1);
      dateAfter.setMonth(dateAfter.getMonth() + 1);
    }

    answer = answer.trim();

    await acc.ctx.replyWithMarkdownV2(answer);
  });

onCommand(/^[0-9\.]+$/, "Add an expense")
  .checkError((acc) => {
    checkAccountsExist(acc.db);
    checkCategoriesExist(acc.db);
  })
  .choice(
    "Adding an expense.\nWhich account?",
    (acc) => {
      const accounts = acc.db.getAccounts();

      const choices = accounts.map((a) => ({
        label: `${a.icon} ${a.name}`,
        payload: a.id.toString(),
      }));

      return choices;
    },
    (acc, message) => {
      acc.account_id = message;
    },
    2
  )
  .choice(
    "Which category?",
    (acc) => {
      const categories = acc.db.getCategories();

      const choices = categories.map((c) => ({
        label: `${c.icon} ${c.name}`,
        payload: c.id.toString(),
      }));

      return choices;
    },
    (acc, message) => {
      acc.category_id = message;
    },
    2
  )
  .text("Title?", (acc, message) => {
    acc.title = message;
  })
  .tap(async (acc) => {
    acc.db.addExpense(
      +acc.account_id,
      +acc.category_id,
      +acc.command,
      Date.now(),
      acc.title
    );

    await acc.ctx.reply("Expense added.");

    const consumption = acc.db.calculateBudgetConsumption();

    const catId = +acc.category_id;

    if (consumption.has(catId)) {
      const categories = acc.db.getCategories();
      const category = categories.find((c) => c.id === catId)!;

      const totalForCategory = consumption.get(catId)!.consumption;
      const budget = consumption.get(catId)!.budget;

      const percentage = totalForCategory / budget;

      await acc.ctx.reply(
        `You've spent ${formatNum(totalForCategory, true)} in ${
          category.name
        } for this month, which is ${formatNum(
          percentage * 100
        )}% of your monthly budget.`
      );
    }
  });

onCommand("/set_user", "Set the user of the bot", false)
  .choice(
    "Who are you?",
    () => {
      const identities = DB.getAllIdentities();

      return [
        {
          label: "New user",
          payload: "__new__",
        },
        ...identities.map((i) => ({
          label: i,
          payload: i,
        })),
      ];
    },
    async (acc, message) => {
      const userName = message;

      if (userName !== "__new__") {
        const chatId = acc?.ctx?.chat?.id;
        if (!chatId) {
          await acc.ctx.reply(
            "Problem retreiving the chat id... What's going on?"
          );
          return false;
        }

        DB.setDbForChat(chatId, userName);
        await acc.ctx.reply(`Ok, we're now managing ${userName}'s expenses.`);
        return false;
      }
    }
  )
  .text("Title of the new user?", async (acc, message) => {
    const userName = message;

    const chatId = acc?.ctx?.chat?.id;
    if (!chatId) {
      await acc.ctx.reply("Problem retreiving the chat id... What's going on?");
      return false;
    }

    DB.setDbForChat(chatId, userName);

    await acc.ctx.reply(`Ok, we're now managing ${userName}'s expenses.`);
  });

onCommand("/help", "More commands", true)
  .choice(
    "What do you want to act on?",
    () => {
      return [
        {
          label: "Accounts",
          payload: "accounts",
        },
        {
          label: "Categories",
          payload: "categories",
        },
        {
          label: "Budgets",
          payload: "budgets",
        },
        {
          label: "Expenses",
          payload: "expenses",
        },
      ];
    },
    async (acc, payload) => {
      acc.action = payload;
    }
  )
  .choice(
    "What do you want to do?",
    (acc) => {
      switch (acc.action) {
        case "accounts":
          return [
            {
              label: "/add_account",
              payload: "add_account",
            },
            {
              label: "/remove_account",
              payload: "remove_account",
            },
            {
              label: "/get_accounts",
              payload: "get_accounts",
            },
          ];
        case "categories":
          return [
            {
              label: "/add_category",
              payload: "add_category",
            },
            {
              label: "/get_categories",
              payload: "get_categories",
            },
            {
              label: "/change_category",
              payload: "change_category",
            },
            {
              label: "/remove_category",
              payload: "remove_category",
            },
          ];
        case "budgets":
          return [
            {
              label: "/set_budget",
              payload: "set_budget",
            },
            {
              label: "/get_budgets",
              payload: "get_budgets",
            },
          ];
        case "expenses":
          return [
            {
              label: "/add_expense",
              payload: "add_expense",
            },
            {
              label: "/get_last_expenses",
              payload: "get_last_expenses",
            },
            {
              label: "/get_expenses_overview",
              payload: "get_expenses_overview",
            },
            {
              label: "/get_biggest_expenses",
              payload: "get_biggest_expenses",
            },
            {
              label: "/remove_expense",
              payload: "remove_expense",
            },
            {
              label: "/change_expense_date",
              payload: "change_expense_date",
            },
          ];
        default:
          return [];
      }
    },
    () => {
      // Do nothing
    }
  );

onCommand("/test", "Test command").tap(async (acc) => {
  await acc.ctx.reply(`
       ███████░░░░░░░░░░░░░
    `);
});
