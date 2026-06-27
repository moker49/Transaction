import csv
import re
import sys
from collections import defaultdict
from dataclasses import dataclass, asdict
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "vendor"))

from pypdf import PdfReader  # noqa: E402


MONTHS = {
    "jan": 1,
    "january": 1,
    "feb": 2,
    "february": 2,
    "mar": 3,
    "march": 3,
    "apr": 4,
    "april": 4,
    "may": 5,
    "jun": 6,
    "june": 6,
    "jul": 7,
    "july": 7,
    "aug": 8,
    "august": 8,
    "sep": 9,
    "sept": 9,
    "september": 9,
    "oct": 10,
    "october": 10,
    "nov": 11,
    "november": 11,
    "dec": 12,
    "december": 12,
}

OUT_COLUMNS = [
    "account",
    "account_number",
    "source_file",
    "statement_period",
    "transaction_date",
    "post_date",
    "description",
    "category",
    "amount",
    "balance",
    "transaction_type",
    "card",
]


@dataclass
class Row:
    account: str
    account_number: str
    source_file: str
    statement_period: str
    transaction_date: str
    post_date: str
    description: str
    category: str
    amount: str
    balance: str = ""
    transaction_type: str = ""
    card: str = ""


def pdf_text(path: Path) -> str:
    parts = []
    reader = PdfReader(str(path))
    for page in reader.pages:
        parts.append(page.extract_text() or "")
    return "\n".join(parts)


def money_to_decimal(value: str) -> Decimal | None:
    raw = value.strip().replace(",", "")
    neg = raw.startswith("-")
    raw = raw.replace("$", "").replace("-", "").strip()
    if not raw:
        return None
    try:
        amount = Decimal(raw)
    except InvalidOperation:
        return None
    return -amount if neg else amount


def money_to_str(value: str, sign: int = 1) -> str:
    amount = money_to_decimal(value)
    if amount is None:
        return ""
    amount *= sign
    return f"{amount:.2f}"


def parse_long_date(text: str) -> date | None:
    m = re.match(r"([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})", text.strip())
    if not m:
        return None
    month = MONTHS.get(m.group(1).lower())
    if not month:
        return None
    return date(int(m.group(3)), month, int(m.group(2)))


def parse_statement_period(text: str) -> tuple[str, date | None, date | None]:
    m = re.search(
        r"([A-Za-z]+ \d{1,2}, \d{4})\s+(?:through|-)\s+([A-Za-z]+ \d{1,2}, \d{4})",
        text,
    )
    if not m:
        return "", None, None
    start = parse_long_date(m.group(1))
    end = parse_long_date(m.group(2))
    return f"{m.group(1)} - {m.group(2)}", start, end


def fallback_year_for_path(path: Path, start: date | None = None, end: date | None = None) -> int:
    if end is not None:
        return end.year
    if start is not None:
        return start.year
    m = re.search(r"\b(20\d{2})\b", path.name)
    if m:
        return int(m.group(1))
    if path.parent.name.isdigit():
        return int(path.parent.name)
    return datetime.now().year


def infer_date(month: int, day: int, start: date | None, end: date | None, fallback_year: int) -> date:
    if start and end:
        for year in {start.year, end.year}:
            try:
                candidate = date(year, month, day)
            except ValueError:
                continue
            if start <= candidate <= end:
                return candidate
    return date(fallback_year, month, day)


def source_rel(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT)).replace("\\", "/")
    except ValueError:
        return path.name


def parse_chase(path: Path) -> list[Row]:
    text = pdf_text(path)
    period, start, end = parse_statement_period(text)
    fallback_year = fallback_year_for_path(path, start, end)
    account_number = ""
    m = re.search(r"Account Number:\s*([0-9]+)", text)
    if m:
        account_number = m.group(1)

    rows = []
    section = ""
    stop_prefixes = (
        "Total Deposits",
        "Total ATM",
        "Total Electronic",
        "You were not charged",
        "IN CASE OF",
        "JPMorgan Chase",
    )
    sections = {
        "DEPOSITS AND ADDITIONS": ("Deposits and Additions", 1),
        "ATM & DEBIT CARD WITHDRAWALS": ("ATM & Debit Card Withdrawals", -1),
        "ELECTRONIC WITHDRAWALS": ("Electronic Withdrawals", -1),
        "FEES": ("Fees", -1),
    }
    sign = 1
    for raw in text.splitlines():
        line = " ".join(raw.split())
        if line in sections:
            section, sign = sections[line]
            continue
        if line.startswith(stop_prefixes):
            section = ""
            continue
        if not section or line == "DATE DESCRIPTION AMOUNT":
            continue
        m = re.match(r"^(\d{2})/(\d{2})\s+(.+?)\s+\$?(-?[\d,]+\.\d{2})$", line)
        if not m:
            continue
        txn_date = infer_date(int(m.group(1)), int(m.group(2)), start, end, fallback_year)
        transaction_type, description = split_chase_description(m.group(3).strip())
        rows.append(
            Row(
                account="checking_chase",
                account_number=account_number,
                source_file=source_rel(path),
                statement_period=period,
                transaction_date=txn_date.isoformat(),
                post_date="",
                description=description,
                category="",
                amount=money_to_str(m.group(4), sign),
                transaction_type=transaction_type,
            )
        )
    return rows


