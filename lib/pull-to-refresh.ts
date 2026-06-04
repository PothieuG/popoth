/**
 * Pure helpers for the pull-to-refresh gesture (components/ui/PullToRefresh.tsx).
 *
 * Extracted so the gesture math is unit-testable in env=node (no jsdom/layout).
 * `findScrollableAncestor` touches the DOM at call time only — it is safe to
 * import in node, just not to call there (test it under jsdom).
 */

export interface DampOptions {
  /** Fraction of finger travel rendered as visible pull (rubber-band feel). */
  resistance: number
  /** Hard cap on the pull distance in px. */
  max: number
}

/**
 * Convert raw downward finger travel (px) into a damped, clamped pull distance.
 * Non-positive travel returns 0 (no upward pull). Result is clamped to [0, max].
 */
export function dampPull(deltaY: number, { resistance, max }: DampOptions): number {
  if (deltaY <= 0) return 0
  return Math.min(deltaY * resistance, max)
}

/** Whether releasing at `distance` px should fire the refresh. */
export function shouldTriggerRefresh(distance: number, threshold: number): boolean {
  return distance >= threshold
}

/**
 * Walk up from `start` up to (but excluding) `boundary` and return the first
 * vertically scrollable ancestor that is actually overflowing
 * (`scrollHeight > clientHeight`). Returns null when none is found — the caller
 * then treats the gesture as starting at the top of the page (pull armed).
 */
export function findScrollableAncestor(
  start: Element | null,
  boundary: Element,
): HTMLElement | null {
  let el: Element | null = start
  while (el && el !== boundary) {
    if (el instanceof HTMLElement) {
      const overflowY = getComputedStyle(el).overflowY
      if ((overflowY === 'auto' || overflowY === 'scroll') && el.scrollHeight > el.clientHeight) {
        return el
      }
    }
    el = el.parentElement
  }
  return null
}
