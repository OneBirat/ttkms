import { test } from "node:test";
import assert from "node:assert/strict";
import {
  adLongLine,
  bsNepaliLine,
  digitsOnly,
  footerText,
  INVALID_SAVE_TEXT,
  isRowLocked,
  keypadPress,
  rowsValid,
  saveCaption,
  safeAdToBs,
  stockTone,
  switchBlockedNp,
  totalQty,
  TYPE_TEXT,
} from "../entryLogic.ts";

const row = (variationId, qty) => ({ key: 1, variationId, qty, remarks: "" });

test("rows are valid only when every row has an item and a quantity above 0", () => {
  assert.equal(rowsValid([]), false);
  assert.equal(rowsValid([row(null, "")]), false);
  assert.equal(rowsValid([row(4, "")]), false);
  assert.equal(rowsValid([row(4, "0")]), false);
  assert.equal(rowsValid([row(4, "3")]), true);
  assert.equal(rowsValid([row(4, "3"), row(null, "2")]), false);
  assert.equal(totalQty([row(4, "3"), row(5, "12"), row(null, "")]), 15);
});

test("a row locks its item once it has an item and a quantity", () => {
  assert.equal(isRowLocked(row(4, "")), false);
  assert.equal(isRowLocked(row(4, "0")), false);
  assert.equal(isRowLocked(row(null, "5")), false);
  assert.equal(isRowLocked(row(4, "5")), true);
});

test("footer text: no rows, invalid after a save attempt, or count and pcs", () => {
  assert.equal(footerText([], false), "No rows to save");
  assert.equal(footerText([row(4, "")], false), "1 row · 0 pcs");
  assert.equal(footerText([row(4, "")], true), INVALID_SAVE_TEXT);
  assert.equal(footerText([row(4, "24"), row(5, "10")], true), "2 rows · 34 pcs");
  assert.equal(saveCaption([]), "Nothing to save yet");
  assert.equal(saveCaption([row(4, "1")]), "1 item");
  assert.equal(saveCaption([row(4, "1"), row(5, "0")]), "2 items · check highlighted");
});

test("quantities accept digits only; keypad appends up to 5 digits, C clears, del deletes", () => {
  assert.equal(digitsOnly("1a2.3"), "123");
  assert.equal(keypadPress("", "7"), "7");
  assert.equal(keypadPress("0", "7"), "7");
  assert.equal(keypadPress("12345", "6"), "12345");
  assert.equal(keypadPress("123", "del"), "12");
  assert.equal(keypadPress("123", "C"), "");
});

test("stock colour: red at 0, amber at 5 or fewer", () => {
  assert.equal(stockTone(0), "out");
  assert.equal(stockTone(5), "low");
  assert.equal(stockTone(6), "ok");
});

test("date lines: AD weekday + long date, BS Nepali weekday + date, in sync", () => {
  assert.equal(adLongLine("2026-10-20"), "Tuesday, 20 October 2026");
  const bs = safeAdToBs("2026-10-20");
  assert.deepEqual(bs, { year: 2083, month: 7, day: 3 });
  assert.equal(bsNepaliLine(bs), "मंगलबार, कार्तिक ३, २०८३");
  assert.equal(safeAdToBs("1800-01-01"), null);
  assert.equal(safeAdToBs("not a date"), null);
});

test("labels follow the entry type in English and Nepali", () => {
  assert.equal(`${TYPE_TEXT.purchase.add} · ${TYPE_TEXT.purchase.addNp}`, "Add purchase · खरिद थप्नुहोस्");
  assert.equal(`${TYPE_TEXT.consumption.add} · ${TYPE_TEXT.consumption.addNp}`, "Add consumption · खपत थप्नुहोस्");
  assert.equal(TYPE_TEXT.consumption.savedNp, "खपत सेभ भयो");
  assert.equal(switchBlockedNp("purchase"), "पहिले खरिद सेभ गर्नुहोस् वा खाली गर्नुहोस्।");
});