def split_chase_description(raw: str) -> tuple[str, str]:
    description = " ".join(raw.split())
    dated = re.match(r"^(.+?)\s+\d{2}/\d{2}\s+(.+)$", description)
    if dated:
        transaction_type = dated.group(1).strip()
        merchant = dated.group(2).strip()
        merchant = re.sub(r"\s+Card\s+\d{4}$", "", merchant).strip()
        return transaction_type, merchant

    return "", description


def parse_sofi(path: Path) -> list[Row]:
    text = pdf_text(path)
    period, start, end = parse_statement_period(text)
    fallback_year = fallback_year_for_path(path, start, end)
    account_number = ""
    m = re.search(r"Account Number\s*\n\s*([0-9]+)", text)
    if m:
        account_number = m.group(1)

    rows = []
    lines = [" ".join(line.split()) for line in text.splitlines()]
    i = 0
    current_account = "sofi"
    current_account_number = account_number
    while i < len(lines):
        account_header = re.match(r"^(Checking|Savings) Account - (\d{4})$", lines[i])
        if account_header:
            kind = account_header.group(1).lower()
            current_account = f"sofi_{kind}_{account_header.group(2)}"
            current_account_number = account_header.group(2)
            i += 1
            continue
        m = re.match(r"^([A-Za-z]+) (\d{1,2}), (\d{4}) (.+)$", lines[i])
        if not m:
            i += 1
            continue
        month = MONTHS.get(m.group(1).lower())
        if not month:
            i += 1
            continue
        txn_date = date(int(m.group(3)), month, int(m.group(2)))
        type_desc = m.group(4).strip()
        txn_type = ""
        description = type_desc
        for prefix in ("Overdraft", "Debit Card", "Direct Payment", "Transfer", "Interest", "Deposit"):
            if type_desc.startswith(prefix + " "):
                txn_type = prefix
                description = type_desc[len(prefix) :].strip()
                break
            if type_desc == prefix:
                txn_type = prefix
                description = ""
                break

        transaction_id = ""
        amount = ""
        balance = ""
        if i + 1 < len(lines) and lines[i + 1].startswith("Transaction ID:"):
            transaction_id = lines[i + 1].replace("Transaction ID:", "").strip()
        if i + 2 < len(lines):
            money_parts = re.findall(r"-?\$[\d,]+\.\d{2}", lines[i + 2])
            if len(money_parts) >= 2:
                amount = money_to_str(money_parts[0])
                balance = money_to_str(money_parts[1])
        if amount:
            if transaction_id:
                description = f"{description} | Transaction ID: {transaction_id}".strip()
            rows.append(
                Row(
                    account=current_account,
                    account_number=current_account_number,
                    source_file=source_rel(path),
                    statement_period=period,
                    transaction_date=txn_date.isoformat(),
                    post_date="",
                    description=description,
                    category="",
                    amount=amount,
                    balance=balance,
                    transaction_type=txn_type,
                )
            )
            i += 3
        else:
            i += 1
    return rows


def capone_month_day(value: str, fallback_year: int, start: date | None, end: date | None) -> date:
    m = re.match(r"([A-Za-z]+)\s+(\d{1,2})", value)
    if not m:
        return date(fallback_year, 1, 1)
    month = MONTHS[m.group(1).lower()]
    return infer_date(month, int(m.group(2)), start, end, fallback_year)


def parse_capone_monthly(path: Path) -> list[Row]:
    text = pdf_text(path)
    period, start, end = parse_statement_period(text)
    fallback_year = fallback_year_for_path(path, start, end)
    account_number = ""
    m = re.search(r"_(\d{4})\.pdf$", path.name)
    if m:
        account_number = m.group(1)
    m = re.search(r"Account ending in\s+(\d{4})", text)
    if m:
        account_number = m.group(1)
    rows = []
    in_transactions = False
    row_re = re.compile(
        r"\b([A-Z][a-z]{2} \d{1,2})\s+([A-Z][a-z]{2} \d{1,2})\s+(.+?)\s+(-?\s*)?\$([\d,]+\.\d{2})"
    )
    for raw in text.splitlines():
        line = " ".join(raw.split())
        markers = []
        for marker, label in (
            ("Payments, Credits and Adjustments", "Payments, Credits and Adjustments"),
            (": Transactions", "Transactions"),
        ):
            search_from = 0
            while True:
                pos = line.find(marker, search_from)
                if pos < 0:
                    break
                markers.append((pos, label))
                search_from = pos + len(marker)
        markers.sort()
        if markers:
            in_transactions = True
        if not in_transactions:
            continue
        for m in row_re.finditer(line):
            category = "Transactions"
            for pos, label in markers:
                if pos <= m.start():
                    category = label
                else:
                    break
            desc = m.group(3).strip()
            if any(skip in desc for skip in ("Trans Date Post Date", "Total Transactions")):
                continue
            txn_date = capone_month_day(m.group(1), fallback_year, start, end)
            post_date = capone_month_day(m.group(2), fallback_year, start, end)
            sign = -1 if m.group(4) and "-" in m.group(4) else 1
            rows.append(
                Row(
                    account="credit_capital-one",
                    account_number=account_number,
                    source_file=source_rel(path),
                    statement_period=period,
                    transaction_date=txn_date.isoformat(),
                    post_date=post_date.isoformat(),
                    description=desc,
                    category=category,
                    amount=money_to_str(m.group(5), sign),
                    card=account_number,
                )
            )
    return rows


