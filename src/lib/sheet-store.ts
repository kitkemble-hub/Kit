import { createSign } from "node:crypto";
import { sql } from "./db";
import { StoreError } from "./errors";
import {
  LAST_ROW,
  baselineForDesiredPills,
  blankRow,
  countedDoses,
  dosesFormula,
  extraColumn,
  extraForDose,
  extraSum,
  firstEmptyIndex,
  gridIndexForDate,
  parseGrid,
  parsePillsFormula,
  parseSignedCountFormula,
  pillsFormula,
  rowsForPhone,
  takenFormula,
  timeColumn,
  timeToFraction,
  usualDose,
  type MedRow,
  type Slot,
  type Snapshot,
  type UsualDoses,
} from "./meds";
import { writableSpreadsheetId } from "./sheet-target";

const TAB = "Meds Tracker";
const UNDO_MS = 2 * 60 * 1000;

type Account = { clientEmail: string; privateKey: string };
type CellWrite = { range: string; value: string | number | null; input: "RAW" | "USER_ENTERED" };

type SheetUndo = { mode: "sheet"; at: string; cells: CellWrite[] };

let tokenCache: { email: string; token: string; exp: number } | null = null;

export function sheetAccount(): Account | null {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim() ?? "";
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new StoreError("The Google account for the dose log copy could not be read.");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new StoreError("The Google account for the dose log copy could not be read.");
  }
  const email = (parsed as { client_email?: unknown }).client_email;
  const key = (parsed as { private_key?: unknown }).private_key;
  if (typeof email !== "string" || typeof key !== "string" || !email || !key) {
    throw new StoreError("The Google account for the dose log copy is missing its email or key.");
  }
  return { clientEmail: email, privateKey: key.replace(/\\n/g, "\n") };
}

export async function readSheet(owner: string, today: string): Promise<Snapshot> {
  await claim(owner);
  const loaded = await load();
  const undo = await readUndo(owner);
  return snapshotFrom(loaded, today, undo);
}

export async function logOnSheet(
  owner: string,
  today: string,
  input: { slot: Slot; dose: number; date: string; time: string },
): Promise<Snapshot> {
  await claim(owner);
  const loaded = await load();
  const index = gridIndexForDate(loaded.grid, input.date);
  const rowNumber = index === -1 ? 6 + firstEmptyIndex(loaded.grid) : 6 + index;
  const current = index === -1 ? blankRow(input.date, rowNumber) : loaded.rows.find((row) => row.date === input.date) ?? blankRow(input.date, rowNumber);
  const sameTime = current[input.slot] === input.time;
  const sameExtra = (extraForDose(input.dose) ?? 0) === (input.slot === "morning" ? current.morningExtra : input.slot === "afternoon" ? current.afternoonExtra : current.nightExtra);
  if (sameTime && sameExtra && index !== -1) return snapshotFrom(loaded, today, await readUndo(owner));

  const fraction = timeToFraction(input.time);
  if (fraction === null) throw new StoreError("That time isn't valid.");
  const writes: CellWrite[] = [];
  const previous: CellWrite[] = [];
  if (index === -1) {
    writes.push({ range: cellRange(`A${rowNumber}`), value: dateSerial(input.date), input: "RAW" });
    previous.push({ range: cellRange(`A${rowNumber}`), value: null, input: "RAW" });
  }
  const timeCell = `${timeColumn(input.slot)}${rowNumber}`;
  const extraCell = `${extraColumn(input.slot)}${rowNumber}`;
  writes.push({ range: cellRange(timeCell), value: fraction, input: "RAW" });
  previous.push({ range: cellRange(timeCell), value: rawCell(loaded.grid, index, slotIndex(input.slot)), input: "RAW" });
  const extra = extraForDose(input.dose);
  writes.push({ range: cellRange(extraCell), value: extra, input: "RAW" });
  previous.push({ range: cellRange(extraCell), value: rawCell(loaded.grid, index, extraIndex(input.slot)), input: "RAW" });

  const formulaWrites = formulaUpdates(loaded, rowNumber, extra !== null);
  for (const formula of formulaWrites) {
    previous.push({ range: formula.range, value: formula.previous, input: "USER_ENTERED" });
    writes.push({ range: formula.range, value: formula.value, input: "USER_ENTERED" });
  }
  if (loaded.headersMissing) {
    writes.push(
      { range: cellRange("F5"), value: "Morning extra", input: "RAW" },
      { range: cellRange("G5"), value: "Afternoon extra", input: "RAW" },
      { range: cellRange("H5"), value: "Night extra", input: "RAW" },
    );
  }
  await putCells(writes);
  await saveUndo(owner, { mode: "sheet", at: new Date().toISOString(), cells: previous });
  return readSheet(owner, today);
}

