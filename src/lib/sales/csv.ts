// CSV in and out for the Sales import and export, without a dependency
// (admin-sales spec C3). Pure.

// RFC 4180: comma-separated, fields optionally in double quotes, "" is a quote
// inside a quoted field, quoted fields may hold commas and line breaks. Accepts
// CRLF or LF line ends and a leading UTF-8 BOM (Excel). Blank lines are
// skipped. Returns rows of raw strings; the caller maps headers.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  const endRow = () => {
    row.push(field);
    if (row.length > 1 || row[0] !== "") rows.push(row);
    row = [];
    field = "";
  };
  for (; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c !== '"') field += c;
      else if (text[i + 1] === '"') (field += '"'), i++;
      else quoted = false;
    } else if (c === '"' && field === "") quoted = true;
    else if (c === ",") row.push(field), (field = "");
    else if (c === "\n") endRow();
    else if (c === "\r") {
      if (text[i + 1] === "\n") i++;
      endRow();
    } else field += c;
  }
  if (field !== "" || row.length) endRow();
  return rows;
}

export type Cell = string | number | boolean | null | undefined;

// One RFC 4180 output field, formula-injection-safe (same rule as
// /api/merchant/export): text a spreadsheet would run as a formula (= + - @,
// or a leading tab/CR) gets a leading apostrophe. Lead fields are untrusted
// input (imported files, typed notes), so this matters here.
export function csvCell(v: Cell): string {
  if (v == null) return "";
  if (typeof v !== "string") return String(v);
  const s = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const csvLines = (rows: Cell[][]) => rows.map((r) => r.map(csvCell).join(",") + "\r\n").join("");