def parse_capone_summary(path: Path) -> list[Row]:
    text = pdf_text(path)
    fallback_year = fallback_year_for_path(path)
    rows = []
    category = ""
    card = ""
    lines = [" ".join(line.split()) for line in text.splitlines()]
    i = 0
    ignored = (
        "Year-End Summary",
        "Section 4_Transaction Details",
        "cont",
        "Date",
        "Merchant Name",
        "Merchant Location",
        "Amount",
        "Deduct",
        "TOTAL ",
        "Page ",
    )
    category_re = re.compile(r"^([A-Za-z][A-Za-z/& ]+?)\s*$")
    while i < len(lines):
        line = lines[i]
        if not line:
            i += 1
            continue
        if line.startswith("Card Ending in"):
            card = line.replace("Card Ending in", "").strip()
            i += 1
            continue
        if re.match(r"^\d{2}/\d{2}$", line) and i + 3 < len(lines):
            merchant = lines[i + 1]
            location = lines[i + 2]
            amount_line = lines[i + 3]
            if re.match(r"^-?\$[\d,]+\.\d{2}$", amount_line):
                month, day = [int(part) for part in line.split("/")]
                txn_date = date(fallback_year, month, day)
                rows.append(
                    Row(
                        account="credit_capital-one",
                        account_number="4529",
                        source_file=source_rel(path),
                        statement_period=f"{fallback_year}",
                        transaction_date=txn_date.isoformat(),
                        post_date="",
                        description=f"{merchant} {location}".strip(),
                        category=category,
                        amount=money_to_str(amount_line),
                        card=card,
                    )
                )
                i += 4
                continue
        if (
            category_re.match(line)
            and not line.startswith(ignored)
            and "$" not in line
            and "Capital One" not in line
            and "Prepared for" not in line
            and "Member Since" not in line
        ):
            category = line
        i += 1
    return rows


def looks_like_chase(text: str, path: Path) -> bool:
    value = f"{path.name}\n{text}".lower()
    return "jpmorgan chase" in value or "chase.com" in value


def looks_like_sofi(text: str, path: Path) -> bool:
    value = f"{path.name}\n{text}".lower()
    return "sofi" in value or "social finance" in value


def looks_like_capone(text: str, path: Path) -> bool:
    value = f"{path.name}\n{text}".lower()
    return "capital one" in value or "capital-one" in value


def parse_pdf(path: Path) -> list[Row]:
    rel = source_rel(path)
    if rel.startswith("checking_chase/"):
        return parse_chase(path)
    if rel.startswith("sofi/"):
        return parse_sofi(path)
    if rel.startswith("credit_capital-one/"):
        if path.name.lower().startswith("smry_"):
            return parse_capone_summary(path)
        return parse_capone_monthly(path)
    text = pdf_text(path)
    if looks_like_chase(text, path):
        return parse_chase(path)
    if looks_like_sofi(text, path):
        return parse_sofi(path)
    if looks_like_capone(text, path):
        if "year-end summary" in text.lower() or path.name.lower().startswith("smry_"):
            return parse_capone_summary(path)
        return parse_capone_monthly(path)
    return []


def parse_pdf_dicts(path: Path) -> list[dict[str, str]]:
    return [asdict(row) for row in parse_pdf(path)]


def main() -> int:
    groups: dict[tuple[str, str], list[Row]] = defaultdict(list)
    counts = []
    for path in sorted(ROOT.rglob("*.pdf")):
        if "vendor" in path.parts:
            continue
        rows = parse_pdf(path)
        counts.append((source_rel(path), len(rows)))
        for row in rows:
            year = row.transaction_date[:4] if row.transaction_date else path.parent.name
            groups[(row.account, year)].append(row)

    out_dir = ROOT / "csv"
    out_dir.mkdir(exist_ok=True)
    for old_file in out_dir.glob("*.csv"):
        old_file.unlink()
    for (account, year), rows in sorted(groups.items()):
        rows.sort(key=lambda r: (r.transaction_date, r.post_date, r.source_file, r.description, r.amount))
        out_path = out_dir / f"{account}_{year}.csv"
        with out_path.open("w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=OUT_COLUMNS)
            writer.writeheader()
            for row in rows:
                writer.writerow(asdict(row))

    print("Parsed PDFs:")
    for rel, count in counts:
        print(f"{count:4d} {rel}")
    print("\nCSV files:")
    for (account, year), rows in sorted(groups.items()):
        print(f"{len(rows):4d} csv/{account}_{year}.csv")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
