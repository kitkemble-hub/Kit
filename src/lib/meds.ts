import { StoreError } from "./errors";

export const SLOTS = ["morning", "afternoon", "night"] as const;
export type Slot = (typeof SLOTS)[number];

export const SLOT_LABEL: Record<Slot, string> = {
  morning: "Morning",
  afternoon: "Afternoon",
  night: "Night",
};

export const LAST_ROW = 1000;

const TIME_COLUMN: Record<Slot, string> = { morning: "B", afternoon: "C", night: "D" };
const EXTRA_COLUMN: Record<Slot, string> = { morning: "F", afternoon: "G", night: "H" };

export type MedRow = {
  row: number;
  date: string;
  morning: string;
  afternoon: string;
  night: string;
  morningExtra: number;
  afternoonExtra: number;
  nightExtra: number;
};

export type UsualDoses = Record<Slot, number>;

export type LastDose = { date: string; slot: Slot; time: string };

export type Snapshot = {
  source: "sheet" | "database";
  pillsOnHand: number | null;
  dosesRemaining: number | null;
  totalTaken: number | null;
  usual: UsualDoses;
  rows: MedRow[];
  spreadsheetUrl: string | null;
  undoAvailable: boolean;
};

export function roundPills(value: number): number {
  return Math.round(value * 100) / 100;
}

export function formatPills(value: number): string {
  return roundPills(value).toFixed(2).replace(/\.?0+$/, "");
}

export function serialToIso(serial: number): string {
  const ms = Date.UTC(1899, 11, 30) + Math.round(serial) * 86400000;
  return new Date(ms).toISOString().slice(0, 10);
}

export function isoToSerial(iso: string): number {
  const [year, month, day] = iso.split("-").map(Number);
  const ms = Date.UTC(year, month - 1, day);
  return Math.round((ms - Date.UTC(1899, 11, 30)) / 86400000);
}

export function fractionToTime(fraction: number): string {
  const minutes = Math.round((((fraction % 1) + 1) % 1) * 24 * 60) % (24 * 60);
  const hour24 = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const suffix = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 || 12;
  return `${hour12}:${String(minute).padStart(2, "0")} ${suffix}`;
}

export function normalizeTime(value: string): string {
  const match = /^(\d{1,2}):(\d{2})\s*([AaPp][Mm])$/.exec(value.trim().replace(/\u202f/g, " ").replace(/\s+/g, " "));
  if (!match) return "";
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 1 || hour > 12 || minute > 59) return "";
  return `${hour}:${String(minute).padStart(2, "0")} ${match[3].toUpperCase()}`;
}

export function timeToFraction(value: string): number | null {
  const time = normalizeTime(value);
  const match = /^(\d{1,2}):(\d{2}) (AM|PM)$/.exec(time);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  if (match[3] === "AM") hour = hour === 12 ? 0 : hour;
  else hour = hour === 12 ? 12 : hour + 12;
  return (hour * 60 + minute) / (24 * 60);
}

export function cellTime(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value < 0 || value >= 1) return "";
    return fractionToTime(value);
  }
  if (typeof value === "string") return normalizeTime(value);
  return "";
}

export function cellNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

export function cellDate(value: unknown): string {
  if (typeof value === "number" && value > 1000) return serialToIso(value);
  if (typeof value === "string") {
    const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value.trim());
    if (slash) {
      const day = Number(slash[1]);
      const month = Number(slash[2]);
      const year = Number(slash[3]);
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
    if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  }
  return "";
}

export function usualDose(value: unknown): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 3) return 0.5;
  return roundPills(parsed);
}

export function parseGrid(grid: unknown[][], firstRow = 6): MedRow[] {
  const rows: MedRow[] = [];
  for (let index = 0; index < grid.length; index += 1) {
    const raw = grid[index] ?? [];
    const date = cellDate(raw[0]);
    if (!date) continue;
    rows.push({
      row: firstRow + index,
      date,
      morning: cellTime(raw[1]),
      afternoon: cellTime(raw[2]),
      night: cellTime(raw[3]),
      morningExtra: cellNumber(raw[5]),
      afternoonExtra: cellNumber(raw[6]),
      nightExtra: cellNumber(raw[7]),
    });
  }
  return rows;
}

