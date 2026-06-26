import { clean } from "./common.mjs";

export function statusClass(status) {
  if (status === "auto-importable" || status === "manual" || status === "pre-fill") {
    return "status-new";
  }
  return `status-${status}`;
}

export function statusLabel(status) {
  return {
    "auto-importable": "Auto-importable",
    manual: "Manual Import",
    "pre-fill": "Pre-fill",
    imported: "Imported",
    duplicate: "Duplicate",
    error: "Error",
  }[status] || status;
}

export function accountLabel(account) {
  return account.name;
}

export function accountTypeValues() {
  return new Set(["credit", "checking", "savings"]);
}

export function accountTypeLabel(value) {
  return {
    credit: "Credit",
    checking: "Checking",
    savings: "Savings",
  }[clean(value)] || clean(value);
}

export function matchAmountLabel(matchAmount) {
  return {
    positive: "Positive",
    negative: "Negative",
    any: "Any",
  }[matchAmount || "any"] || "Any";
}

export function transactionTypeLabel(value) {
  return {
    income: "Income",
    expense: "Expense",
    transfer: "Transfer",
  }[value] || value;
}

export function destructiveMessage(message) {
  return `${message}\nThis cannot be undone.`;
}
