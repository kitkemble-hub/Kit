import { sql, withTransaction, type Query } from "./db";
import { StoreError } from "./errors";
import {
  blankRow,
  extraForDose,
  recordedDose,
  roundPills,
  rowsForPhone,
  usualDose,
  withDose,
  DEFAULT_USUAL,
  type MedRow,
  type Slot,
  type Snapshot,
} from "./meds";

const UNDO_MS = 2 * 60 * 1000;

type DbUndo = {
  mode: "database";
  at: string;
  pillsOnHand: number | null;
  date: string;
  previous: MedRow | null;
};

type ViewerRow = {
  pills_on_hand: number | null;
  usual_morning: number | string;
  usual_afternoon: number | string;
  usual_night: number | string;
};

type DayRow = {
  day: string;
  morning: string;
  afternoon: string;
  night: string;
  morning_extra: number | string;
  afternoon_extra: number | string;
  night_extra: number | string;
};

export async function readDatabase(owner: string, today: string): Promise<Snapshot> {
  await ensureViewer(owner);
  const viewer = await oneViewer(owner);
  const days = await sql<DayRow>("select day, morning, afternoon, night, morning_extra, afternoon_extra, night_extra from dose_days where sub = $1 order by day", [owner]);
  return toSnapshot(viewer, days.map(mapDay), today, await readUndo(owner));
}

export async function logInDatabase(
  owner: string,
  today: string,
  input: { slot: Slot; dose: number; date: string; time: string },
): Promise<Snapshot> {
  await withTransaction(async (query) => {
    await ensureViewer(owner, query);
    const viewer = await lockViewer(owner, query);
    const existing = await query<DayRow>("select day, morning, afternoon, night, morning_extra, afternoon_extra, night_extra from dose_days where sub = $1 and day = $2", [owner, input.date]);
    const current = existing[0] ? mapDay(existing[0]) : null;
    const row = current ?? blankRow(input.date, 0);
    const previousDose = current?.[input.slot] ? recordedDose(row, input.slot) : 0;
    const next = withDose(row, input.slot, input.time, input.dose);
    if (current && current[input.slot] === input.time && (extraForDose(input.dose) ?? 0) === extraOf(current, input.slot)) return;
    const delta = current?.[input.slot] ? input.dose - previousDose : input.dose;
    const pills = viewer.pills_on_hand == null ? null : roundPills(Number(viewer.pills_on_hand) - delta);
    await query(
      `insert into dose_days (sub, day, morning, afternoon, night, morning_extra, afternoon_extra, night_extra)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       on conflict (sub, day) do update set
         morning = excluded.morning,
         afternoon = excluded.afternoon,
         night = excluded.night,
         morning_extra = excluded.morning_extra,
         afternoon_extra = excluded.afternoon_extra,
         night_extra = excluded.night_extra`,
      [owner, input.date, next.morning, next.afternoon, next.night, next.morningExtra, next.afternoonExtra, next.nightExtra],
    );
    await query("update viewers set pills_on_hand = $2 where sub = $1", [owner, pills]);
    const payload: DbUndo = {
      mode: "database",
      at: new Date().toISOString(),
      pillsOnHand: viewer.pills_on_hand == null ? null : Number(viewer.pills_on_hand),
      date: input.date,
      previous: current,
    };
    await query(
      `insert into dose_undo (sub, payload, created_at) values ($1, $2, now())
       on conflict (sub) do update set payload = excluded.payload, created_at = now()`,
      [owner, JSON.stringify(payload)],
    );
  });
  return readDatabase(owner, today);
}

export async function setDatabasePills(owner: string, today: string, pills: number): Promise<Snapshot> {
  await ensureViewer(owner);
  await sql("update viewers set pills_on_hand = $2 where sub = $1", [owner, pills]);
  await sql("delete from dose_undo where sub = $1", [owner]);
  return readDatabase(owner, today);
}