export function gridIndexForDate(grid: unknown[][], date: string): number {
  return grid.findIndex((raw) => cellDate(raw?.[0]) === date);
}

export function firstEmptyIndex(grid: unknown[][]): number {
  const index = grid.findIndex((raw) => cellDate(raw?.[0]) === "");
  return index === -1 ? grid.length : index;
}

export function countedDoses(grid: unknown[][]): number {
  let count = 0;
  for (const raw of grid) {
    for (const index of [1, 2, 3]) {
      const value = raw?.[index];
      if (typeof value === "number" && Number.isFinite(value)) count += 1;
    }
  }
  return count;
}

export function extraSum(grid: unknown[][]): number {
  let sum = 0;
  for (const raw of grid) {
    for (const index of [5, 6, 7]) sum += cellNumber(raw?.[index]);
  }
  return roundPills(sum);
}

export function extraOn(row: MedRow, slot: Slot): number {
  if (slot === "morning") return row.morningExtra;
  if (slot === "afternoon") return row.afternoonExtra;
  return row.nightExtra;
}

export function recordedDose(row: MedRow, slot: Slot): number {
  return roundPills(0.5 + extraOn(row, slot));
}

export function extraForDose(dose: number): number | null {
  const extra = roundPills(dose - 0.5);
  return extra === 0 ? null : extra;
}

export function blankRow(date: string, row: number): MedRow {
  return {
    row,
    date,
    morning: "",
    afternoon: "",
    night: "",
    morningExtra: 0,
    afternoonExtra: 0,
    nightExtra: 0,
  };
}

export function withDose(row: MedRow, slot: Slot, time: string, dose: number): MedRow {
  const extra = extraForDose(dose) ?? 0;
  if (slot === "morning") return { ...row, morning: time, morningExtra: extra };
  if (slot === "afternoon") return { ...row, afternoon: time, afternoonExtra: extra };
  return { ...row, night: time, nightExtra: extra };
}

export function timeColumn(slot: Slot): string {
  return TIME_COLUMN[slot];
}

export function extraColumn(slot: Slot): string {
  return EXTRA_COLUMN[slot];
}

export function shiftDate(iso: string, days: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function chooseDose(rows: MedRow[], today: string): { date: string; slot: Slot } | null {
  const started = rows
    .filter((row) => row.date <= today && (row.morning || row.afternoon || row.night))
    .sort((a, b) => a.date.localeCompare(b.date));
  const last = started[started.length - 1];
  if (!last) return { date: today, slot: "morning" };
  for (const slot of SLOTS) {
    if (!last[slot]) return { date: last.date, slot };
  }
  const nextDate = shiftDate(last.date, 1);
  if (nextDate > today) return null;
  return { date: nextDate, slot: "morning" };
}

export function doseChoices(rows: MedRow[], today: string): { date: string; slot: Slot }[] {
  const next = chooseDose(rows, today);
  const anchor = next?.date ?? today;
  const choices = SLOTS.map((slot) => ({ date: anchor, slot }));
  if (anchor !== today) {
    for (const slot of SLOTS) choices.push({ date: today, slot });
  }
  return choices;
}

export function lastTaken(rows: MedRow[]): LastDose | null {
  const filled = rows
    .filter((row) => row.morning || row.afternoon || row.night)
    .sort((a, b) => a.date.localeCompare(b.date));
  const last = filled[filled.length - 1];
  if (!last) return null;
  for (const slot of ["night", "afternoon", "morning"] as const) {
    if (last[slot]) return { date: last.date, slot, time: last[slot] };
  }
  return null;
}

export function rowsForPhone(rows: MedRow[], today: string): MedRow[] {
  return rows.filter((row) => row.date <= today);
}

export function visibleRows(rows: MedRow[], today: string, limit = 14): MedRow[] {
  return rows
    .filter((row) => row.date <= today && (row.morning || row.afternoon || row.night || row.date === today))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, limit);
}

export function dayPhrase(date: string, today: string): string {
  if (date === today) return "today";
  if (date === shiftDate(today, -1)) return "yesterday";
  const [year, month, day] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(new Date(year, month - 1, day));
}

