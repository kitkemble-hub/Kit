import { requireIdentity } from "../../cursor/identity.js";
import { StoreError } from "./errors";
import { assertDose, assertLogDate, assertPillCount, assertSlot, assertTime, type Snapshot } from "./meds";
import { correctPills, readState, recordDose, undoDose } from "./store";

const headers = { "content-type": "application/json", "cache-control": "private, no-store" };
const hits = new Map<string, number[]>();

type Person = { sub: string; kind: string; stage?: string };

export async function getState(request: Request): Promise<Response> {
  const blocked = crossSite(request);
  if (blocked) return blocked;
  const viewer = await person(request);
  if (viewer instanceof Response) return viewer;
  const today = todayFrom(request);
  try {
    return json(await readState(scope(viewer), stageOf(viewer), today));
  } catch (error) {
    return fail(error);
  }
}

export async function postDose(request: Request): Promise<Response> {
  const blocked = crossSite(request, true);
  if (blocked) return blocked;
  const viewer = await person(request);
  if (viewer instanceof Response) return viewer;
  if (!allow(viewer.sub)) return json({ error: "Too many doses at once. Wait a moment." }, 429);
  const body = await readBody(request);
  if (body instanceof Response) return body;
  try {
    const record = body as { slot?: unknown; dose?: unknown; date?: unknown; time?: unknown; today?: unknown; place?: unknown };
    const place = record.place === "chosen" ? "chosen" : "next";
    const today = assertLogDate(typeof record.today === "string" ? record.today : typeof record.date === "string" ? record.date : "");
    const date = place === "chosen" ? assertLogDate(typeof record.date === "string" ? record.date : "") : today;
    const snapshot = await recordDose(scope(viewer), stageOf(viewer), today, {
      slot: assertSlot(record.slot),
      dose: assertDose(record.dose),
      date,
      time: assertTime(record.time),
      place,
    });
    return json(snapshot);
  } catch (error) {
    return fail(error);
  }
}

export async function postPills(request: Request): Promise<Response> {
  const blocked = crossSite(request, true);
  if (blocked) return blocked;
  const viewer = await person(request);
  if (viewer instanceof Response) return viewer;
  if (!allow(viewer.sub)) return json({ error: "Too many updates. Wait a moment." }, 429);
  const body = await readBody(request);
  if (body instanceof Response) return body;
  const today = typeof (body as { today?: unknown }).today === "string" ? (body as { today: string }).today : "";
  try {
    return json(await correctPills(scope(viewer), stageOf(viewer), assertLogDate(today), assertPillCount((body as { pills?: unknown }).pills)));
  } catch (error) {
    return fail(error);
  }
}

export async function postUndo(request: Request): Promise<Response> {
  const blocked = crossSite(request, true);
  if (blocked) return blocked;
  const viewer = await person(request);
  if (viewer instanceof Response) return viewer;
  const body = await readBody(request);
  if (body instanceof Response) return body;
  const today = typeof (body as { today?: unknown }).today === "string" ? (body as { today: string }).today : "";
  try {
    return json(await undoDose(scope(viewer), stageOf(viewer), assertLogDate(today)));
  } catch (error) {
    return fail(error);
  }
}

async function person(request: Request): Promise<Person | Response> {
  const identity = await requireIdentity(request);
  if (identity instanceof Response) return identity;
  const viewer = identity as Person;
  if (viewer.kind !== "person" || !viewer.sub) return json({ error: "Sign in to record a dose." }, 403);
  return viewer;
}

function stageOf(viewer: Person): string {
  return viewer.stage === "preview" ? "preview" : "production";
}

function scope(viewer: Person): string {
  return stageOf(viewer) === "preview" ? `preview:${viewer.sub}` : viewer.sub;
}

function todayFrom(request: Request): string {
  const today = new URL(request.url).searchParams.get("today") ?? "";
  return /^\d{4}-\d{2}-\d{2}$/.test(today) ? today : new Date().toISOString().slice(0, 10);
}

function crossSite(request: Request, mutating = false): Response | null {
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return json({ error: "Cross-site request blocked." }, 403);
  if (!mutating) return null;
  if (request.headers.get("x-dose-log") !== "1") return json({ error: "Missing app header." }, 403);
  if (!(request.headers.get("content-type") ?? "").includes("application/json")) return json({ error: "Expected JSON." }, 415);
  return null;
}

async function readBody(request: Request): Promise<unknown | Response> {
  const text = await request.text();
  if (text.length > 4000) return json({ error: "That request is too large." }, 413);
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return json({ error: "Expected JSON." }, 400);
  }
}

function allow(sub: string): boolean {
  const now = Date.now();
  const recent = (hits.get(sub) ?? []).filter((time) => now - time < 60_000);
  if (recent.length >= 40) {
    hits.set(sub, recent);
    return false;
  }
  recent.push(now);
  hits.set(sub, recent);
  return true;
}

function fail(error: unknown): Response {
  if (error instanceof StoreError) return json({ error: error.message }, error.status);
  console.error(error instanceof Error ? error.name : "dose request failed");
  return json({ error: "Couldn't save that. Try again." }, 500);
}

function json(body: Snapshot | { error: string }, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers });
}