export async function undoDatabase(owner: string, today: string): Promise<Snapshot> {
  const undo = await readUndo(owner);
  if (!undo) throw new StoreError("Nothing to undo.");
  await withTransaction(async (query) => {
    await query("update viewers set pills_on_hand = $2 where sub = $1", [owner, undo.pillsOnHand]);
    if (!undo.previous) {
      await query("delete from dose_days where sub = $1 and day = $2", [owner, undo.date]);
    } else {
      const previous = undo.previous;
      await query(
        `insert into dose_days (sub, day, morning, afternoon, night, morning_extra, afternoon_extra, night_extra)
         values ($1, $2, $3, $4, $5, $6, $7, $8)
         on conflict (sub, day) do update set
           morning = excluded.morning,
           afternoon = excluded.afternoon,
           night = excluded.night,
           morning_extra = excluded.morning_extra,
           afternoon_extra = excluded.afternoon_extra,
           night_extra = excluded.night_extra`,
        [owner, previous.date, previous.morning, previous.afternoon, previous.night, previous.morningExtra, previous.afternoonExtra, previous.nightExtra],
      );
    }
    await query("delete from dose_undo where sub = $1", [owner]);
  });
  return readDatabase(owner, today);
}

function extraOf(row: MedRow, slot: Slot): number {
  if (slot === "morning") return row.morningExtra;
  if (slot === "afternoon") return row.afternoonExtra;
  return row.nightExtra;
}

function mapDay(row: DayRow): MedRow {
  return {
    row: 0,
    date: String(row.day).slice(0, 10),
    morning: row.morning ?? "",
    afternoon: row.afternoon ?? "",
    night: row.night ?? "",
    morningExtra: Number(row.morning_extra) || 0,
    afternoonExtra: Number(row.afternoon_extra) || 0,
    nightExtra: Number(row.night_extra) || 0,
  };
}

function toSnapshot(viewer: ViewerRow, rows: MedRow[], today: string, undo: DbUndo | null): Snapshot {
  return {
    source: "database",
    pillsOnHand: viewer.pills_on_hand == null ? null : Number(viewer.pills_on_hand),
    dosesRemaining: null,
    totalTaken: null,
    usual: {
      morning: usualDose(viewer.usual_morning),
      afternoon: usualDose(viewer.usual_afternoon),
      night: usualDose(viewer.usual_night),
    },
    rows: rowsForPhone(rows, today),
    spreadsheetUrl: null,
    undoAvailable: undo !== null,
  };
}

async function ensureViewer(owner: string, query: Query = sql): Promise<void> {
  await query("insert into viewers (sub) values ($1) on conflict (sub) do nothing", [owner]);
}

async function oneViewer(owner: string): Promise<ViewerRow> {
  const rows = await sql<ViewerRow>("select pills_on_hand, usual_morning, usual_afternoon, usual_night from viewers where sub = $1", [owner]);
  return rows[0] ?? { pills_on_hand: null, ...DEFAULT_USUAL_ROW };
}

async function lockViewer(owner: string, query: Query): Promise<ViewerRow> {
  const rows = await query<ViewerRow>("select pills_on_hand, usual_morning, usual_afternoon, usual_night from viewers where sub = $1 for update", [owner]);
  if (!rows[0]) throw new StoreError("The dose log could not be opened.");
  return rows[0];
}

const DEFAULT_USUAL_ROW = { usual_morning: DEFAULT_USUAL.morning, usual_afternoon: DEFAULT_USUAL.afternoon, usual_night: DEFAULT_USUAL.night };

async function readUndo(owner: string): Promise<DbUndo | null> {
  const rows = await sql<{ payload: string; created_at: string | Date }>("select payload, created_at from dose_undo where sub = $1", [owner]);
  const row = rows[0];
  if (!row) return null;
  const created = new Date(row.created_at).getTime();
  if (!Number.isFinite(created) || Date.now() - created > UNDO_MS) return null;
  const payload = JSON.parse(row.payload) as DbUndo;
  return payload.mode === "database" ? payload : null;
}
