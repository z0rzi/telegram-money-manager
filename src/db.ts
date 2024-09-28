import Database from "bun:sqlite";
import fs from "fs";

if (!fs.existsSync("./db.sqlite")) {
  fs.writeFileSync("./db.sqlite", "");
}

const db = new Database("./db.sqlite");

db.exec(`
CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  icon TEXT NOT NULL,
  name TEXT NOT NULL
);
`);

db.exec(`
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  icon TEXT NOT NULL
);
`);

// date is amount of days since 1970-01-01
db.exec(`
CREATE TABLE IF NOT EXISTS expenses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL,
  category_id INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  date INTEGER NOT NULL,
  description TEXT NOT NULL
);
`);

db.exec(`
CREATE TABLE IF NOT EXISTS budgets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  value INTEGER NOT NULL,
  category_id INTEGER NOT NULL
);
`);

export type Account = {
  id: number;
  icon: string;
  name: string;
};

export type Category = {
  id: number;
  name: string;
  icon: string;
};

export type Expense = {
  id: number;
  account_id: number;
  category_id: number;
  amount: number;
  date: number;
  description: string;
};

export type Budget = {
  id: number;
  value: number;
  category_id: number;
};

export function getAccounts() {
  return db.prepare<Account, []>("SELECT * FROM accounts").all();
}

export function addAccount(icon: string, name: string) {
  return db
    .prepare("INSERT INTO accounts (icon, name) VALUES (?, ?)")
    .run(icon, name);
}

export function removeAccount(id: number) {
  return db.prepare("DELETE FROM accounts WHERE id = ?").run(id);
}

export function addCategory(icon: string, name: string) {
  return db
    .prepare("INSERT INTO categories (icon, name) VALUES (?, ?)")
    .run(icon, name);
}

export function getCategories() {
  return db.prepare<Category, []>("SELECT * FROM categories").all();
}

export function addExpense(
  account_id: number,
  category_id: number,
  amount: number,
  date: number,
  description: string
) {
  return db
    .prepare(
      "INSERT INTO expenses (account_id, category_id, amount, date, description) VALUES (?, ?, ?, ?, ?)"
    )
    .run(account_id, category_id, amount, date, description);
}

export function removeExpense(id: number) {
  return db.prepare("DELETE FROM expenses WHERE id = ?").run(id);
}

export function changeExpenseDate(id: number, date: number) {
  return db.prepare("UPDATE expenses SET date = ? WHERE id = ?").run(date, id);
}

export function getExpenses(from?: number, to: number = Date.now()) {
  let query = `SELECT * FROM expenses WHERE date <= ${to}`;
  if (from) query += ` AND date >= ${from}`;

  return db.prepare<Expense, []>(query).all();
}

export function addBudget(value: number, category_id: number) {
  db.prepare("DELETE FROM budgets WHERE category_id = ?").run(category_id);

  return db
    .prepare("INSERT INTO budgets (value, category_id) VALUES (?, ?)")
    .run(value, category_id);
}

export function getBudgets() {
  return db.prepare<Budget, []>("SELECT * FROM budgets").all();
}

/**
 * Calculates the budget consumption for each category
 * for the current month
 */
export function calculateBudgetConsumption(date = Date.now()): Map<
  number,
  {
    budget: number;
    consumption: number;
  }
> {
  const startOfMonth = new Date(date);
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const endOfPeriod = new Date(startOfMonth);
  endOfPeriod.setMonth(endOfPeriod.getMonth() + 1);

  const expenses = getExpenses(+startOfMonth, +endOfPeriod);
  const categories = getCategories();
  const budgets = getBudgets();

  const budgetConsumption = new Map<
    number,
    {
      budget: number;
      consumption: number;
    }
  >();

  for (const category of categories) {
    const categoryExpenses = expenses.filter(
      (e) => e.category_id === category.id
    );
    const totalForCategory = categoryExpenses.reduce(
      (acc, cur) => acc + cur.amount,
      0
    );

    const budget = budgets.find((b) => b.category_id === category.id)!;
    if (!budget) continue;

    budgetConsumption.set(category.id, {
      budget: budget.value,
      consumption: totalForCategory,
    });
  }

  return budgetConsumption;
}
