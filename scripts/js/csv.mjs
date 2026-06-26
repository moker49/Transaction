import { clean } from "./common.mjs";

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"' && inQuotes && next === '"') {
      value += '"';
      i += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      row.push(value);
      value = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        i += 1;
      }
      row.push(value);
      if (row.some((field) => field.trim() !== "")) {
        rows.push(row);
      }
      row = [];
      value = "";
    } else {
      value += char;
    }
  }

  row.push(value);
  if (row.some((field) => field.trim() !== "")) {
    rows.push(row);
  }

  if (!rows.length) {
    throw new Error("CSV file does not contain a header row.");
  }

  const headers = rows[0].map((header) => header.trim());
  const dataRows = rows.slice(1).map((items) => {
    return headers.reduce((record, header, index) => {
      record[header] = items[index] ?? "";
      return record;
    }, {});
  });

  return { headers, rows: dataRows };
}

export function normalizeCsvRow(row) {
  let rawAmount = firstCsvValue(row, "Amount", "amount");
  if (!rawAmount && ("Debit" in row || "Credit" in row)) {
    rawAmount = signedAmountFromDebitCredit(row);
  }

  return {
    raw_date: firstCsvValue(
      row,
      "Posted Date",
      "Posting Date",
      "post_date",
      "Date",
      "Transaction Date",
      "transaction_date",
    ),
    raw_category: firstCsvValue(row, "Category", "category"),
    raw_description: firstCsvValue(row, "Description", "description", "Memo", "Name", "Payee"),
    raw_amount: rawAmount,
  };
}

export function firstCsvValue(row, ...names) {
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(row, name)) {
      const value = collapseMultiSpaces(clean(row[name]));
      if (value) {
        return value;
      }
    }
  }
  return null;
}

export function collapseMultiSpaces(value) {
  return String(value || "").replace(/ {2,}/g, " ");
}

export function signedAmountFromDebitCredit(row) {
  const debit = firstCsvValue(row, "Debit");
  const credit = firstCsvValue(row, "Credit");

  if (debit && credit) {
    return `debit=${debit}; credit=${credit}`;
  }
  if (debit) {
    return debit.startsWith("-") ? debit : `-${debit}`;
  }
  return credit;
}

export function detectCsvLayout(fieldnames) {
  const fields = new Set(fieldnames);
  if (hasFields(fields, ["account", "transaction_date", "description", "amount"])) {
    return "normalized_statement_export";
  }
  if (hasFields(fields, ["Transaction Date", "Posted Date", "Description", "Category", "Debit", "Credit"])) {
    return "capital_one_credit";
  }
  if (hasFields(fields, ["Details", "Posting Date", "Description", "Amount", "Type", "Balance"])) {
    return "chase_checking";
  }
  if (hasFields(fields, ["Date", "Description", "Type", "Amount", "Current balance", "Status"])) {
    return "sofi_bank";
  }
  return "generic_csv";
}

export function hasFields(fields, required) {
  return required.every((field) => fields.has(field));
}

export function sourceAccountKeyFromCsvRows(rows) {
  const keys = rows.map((row) => normalizeImportAccountKey(firstCsvValue(row, "account"))).filter(Boolean);
  const uniqueKeys = new Set(keys);
  if (uniqueKeys.size > 1) {
    throw new Error("CSV file contains multiple account keys.");
  }
  return keys.length ? keys[0] : null;
}

export function accountImportKeys(account) {
  const accountType = normalizeImportAccountKey(account.account_type);
  if (!accountType) {
    return [];
  }
  return [account.institution, account.name]
    .map((value) => normalizeImportAccountKey(value))
    .filter(Boolean)
    .map((value) => `${accountType}_${value}`);
}

export function normalizeImportAccountKey(value) {
  return clean(value)
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "") || null;
}

export async function sha256(text) {
  if (!crypto.subtle) {
    return String(text.length) + ":" + text.slice(0, 64);
  }

  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
