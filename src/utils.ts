import type { Category, Expense } from "./db";

export function escapeMd(text: string) {
  return text.replace(/[\-\.\_]/g, "\\$&");
}

export function formatExpense(expense: Expense, catogories: Category[]) {
  const category = catogories.find((c) => c.id === expense.category_id)!;

  const date = new Date(expense.date);
  const strDate = date.toISOString().split("T")[0];

  return `${strDate} ${category.icon} ${expense.description} ${expense.amount}€`;
}
