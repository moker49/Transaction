import { clean } from "./common.mjs";

export function dashboardFromTransactions(transactions, options = {}) {
  const { categories = [], filterTransactions = (items) => items, segmentLimit = 7 } = options;
  const dashboardTransactions = filterTransactions(transactions);
  const categoriesById = categoriesByIdMap(categories);
  const income = sumTypedTransactions(dashboardTransactions, "income", false);
  const bills = sumExpenseTransactions(dashboardTransactions, true);
  const splurge = sumExpenseTransactions(dashboardTransactions, false);
  const saved = income - bills - splurge;
  return {
    income,
    bills,
    splurge,
    saved,
    typeSegments: [
      { label: "Bills", value: bills, color: "#c85d5d" },
      { label: "Splurge", value: splurge, color: "#7c6bc2" },
      { label: "Saved", value: Math.max(saved, 0), color: "#2f8f2f" },
    ],
    incomeSegments: categoryTransactionSegments(dashboardTransactions, "income", { categories, categoriesById, segmentLimit }),
    categorySegments: categorySpendingSegments(dashboardTransactions, "all-expenses", { categories, categoriesById, segmentLimit }),
    billSegments: categorySpendingSegments(dashboardTransactions, "bills", { categories, categoriesById, segmentLimit }),
    splurgeSegments: categorySpendingSegments(dashboardTransactions, "splurge", { categories, categoriesById, segmentLimit }),
  };
}

export function sumTypedTransactions(transactions, transactionType, useAbsoluteValue) {
  return transactions.reduce((total, transaction) => {
    if (transaction.transaction_type !== transactionType) {
      return total;
    }
    const amount = Number(transaction.amount_cents) || 0;
    return total + (useAbsoluteValue ? Math.abs(amount) : amount);
  }, 0);
}

export function sumExpenseTransactions(transactions, billTagged) {
  return transactions.reduce((total, transaction) => {
    if (transaction.transaction_type !== "expense" || hasBillTag(transaction) !== billTagged) {
      return total;
    }
    return total + Math.abs(Number(transaction.amount_cents) || 0);
  }, 0);
}

export function hasBillTag(transaction) {
  return (transaction.tags || []).some((tag) => clean(tag.name).toLowerCase() === "bill");
}

export function isDashboardExpense(transaction, mode) {
  if (transaction.transaction_type !== "expense") {
    return false;
  }
  if (mode === "splurge") {
    return !hasBillTag(transaction);
  }
  if (mode === "bills") {
    return hasBillTag(transaction);
  }
  return true;
}

export function categorySpendingSegments(transactions, expenseMode, options = {}) {
  return categoryTransactionSegments(
    transactions.filter((transaction) => isDashboardExpense(transaction, expenseMode)),
    "expense",
    options,
  );
}

export function categoryTransactionSegments(transactions, transactionType, options = {}) {
  const { categories = [], categoriesById = categoriesByIdMap(categories), segmentLimit = 7 } = options;
  const totals = new Map();
  transactions
    .filter((transaction) => transaction.transaction_type === transactionType)
    .forEach((transaction) => {
      const parent = parentCategoryForTransaction(transaction, categoriesById);
      if (!parent) {
        return;
      }
      const amount = Math.abs(Number(transaction.amount_cents) || 0);
      totals.set(parent.id, {
        label: parent.name,
        value: (totals.get(parent.id)?.value || 0) + amount,
        color: parent.color || "#000000",
      });
    });
  const segments = [...totals.values()].sort((a, b) => b.value - a.value);
  if (segments.length <= segmentLimit) {
    return segments;
  }
  const visibleLimit = segmentLimit - 1;
  const visible = segments.slice(0, visibleLimit);
  const otherValue = segments.slice(visibleLimit).reduce((sum, segment) => sum + segment.value, 0);
  if (otherValue > 0) {
    visible.push({ label: "All others", value: otherValue, color: "#000000" });
  }
  return visible;
}

export function categoriesByIdMap(categories) {
  return new Map(categories.map((category) => [category.id, category]));
}

export function parentCategoryForTransaction(transaction, categoriesOrMap) {
  const categoriesById = categoriesOrMap instanceof Map ? categoriesOrMap : categoriesByIdMap(categoriesOrMap);
  const category = categoriesById.get(transaction.category_id);
  if (!category) {
    return null;
  }
  if (category.parent_id === null) {
    return category;
  }
  return categoriesById.get(category.parent_id) || category;
}
