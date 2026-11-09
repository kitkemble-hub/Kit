"use client";

import { useCallback, useEffect, useState } from "react";
import {
  SLOT_LABEL,
  chooseDose,
  dayPhrase,
  doseChoices,
  formatPills,
  lastTaken,
  localParts,
  recordedDose,
  roundPills,
  visibleRows,
  type Slot,
  type Snapshot,
} from "../src/lib/meds";

type Selection = { date: string; slot: Slot };

export function DoseApp() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [manual, setManual] = useState<Selection | null>(null);
  const [clock, setClock] = useState(() => new Date());
  const [doseText, setDoseText] = useState("0.5");
  const [dirty, setDirty] = useState(false);
  const [editingPills, setEditingPills] = useState(false);
  const [pillText, setPillText] = useState("");

  const load = useCallback(async () => {
    const { date } = localParts();
    const response = await fetch(`/api/state?today=${date}`);
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Couldn't load the log.");
    setSnapshot(body);
    setError("");
  }, []);

  useEffect(() => {
    load().catch((reason: Error) => setError(reason.message));
  }, [load]);

  useEffect(() => {
    const timer = setInterval(() => setClock(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const today = localParts(clock).date;
  const nextSpace = snapshot ? chooseDose(snapshot.rows, today) : null;
  const selection = manual ?? nextSpace;
  const selectedDate = selection?.date ?? "";
  const selectedSlot = selection?.slot;

  useEffect(() => {
    if (!snapshot || !selectedSlot || dirty) return;
    const row = snapshot.rows.find((item) => item.date === selectedDate);
    const amount = row?.[selectedSlot] ? recordedDose(row, selectedSlot) : snapshot.usual[selectedSlot];
    setDoseText(formatPills(amount));
  }, [snapshot, selectedDate, selectedSlot, dirty]);
  const latest = snapshot ? lastTaken(snapshot.rows) : null;
  const shown = snapshot ? visibleRows(snapshot.rows, today) : [];

  function select(next: Selection) {
    setDirty(false);
    setManual(next);
    setError("");
  }

  function cycle() {
    if (!snapshot) return;
    const choices = doseChoices(snapshot.rows, localParts().date);
    const index = choices.findIndex((choice) => choice.date === selection?.date && choice.slot === selection.slot);
    select(choices[(index + 1) % choices.length]);
  }

  function bump(delta: number) {
    const current = Number(doseText);
    const next = Math.min(3, Math.max(0.25, roundPills((Number.isFinite(current) ? current : 0.5) + delta)));
    setDoseText(formatPills(next));
    setDirty(true);
  }

  async function record() {
    const now = localParts();
    const target = manual ?? (snapshot ? chooseDose(snapshot.rows, now.date) : null);
    if (!target) return;
    const dose = Number(doseText);
    setPending(true);
    setError("");
    try {
      const body = await post("/api/dose", {
        ...target,
        dose,
        time: now.time,
        today: now.date,
        place: manual ? "chosen" : "next",
      });
      setSnapshot(body);
      setDirty(false);
      setManual(null);
      setClock(new Date());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Couldn't save that.");
    } finally {
      setPending(false);
    }
  }

  async function undo() {
    setPending(true);
    setError("");
    try {
      const body = await post("/api/undo", { today: localParts().date });
      setSnapshot(body);
      setDirty(false);
      setManual(null);
      setClock(new Date());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Couldn't undo that.");
    } finally {
      setPending(false);
    }
  }

  async function savePills() {
    setPending(true);
    setError("");
    try {
      const body = await post("/api/pills", { pills: Number(pillText), today: localParts().date });
      setSnapshot(body);
      setEditingPills(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Couldn't update the count.");
    } finally {
      setPending(false);
    }
  }

  if (!snapshot && !error) {
    return <main className="phone"><p className="eyebrow">Dose</p><p>Loading the log.</p></main>;
  }

  const row = selection ? snapshot?.rows.find((item) => item.date === selection.date) : undefined;
  const replacing = selection && row?.[selection.slot] ? row[selection.slot] : "";
  const dose = Number(doseText);
  const doseLabel = Number.isFinite(dose) ? formatPills(dose) : doseText;
  const low = snapshot?.pillsOnHand != null && snapshot.pillsOnHand < 5;

  return (
    <main className="phone">
      <p className="eyebrow">Dose</p>
      <p className={low ? "count low" : "count"}>
        {snapshot?.pillsOnHand == null ? "Set the count" : formatPills(snapshot.pillsOnHand)}
        <span> on hand</span>
      </p>
      {snapshot?.dosesRemaining != null && snapshot.totalTaken != null && (
        <p className="meta">{formatPills(snapshot.dosesRemaining)} doses left · {formatPills(snapshot.totalTaken)} taken</p>
      )}
      {snapshot?.pillsOnHand != null && snapshot.pillsOnHand < 0 && (
        <p className="hint">The count is below zero. Set it to the number in the bottle.</p>
      )}
      <button type="button" className="texty" onClick={() => { setPillText(snapshot?.pillsOnHand == null ? "" : formatPills(snapshot.pillsOnHand)); setEditingPills((open) => !open); }}>
        Correct the count
      </button>
      {editingPills && (
        <div className="pills">
          <input inputMode="decimal" aria-label="Pills on hand" value={pillText} onChange={(event) => setPillText(event.target.value)} />
          <button type="button" className="save" onClick={savePills} disabled={pending}>Save</button>
        </div>
      )}

      {selection ? (
        <button type="button" className="dose-button" onClick={record} disabled={pending}>
          <span className="slot">{SLOT_LABEL[selection.slot]}</span>
          <span className="slot-sub">
            {pending ? "Saving" : selection.date === today ? `Subtract ${doseLabel}` : `For ${dayPhrase(selection.date, today)} · subtract ${doseLabel}`}
          </span>
        </button>
      ) : (
        <div className="dose-button done" role="status">
          <span className="slot">Today is logged</span>
          <span className="slot-sub">All three times are filled in</span>
        </div>
      )}

      {selection && (
        <>
          <span className="adjust-label">{selection.date === today ? "Pills this dose" : `Pills for ${dayPhrase(selection.date, today)}`}</span>
          <div className="adjust">
            <button type="button" aria-label="Decrease the dose" onClick={() => bump(-0.5)}>−</button>
            <input
              inputMode="decimal"
              aria-label="Pills to subtract"
              value={doseText}
              onChange={(event) => { setDoseText(event.target.value); setDirty(true); }}
            />
            <button type="button" aria-label="Increase the dose" onClick={() => bump(0.5)}>+</button>
          </div>
          {replacing && <p className="hint">This replaces {replacing}.</p>}
          {snapshot && !dirty && snapshot.usual[selection.slot] !== 0.5 && !replacing && (
            <p className="hint">The copy has this dose at {formatPills(snapshot.usual[selection.slot])}.</p>
          )}
        </>
      )}

      <p className="last">
        <span>Last taken</span>
        {latest ? `${SLOT_LABEL[latest.slot]} · ${dayPhrase(latest.date, today)} at ${latest.time}` : "No dose recorded yet"}
      </p>
      <div className="actions">
        <button type="button" className="texty" onClick={cycle}>Change period</button>
        {snapshot?.undoAvailable && <button type="button" className="undo" onClick={undo} disabled={pending}>Undo last dose</button>}
      </div>

      {shown.length > 0 && (
        <table className="log">
          <caption>Recent doses</caption>
          <thead>
            <tr><th>Date</th><th>Morning</th><th>Afternoon</th><th>Night</th></tr>
          </thead>
          <tbody>
            {shown.map((item) => (
              <tr key={item.date}>
                <th scope="row">{item.date === today ? "Today" : dayPhrase(item.date, today)}</th>
                <td>{cell(item.morning, item.morningExtra)}</td>
                <td>{cell(item.afternoon, item.afternoonExtra)}</td>
                <td>{cell(item.night, item.nightExtra)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {error && <p className="error" role="alert">{error}</p>}
      <p className="hint">Saved with your sign-in. Add this page to your home screen to keep it on your phone.</p>
    </main>
  );
}

function cell(time: string, extra: number) {
  if (!time) return "—";
  if (!extra) return time;
  return <>{time}<span className="amount">{extra > 0 ? `+${formatPills(extra)}` : formatPills(extra)}</span></>;
}

async function post(path: string, body: unknown): Promise<Snapshot> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json", "x-dose-log": "1" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Couldn't save that.");
  return payload as Snapshot;
}