export function localParts(now = new Date()): { date: string; time: string; hour: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(now);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  const date = `${value("year")}-${value("month")}-${value("day")}`;
  const time = normalizeTime(`${value("hour")}:${value("minute")} ${value("dayPeriod")}`);
  return { date, time, hour: now.getHours() };
}

export function assertSlot(value: unknown): Slot {
  if (value === "morning" || value === "afternoon" || value === "night") return value;
  throw new StoreError("Choose morning, afternoon, or night.");
}

export function assertDose(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0.25 || parsed > 3) {
    throw new StoreError("Enter a dose from 0.25 to 3 pills.");
  }
  const rounded = roundPills(parsed);
  if (Math.abs(rounded * 4 - Math.round(rounded * 4)) > 0.001) {
    throw new StoreError("Use quarter-pill steps, such as 0.5 or 1.");
  }
  return rounded;
}

export function assertLogDate(date: string, now = new Date()): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new StoreError("That date isn't valid.");
  const [year, month, day] = date.split("-").map(Number);
  const utc = Date.UTC(year, month - 1, day);
  const check = new Date(utc);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    throw new StoreError("That date isn't valid.");
  }
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  if (Math.abs(utc - today) > 14 * 86400000) throw new StoreError("That date is too far from today.");
  return date;
}

export function assertTime(value: unknown): string {
  const time = typeof value === "string" ? normalizeTime(value) : "";
  if (!time) throw new StoreError("That time isn't valid.");
  return time;
}

export function assertPillCount(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 10000) {
    throw new StoreError("Enter the number of pills you have, from 0 to 10000.");
  }
  return roundPills(parsed);
}

export function formatBaseline(value: number): string {
  const rounded = roundPills(value);
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

export function pillsFormula(baseline: number, lastRow = LAST_ROW): string {
  return `=${formatBaseline(baseline)}-0.5*(COUNT(B6:B${lastRow})+COUNT(C6:C${lastRow})+COUNT(D6:D${lastRow}))-SUM(F6:F${lastRow})-SUM(G6:G${lastRow})-SUM(H6:H${lastRow})`;
}

export function dosesFormula(baseline: number, lastRow = LAST_ROW): string {
  return `=${formatBaseline(baseline)}-(COUNT(B6:B${lastRow})+COUNT(C6:C${lastRow})+COUNT(D6:D${lastRow}))`;
}

export function takenFormula(baseline: number, lastRow = LAST_ROW): string {
  return `=${formatBaseline(baseline)}+(COUNT(B6:B${lastRow})+COUNT(C6:C${lastRow})+COUNT(D6:D${lastRow}))`;
}

export function parsePillsFormula(formula: string): { baseline: number; lastRow: number; tracksExtras: boolean } | null {
  const match = /^=(-?\d+(?:\.\d+)?)-0\.5\*\(COUNT\(B6:B(\d+)\)\+COUNT\(C6:C\2\)\+COUNT\(D6:D\2\)\)(-SUM\(F6:F\2\)-SUM\(G6:G\2\)-SUM\(H6:H\2\))?$/.exec(
    formula.replace(/\s+/g, ""),
  );
  if (!match) return null;
  return { baseline: Number(match[1]), lastRow: Number(match[2]), tracksExtras: Boolean(match[3]) };
}

export function parseSignedCountFormula(formula: string, sign: "+" | "-"): { baseline: number; lastRow: number } | null {
  const escaped = sign === "+" ? "\\+" : "-";
  const match = new RegExp(
    `^=(-?\\d+(?:\\.\\d+)?)${escaped}\\(COUNT\\(B6:B(\\d+)\\)\\+COUNT\\(C6:C\\2\\)\\+COUNT\\(D6:D\\2\\)\\)$`,
  ).exec(formula.replace(/\s+/g, ""));
  if (!match) return null;
  return { baseline: Number(match[1]), lastRow: Number(match[2]) };
}

export function baselineForDesiredPills(desired: number, doses: number, extras: number): number {
  return roundPills(desired + 0.5 * doses + extras);
}

export const DEFAULT_USUAL: UsualDoses = { morning: 0.5, afternoon: 0.5, night: 0.5 };
