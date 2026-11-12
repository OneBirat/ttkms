import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canBulk, clockText, editableUntilText, isEditable, isLockedError, lockLine, LOCKED_MARK, rowAccess } from "../lock";
import type { DayLock } from "../types";

const OPEN: DayLock = { mode: "open", is_today: true, can_create: true, date_label: "Kartik 15, 2083", message: "" };
const LOCKED: DayLock = {
  mode: "locked",
  is_today: false,
  can_create: false,
  date_label: "Kartik 14, 2083",
  message: "Locked · Kartik 14, 2083 · Only the super admin can change past attendance.",
};

// Saved 31 Oct 2026 09:45 Nepal time (04:00 UTC); editable until the same time on 1 Nov.
const UNTIL = "2026-11-01T04:00:00Z";
const fresh = { locked: false, editable_until: UNTIL };
const before = Date.parse("2026-11-01T03:00:00Z"); // 23 h after the save
const after = Date.parse("2026-11-01T04:01:00Z"); // 24 h 01 min after

describe("attendance lock (what the screens show)", () => {
  it("today: every row can be marked and changed, bulk works", () => {
    assert.equal(rowAccess(OPEN, null), "edit");
    assert.equal(rowAccess(OPEN, fresh, after), "edit");
    assert.equal(canBulk(OPEN), true);
    assert.equal(rowAccess(undefined, null), "edit"); // the node tests' mock has no lock
  });

  it("a past day: nobody is newly marked, bulk is off", () => {
    assert.equal(rowAccess(LOCKED, null), "locked");
    assert.equal(canBulk(LOCKED), false);
  });

  it("a mark stays changeable for 24 hours from its first save, then locks", () => {
    assert.equal(isEditable(fresh, before), true);
    assert.equal(rowAccess(LOCKED, fresh, before), "edit");
    assert.equal(isEditable(fresh, after), false);
    assert.equal(rowAccess(LOCKED, fresh, after), "locked");
    // The server's verdict wins even when this device's clock is behind.
    assert.equal(rowAccess(LOCKED, { locked: true, editable_until: UNTIL }, before), "locked");
  });

  it("says until when a mark can be changed, in Nepal time with the BS date", () => {
    assert.equal(clockText(UNTIL), "9:45 AM");
    assert.equal(clockText("2026-11-01T12:30:00Z"), "6:15 PM");
    assert.equal(clockText("2026-10-31T18:20:00Z"), "12:05 AM");
    assert.equal(editableUntilText(fresh, before), "Editable until 9:45 AM, Kartik 15, 2083");
    assert.equal(editableUntilText(fresh, after), null);
    assert.equal(editableUntilText(null), null);
  });

  it("the line in the ⋮ sheet / detail", () => {
    assert.equal(lockLine(OPEN, fresh, before), "Editable until 9:45 AM, Kartik 15, 2083");
    assert.equal(lockLine(LOCKED, fresh, before), "Editable until 9:45 AM, Kartik 15, 2083");
    assert.equal(lockLine(LOCKED, fresh, after), LOCKED_MARK);
    assert.equal(lockLine(LOCKED, null), LOCKED_MARK);
    assert.equal(lockLine(OPEN, null), null);
  });

  it("recognises the API's attendance_locked answer", () => {
    assert.equal(isLockedError({ code: "attendance_locked" }), true);
    assert.equal(isLockedError({ code: "future_date" }), false);
    assert.equal(isLockedError(new Error("x")), false);
    assert.equal(isLockedError(null), false);
  });
});