export async function setSheetPills(owner: string, today: string, pills: number): Promise<Snapshot> {
  await claim(owner);
  const loaded = await load();
  const formula = loaded.pillsFormula;
  const previous: CellWrite[] = [{ range: cellRange("B1"), value: formula ?? loaded.pillsValue, input: formula ? "USER_ENTERED" : "RAW" }];
  if (formula) {
    const parsed = parsePillsFormula(formula);
    if (!parsed) throw new StoreError("The pills formula in the copy is not one this app can update.");
    const baseline = baselineForDesiredPills(pills, countedDoses(loaded.grid), extraSum(loaded.grid));
    await putCells([{ range: cellRange("B1"), value: pillsFormula(baseline, Math.max(parsed.lastRow, LAST_ROW)), input: "USER_ENTERED" }]);
  } else {
    await putCells([{ range: cellRange("B1"), value: pills, input: "RAW" }]);
  }
  await saveUndo(owner, { mode: "sheet", at: new Date().toISOString(), cells: previous });
  return readSheet(owner, today);
}

export async function undoSheet(owner: string, today: string): Promise<Snapshot> {
  await claim(owner);
  const undo = await readUndo(owner);
  if (!undo) throw new StoreError("Nothing to undo.");
  await putCells(undo.cells);
  await sql("delete from dose_undo where sub = $1", [owner]);
  return readSheet(owner, today);
}

function slotIndex(slot: Slot): number {
  return slot === "morning" ? 1 : slot === "afternoon" ? 2 : 3;
}

function extraIndex(slot: Slot): number {
  return slot === "morning" ? 5 : slot === "afternoon" ? 6 : 7;
}

function rawCell(grid: unknown[][], index: number, column: number): string | number | null {
  if (index < 0) return null;
  const value = grid[index]?.[column];
  if (value == null || value === "") return null;
  if (typeof value === "number" || typeof value === "string") return value;
  return null;
}

function dateSerial(iso: string): number {
  const [year, month, day] = iso.split("-").map(Number);
  return Math.round((Date.UTC(year, month - 1, day) - Date.UTC(1899, 11, 30)) / 86400000);
}

function formulaUpdates(
  loaded: Loaded,
  rowNumber: number,
  writingExtra: boolean,
): { range: string; value: string; previous: string }[] {
  const pills = loaded.pillsFormula ? parsePillsFormula(loaded.pillsFormula) : null;
  const doses = loaded.dosesFormula ? parseSignedCountFormula(loaded.dosesFormula, "-") : null;
  const taken = loaded.takenFormula ? parseSignedCountFormula(loaded.takenFormula, "+") : null;
  if (!pills || !doses || !taken) {
    if (writingExtra) throw new StoreError("A higher dose needs the pills formula in the copy, and that formula is not in the expected form.");
    return [];
  }
  const needsRange = rowNumber > pills.lastRow || rowNumber > doses.lastRow || rowNumber > taken.lastRow;
  const needsExtras = writingExtra && !pills.tracksExtras;
  if (!needsRange && !needsExtras) return [];
  const lastRow = LAST_ROW;
  return [
    { range: cellRange("B1"), value: pillsFormula(pills.baseline, lastRow), previous: loaded.pillsFormula ?? "" },
    { range: cellRange("B2"), value: dosesFormula(doses.baseline, lastRow), previous: loaded.dosesFormula ?? "" },
    { range: cellRange("B3"), value: takenFormula(taken.baseline, lastRow), previous: loaded.takenFormula ?? "" },
  ];
}

type Loaded = {
  grid: unknown[][];
  rows: MedRow[];
  pillsValue: number | null;
  dosesRemaining: number | null;
  totalTaken: number | null;
  pillsFormula: string | null;
  dosesFormula: string | null;
  takenFormula: string | null;
  usual: UsualDoses;
  headersMissing: boolean;
};

async function load(): Promise<Loaded> {
  const [formulas, values, usual, headers, dates, extras] = await Promise.all([
    batchGet(["A1:B3"], "FORMULA"),
    batchGet(["B1:B3"], "UNFORMATTED_VALUE"),
    batchGet(["K1:K3"], "UNFORMATTED_VALUE"),
    batchGet(["F5:H5"], "UNFORMATTED_VALUE"),
    batchGet(["A6:D1000"], "UNFORMATTED_VALUE"),
    batchGet(["F6:H1000"], "UNFORMATTED_VALUE"),
  ]);
  const formulaRows = formulas[0] ?? [];
  const pillsFormulaText = textCell(formulaRows[0]?.[1]);
  const dosesFormulaText = textCell(formulaRows[1]?.[1]);
  const takenFormulaText = textCell(formulaRows[2]?.[1]);
  const dateRows = dates[0] ?? [];
  const extraRows = extras[0] ?? [];
  const grid = dateRows.map((row, index) => [
    row?.[0],
    row?.[1],
    row?.[2],
    row?.[3],
    "",
    extraRows[index]?.[0],
    extraRows[index]?.[1],
    extraRows[index]?.[2],
  ]);
  const usualRows = usual[0] ?? [];
  const header = headers[0]?.[0] ?? [];
  return {
    grid,
    rows: parseGrid(grid),
    pillsValue: numberOrNull(values[0]?.[0]?.[0]),
    dosesRemaining: numberOrNull(values[0]?.[1]?.[0]),
    totalTaken: numberOrNull(values[0]?.[2]?.[0]),
    pillsFormula: pillsFormulaText.startsWith("=") ? pillsFormulaText : null,
    dosesFormula: dosesFormulaText.startsWith("=") ? dosesFormulaText : null,
    takenFormula: takenFormulaText.startsWith("=") ? takenFormulaText : null,
    usual: {
      morning: usualDose(usualRows[0]?.[0]),
      afternoon: usualDose(usualRows[1]?.[0]),
      night: usualDose(usualRows[2]?.[0]),
    },
    headersMissing: header[0] !== "Morning extra",
  };
}

