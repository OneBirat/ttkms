import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { moreToTheRight, wheelShift } from "../_lib/chipScroll";

const box = (scrollLeft: number, clientWidth = 400, scrollWidth = 900) => ({ scrollLeft, clientWidth, scrollWidth });

describe("chip row on one line", () => {
  it("fades the right edge only while chips are hidden there", () => {
    assert.equal(moreToTheRight(box(0)), true);
    assert.equal(moreToTheRight(box(499)), false); // 1 px of slack
    assert.equal(moreToTheRight(box(500)), false);
    assert.equal(moreToTheRight(box(0, 400, 400)), false); // everything fits
  });
  it("an up / down wheel moves the row sideways", () => {
    assert.equal(wheelShift(box(0), 0, 100), 100);
    assert.equal(wheelShift(box(200), 0, -100), -100);
  });
  it("leaves the wheel to the page at either end and when everything fits", () => {
    assert.equal(wheelShift(box(0), 0, -100), 0);
    assert.equal(wheelShift(box(500), 0, 100), 0);
    assert.equal(wheelShift(box(0, 400, 400), 0, 100), 0);
  });
  it("leaves a sideways trackpad swipe to the browser", () => {
    assert.equal(wheelShift(box(100), 30, 5), 0);
    assert.equal(wheelShift(box(100), 30, 0), 0);
  });
});
