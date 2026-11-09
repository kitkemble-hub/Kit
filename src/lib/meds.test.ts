import assert from "node:assert/strict";
import test from "node:test";
import {
  baselineForDesiredPills,
  cellTime,
  chooseDose,
  countedDoses,
  extraForDose,
  fractionToTime,
  lastTaken,
  parseGrid,
  parsePillsFormula,
  pillsFormula,
  recordedDose,
  serialToIso,
  visibleRows,
  type MedRow,
} from "./meds";
import { COPY_SPREADSHEET_ID, ORIGINAL_SPREADSHEET_ID, writableSpreadsheetId } from "./sheet-target";

test("sheet dates and times match the audit log", () => {
  assert.equal(serialToIso(46223), "2026-07-20");
  assert.equal(fractionToTime(0.3229166666666667), "7:45 AM");
  assert.equal(fractionToTime(0.9236111111111112), "10:10 PM");
  assert.equal(cellTime(46026), "");
});

test("the magnesium column is ignored", () => {
  const rows = parseGrid([
    [46223, 0.3229166666666667, 0.5986111111111111, 0.9236111111111112, "10:13 PM", 0, 0, 0],
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].morning, "7:45 AM");
  assert.equal(rows[0].night, "10:10 PM");
  assert.equal(JSON.stringify(rows[0]).includes("10:13"), false);
  assert.equal("magnesium" in rows[0], false);
});

test("pills formula keeps the opening number and half-pill count", () => {
  const parsed = parsePillsFormula(pillsFormula(238.25));
  assert.deepEqual(parsed, { baseline: 238.25, lastRow: 1000, tracksExtras: true });
  assert.equal(baselineForDesiredPills(70.75, 335, 0), 238.25);
  const original = parsePillsFormula("=238.25-0.5*(COUNT(B6:B155)+COUNT(C6:C155)+COUNT(D6:D155))");
  assert.equal(original?.baseline, 238.25);
  assert.equal(original?.tracksExtras, false);
});

test("a higher dose stores only the amount above half a pill", () => {
  assert.equal(extraForDose(0.5), null);
  assert.equal(extraForDose(1), 0.5);
  assert.equal(extraForDose(0.25), -0.25);
});

test("the button advances through the day and remembers the latest slot", () => {
  const today = "2026-11-09";
  const rows: MedRow[] = [
    {
      row: 2,
      date: "2026-11-08",
      morning: "9:58 AM",
      afternoon: "4:20 PM",
      night: "10:08 PM",
      morningExtra: 0,
      afternoonExtra: 0,
      nightExtra: 0,
    },
    {
      row: 3,
      date: today,
      morning: "8:00 AM",
      afternoon: "",
      night: "",
      morningExtra: 0,
      afternoonExtra: 0,
      nightExtra: 0,
    },
  ];
  assert.deepEqual(chooseDose(rows, today, 15), { date: today, slot: "afternoon" });
  assert.equal(chooseDose([{ ...rows[1], afternoon: "2:00 PM", night: "9:00 PM" }], today, 22), null);
  assert.deepEqual(chooseDose([{ ...rows[0], night: "" }], today, 1), { date: "2026-11-08", slot: "night" });
  assert.deepEqual(lastTaken(rows), { date: today, slot: "morning", time: "8:00 AM" });
  assert.equal(recordedDose(rows[1], "morning"), 0.5);
  assert.equal(visibleRows(rows, today).length, 2);
});

test("numeric dose cells are what the sheet counts", () => {
  assert.equal(countedDoses([[46223, 0.3, "", 0.9, "ignored", 0.5]]), 2);
});

test("the original audit sheet id is refused", () => {
  assert.notEqual(COPY_SPREADSHEET_ID, ORIGINAL_SPREADSHEET_ID);
  assert.equal(writableSpreadsheetId(), COPY_SPREADSHEET_ID);
  assert.throws(() => writableSpreadsheetId(ORIGINAL_SPREADSHEET_ID), /never edited/);
});