function snapshotFrom(loaded: Loaded, today: string, undo: SheetUndo | null): Snapshot {
  const id = writableSpreadsheetId();
  return {
    source: "sheet",
    pillsOnHand: loaded.pillsValue,
    dosesRemaining: loaded.dosesRemaining,
    totalTaken: loaded.totalTaken,
    usual: loaded.usual,
    rows: rowsForPhone(loaded.rows, today),
    spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${id}/edit`,
    undoAvailable: undo !== null,
  };
}

function textCell(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function cellRange(cell: string): string {
  const column = /^([A-Z]+)/.exec(cell)?.[1] ?? "";
  if (column === "E") throw new StoreError("That column is not part of the dose log.");
  return `'${TAB}'!${cell}`;
}

async function putCells(writes: CellWrite[]): Promise<void> {
  const grouped = new Map<"RAW" | "USER_ENTERED", { range: string; values: (string | number)[][] }[]>();
  for (const write of writes) {
    const list = grouped.get(write.input) ?? [];
    list.push({ range: write.range, values: [[write.value ?? ""]] });
    grouped.set(write.input, list);
  }
  for (const [input, data] of grouped) {
    if (data.length === 0) continue;
    await sheets(`/values:batchUpdate`, {
      method: "POST",
      body: JSON.stringify({ valueInputOption: input, data }),
    });
  }
}

async function batchGet(ranges: string[], render: "FORMULA" | "UNFORMATTED_VALUE"): Promise<unknown[][][]> {
  const params = new URLSearchParams({ valueRenderOption: render });
  for (const range of ranges) params.append("ranges", `'${TAB}'!${range}`);
  const body = (await sheets(`/values:batchGet?${params}`, { method: "GET" })) as {
    valueRanges?: { values?: unknown[][] }[];
  };
  return (body.valueRanges ?? []).map((range) => range.values ?? []);
}

async function sheets(path: string, init: RequestInit): Promise<unknown> {
  const spreadsheetId = writableSpreadsheetId();
  const account = sheetAccount();
  if (!account) throw new StoreError("The dose log copy is not connected yet.");
  const token = await accessToken(account);
  const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(15000),
  });
  const text = await response.text();
  if (!response.ok) {
    console.error("sheets request failed", response.status);
    if (response.status === 403 || response.status === 404) {
      throw new StoreError("The dose log copy is not shared with the Google account that updates it.", 502);
    }
    throw new StoreError("The dose log copy didn't accept that update.", 502);
  }
  return text ? JSON.parse(text) : {};
}

async function accessToken(account: Account): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (tokenCache && tokenCache.email === account.clientEmail && tokenCache.exp > now + 60) return tokenCache.token;
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const claim = Buffer.from(JSON.stringify({
    iss: account.clientEmail,
    scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  })).toString("base64url");
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claim}`);
  signer.end();
  const assertion = `${header}.${claim}.${signer.sign(account.privateKey).toString("base64url")}`;
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new StoreError("Google didn't accept the account for the dose log copy.", 502);
  const json = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) throw new StoreError("Google didn't accept the account for the dose log copy.", 502);
  tokenCache = { email: account.clientEmail, token: json.access_token, exp: now + (json.expires_in ?? 3600) };
  return json.access_token;
}

async function claim(owner: string): Promise<void> {
  const inserted = await sql<{ owner_sub: string }>(
    "insert into sheet_owner (id, owner_sub) values (1, $1) on conflict (id) do nothing returning owner_sub",
    [owner],
  );
  const rows = inserted.length ? inserted : await sql<{ owner_sub: string }>("select owner_sub from sheet_owner where id = 1");
  if (rows[0]?.owner_sub !== owner) throw new StoreError("This dose log belongs to someone else.", 403);
}

async function saveUndo(owner: string, payload: SheetUndo): Promise<void> {
  await sql(
    `insert into dose_undo (sub, payload, created_at) values ($1, $2, now())
     on conflict (sub) do update set payload = excluded.payload, created_at = now()`,
    [owner, JSON.stringify(payload)],
  );
}

async function readUndo(owner: string): Promise<SheetUndo | null> {
  const rows = await sql<{ payload: string; created_at: string | Date }>("select payload, created_at from dose_undo where sub = $1", [owner]);
  const row = rows[0];
  if (!row) return null;
  const created = new Date(row.created_at).getTime();
  if (!Number.isFinite(created) || Date.now() - created > UNDO_MS) return null;
  const payload = JSON.parse(row.payload) as SheetUndo;
  return payload.mode === "sheet" ? payload : null;
}
