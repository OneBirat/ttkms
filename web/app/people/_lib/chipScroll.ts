/**
 * A one-line chip row that scrolls sideways (ChipScroller): when to show the fade on the right
 * edge and how a mouse wheel moves it. Pure, unit-tested (__tests__/chipScroll.test.ts).
 */

export interface ScrollBox {
  scrollLeft: number;
  clientWidth: number;
  scrollWidth: number;
}

/** Chips are still hidden past the right edge (1 px of slack for fractional widths). */
export function moreToTheRight(box: ScrollBox): boolean {
  return box.scrollLeft + box.clientWidth < box.scrollWidth - 1;
}

/**
 * How far a wheel event moves the row sideways; 0 leaves the event alone (the page scrolls).
 * A trackpad's sideways swipe (deltaX) scrolls the row by itself, so only an up / down wheel is
 * turned sideways, and only while the row can still move that way.
 */
export function wheelShift(box: ScrollBox, deltaX: number, deltaY: number): number {
  if (deltaY === 0 || Math.abs(deltaX) >= Math.abs(deltaY)) return 0;
  if (box.scrollWidth <= box.clientWidth + 1) return 0;
  if (deltaY < 0 && box.scrollLeft <= 0) return 0;
  if (deltaY > 0 && !moreToTheRight(box)) return 0;
  return deltaY;
}
