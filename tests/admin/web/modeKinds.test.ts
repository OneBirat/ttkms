import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cleanModeInput,
  EDITABLE_KINDS,
  MODE_KINDS,
  modeError,
  usedFor,
} from "../../../web/components/admin/modeKinds.ts";

test("four editable kinds plus cash, each with its own details wording", () => {
  assert.deepEqual([...EDITABLE_KINDS], ["bank", "wallet", "qr", "cheque"]);
  assert.equal(MODE_KINDS.bank.detailsLabel, "Account number");
  assert.equal(MODE_KINDS.wallet.detailsLabel, "Wallet ID / phone");
  assert.equal(MODE_KINDS.cash.symbol, "Rs");
});

test("usedFor renders the uses the way the table shows them", () => {
  assert.equal(usedFor({ use_salary: true, use_advance: true }), "Salary · Advance");
  assert.equal(usedFor({ use_salary: false, use_advance: true }), "Advance");
  assert.equal(usedFor({ use_salary: false, use_advance: false }), "—");
});

test("modeError mirrors the API rules", () => {
  const base = { type: "bank" as const, name: "NIC Asia", details: null, use_salary: true, use_advance: true };
  assert.equal(modeError(base), null);
  assert.equal(modeError({ ...base, name: "   " }), "Name is required.");
  assert.equal(
    modeError({ ...base, use_salary: false, use_advance: false }),
    "Pick at least one use: salary payments or advances.",
  );
  assert.ok(modeError({ ...base, name: "x".repeat(81) }));
});

test("cleanModeInput trims and nulls empty details", () => {
  const cleaned = cleanModeInput({
    type: "wallet",
    name: "  eSewa   wallet ",
    details: "   ",
    use_salary: false,
    use_advance: true,
  });
  assert.equal(cleaned.name, "eSewa wallet");
  assert.equal(cleaned.details, null);
  assert.equal(cleanModeInput({ ...cleaned, details: " A/c 1 " }).details, "A/c 1");
});
