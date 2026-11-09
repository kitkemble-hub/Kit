import { logInDatabase, readDatabase, setDatabasePills, undoDatabase } from "./db-store";
import { logOnSheet, readSheet, setSheetPills, sheetAccount, undoSheet } from "./sheet-store";
import type { Slot, Snapshot } from "./meds";

const chains = new Map<string, Promise<unknown>>();

export type DoseInput = { slot: Slot; dose: number; date: string; time: string };

export async function readState(owner: string, stage: string, today: string): Promise<Snapshot> {
  return serialize(owner, () => (useSheet(stage) ? readSheet(owner, today) : readDatabase(owner, today)));
}

export async function recordDose(owner: string, stage: string, today: string, input: DoseInput): Promise<Snapshot> {
  return serialize(owner, () => (useSheet(stage) ? logOnSheet(owner, today, input) : logInDatabase(owner, today, input)));
}

export async function correctPills(owner: string, stage: string, today: string, pills: number): Promise<Snapshot> {
  return serialize(owner, () => (useSheet(stage) ? setSheetPills(owner, today, pills) : setDatabasePills(owner, today, pills)));
}

export async function undoDose(owner: string, stage: string, today: string): Promise<Snapshot> {
  return serialize(owner, () => (useSheet(stage) ? undoSheet(owner, today) : undoDatabase(owner, today)));
}

function useSheet(stage: string): boolean {
  if (stage === "preview") return false;
  return sheetAccount() !== null;
}

function serialize<T>(owner: string, run: () => Promise<T>): Promise<T> {
  const previous = chains.get(owner) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(run);
  chains.set(owner, next);
  return next;
}
