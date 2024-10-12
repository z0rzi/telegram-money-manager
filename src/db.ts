import Database from "bun:sqlite";
import fs from "fs";
import path from "path";

const DB_DIR = "./dbs/";
const CONV2DB_PATH = path.join(DB_DIR, "./conv2db.json");

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

export default class DB {
  private static getConv2Db(): Record<number, string> {
    if (!fs.existsSync(CONV2DB_PATH)) {
      if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR);
      fs.writeFileSync(CONV2DB_PATH, "{}");
    }

    return JSON.parse(fs.readFileSync(CONV2DB_PATH, "utf8"));
  }

  static getDbForChat(chatId: number) {
    const conv2DbName = DB.getConv2Db();

    if (!conv2DbName[chatId]) {
      return null;
    }

    return new DB(conv2DbName[chatId]);
  }

  static setDbForChat(chatId: number, dbName: string) {
    const conv2DbName = DB.getConv2Db();

    conv2DbName[chatId] = dbName;

    // Creating DB if it doesn't exist
    new DB(dbName);

    fs.writeFileSync(CONV2DB_PATH, JSON.stringify(conv2DbName));
  }

  static getAllIdentities() {
    // Looking in the db folder
    const files = fs.readdirSync(DB_DIR);
    const dbs = files.filter((f) => f.endsWith(".sqlite"));

    return dbs.map((f) => f.slice(0, -7));
  }

  private db: Database;

  get dbPath() {
    return path.join(DB_DIR, `${this.profileName}.sqlite`);
  }

  constructor(private readonly profileName: string) {
    if (!fs.existsSync(this.dbPath)) {
      if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR);

      fs.writeFileSync(this.dbPath, "");
    }

    this.db = new Database(this.dbPath);

    this.db.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      icon TEXT NOT NULL,
      name TEXT NOT NULL
    );
    `);

    this.db.exec(`
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      icon TEXT NOT NULL
    );
    `);

    // date is amount of days since 1970-01-01
    this.db.exec(`
    CREATE TABLE IF NOT EXISTS expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL,
      category_id INTEGER NOT NULL,
      amount INTEGER NOT NULL,
      date INTEGER NOT NULL,
      description TEXT NOT NULL
    );
    `);

    this.db.exec(`
    CREATE TABLE IF NOT EXISTS budgets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      value INTEGER NOT NULL,
      category_id INTEGER NOT NULL
    );
    `);
  }

  getAccounts() {
    return this.db.prepare<Account, []>("SELECT * FROM accounts").all();
  }

  addAccount(icon: string, name: string) {
    return this.db
      .prepare("INSERT INTO accounts (icon, name) VALUES (?, ?)")
      .run(icon, name);
  }

  removeAccount(id: number) {
    return this.db.prepare("DELETE FROM accounts WHERE id = ?").run(id);
  }

  addCategory(icon: string, name: string) {
    return this.db
      .prepare("INSERT INTO categories (icon, name) VALUES (?, ?)")
      .run(icon, name);
  }

  getCategories() {
    return this.db.prepare<Category, []>("SELECT * FROM categories").all();
  }

  changeCategoryName(id: number, name: string) {
    return this.db
      .prepare("UPDATE categories SET name = ? WHERE id = ?")
      .run(name, id);
  }

  changeCategoryIcon(id: number, icon: string) {
    return this.db
      .prepare("UPDATE categories SET icon = ? WHERE id = ?")
      .run(icon, id);
  }

  addExpense(
    account_id: number,
    category_id: number,
    amount: number,
    date: number,
    description: string
  ) {
    return this.db
      .prepare(
        "INSERT INTO expenses (account_id, category_id, amount, date, description) VALUES (?, ?, ?, ?, ?)"
      )
      .run(account_id, category_id, amount, date, description);
  }

  removeExpense(id: number) {
    return this.db.prepare("DELETE FROM expenses WHERE id = ?").run(id);
  }

  changeExpenseDate(id: number, date: number) {
    return this.db
      .prepare("UPDATE expenses SET date = ? WHERE id = ?")
      .run(date, id);
  }

  getExpenses(from?: number, to: number = Date.now()) {
    let query = `SELECT * FROM expenses WHERE date <= ${to}`;
    if (from) query += ` AND date >= ${from}`;

    return this.db.prepare<Expense, []>(query).all();
  }

  addBudget(value: number, category_id: number) {
    this.db
      .prepare("DELETE FROM budgets WHERE category_id = ?")
      .run(category_id);

    return this.db
      .prepare("INSERT INTO budgets (value, category_id) VALUES (?, ?)")
      .run(value, category_id);
  }

  getBudgets() {
    return this.db.prepare<Budget, []>("SELECT * FROM budgets").all();
  }

  /**
   * Calculates the budget consumption for each category
   * for the current month
   */
  calculateBudgetConsumption(date = Date.now()): Map<
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

    const expenses = this.getExpenses(+startOfMonth, +endOfPeriod);
    const categories = this.getCategories();
    const budgets = this.getBudgets();

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
}
