import { describe, it, expect } from 'vitest'
import TouchEvent from '@/objects/TouchEvent'

/**
 * `objects/TouchEvent` - swipe-gesture classification.
 *
 * Pure geometry over two touch events, used to drive swipe navigation. No coverage, and the
 * threshold and axis-dominance rules are exactly the sort of thing a refactor gets subtly wrong.
 */

const touch = (screenX, screenY) => ({ changedTouches: [{ screenX, screenY }] })

/** Screen coordinates go right and down, so a *leftward* swipe means end.x < start.x. */
const swipe = (fromX, fromY, toX, toY) => new TouchEvent(touch(fromX, fromY), touch(toX, toY))

describe('TouchEvent swipe direction', () => {
  it('detects each direction past the threshold', () => {
    expect(swipe(200, 100, 100, 100).isSwipeLeft()).toBe(true)
    expect(swipe(100, 100, 200, 100).isSwipeRight()).toBe(true)
    expect(swipe(100, 200, 100, 100).isSwipeUp()).toBe(true)
    expect(swipe(100, 100, 100, 200).isSwipeDown()).toBe(true)
  })

  it('reports no direction for a movement under the threshold', () => {
    expect(swipe(100, 100, 60, 100).getSwipeDirection()).toBeNull()
    expect(swipe(100, 100, 100, 140).getSwipeDirection()).toBeNull()
  })

  it('treats exactly the threshold as a swipe', () => {
    // SWPIE_THRESHOLD is 50 and the comparison is >=, so 50 counts and 49 does not.
    expect(swipe(150, 100, 100, 100).isSwipeLeft()).toBe(true)
    expect(swipe(149, 100, 100, 100).getSwipeDirection()).toBeNull()
  })

  it('reports no direction when the touch did not move', () => {
    expect(swipe(100, 100, 100, 100).getSwipeDirection()).toBeNull()
  })

  it('lets the dominant axis decide when both axes moved', () => {
    // Horizontal 100, vertical 60 -> horizontal wins.
    expect(swipe(200, 200, 100, 140).isSwipeLeft()).toBe(true)
    // Horizontal 60, vertical 100 -> vertical wins.
    expect(swipe(200, 200, 140, 100).isSwipeUp()).toBe(true)
  })

  it('only ever reports one direction at a time', () => {
    const diagonal = swipe(200, 200, 100, 140)

    expect(diagonal.isSwipeLeft()).toBe(true)
    expect(diagonal.isSwipeRight()).toBe(false)
    expect(diagonal.isSwipeUp()).toBe(false)
    expect(diagonal.isSwipeDown()).toBe(false)
  })

  /**
   * Characterization of the tie-breaking rule. When both axes move by exactly the same amount the
   * `>` test fails and control falls into the vertical branch, so a perfect 45-degree swipe is
   * always classified vertically. Arbitrary but deterministic, and worth pinning because switching
   * the comparison to `>=` would silently flip every diagonal gesture.
   */
  it('classifies a perfectly diagonal swipe as vertical (characterization)', () => {
    expect(swipe(200, 200, 100, 100).isSwipeUp()).toBe(true)
    expect(swipe(200, 200, 300, 300).isSwipeDown()).toBe(true)
  })

  it('accepts an end event supplied after construction', () => {
    const event = new TouchEvent(touch(200, 100))
    event.setEndEvent(touch(100, 100))

    expect(event.isSwipeLeft()).toBe(true)
  })

  /**
   * **Defect spec.** Asking for a direction before the end event arrives throws
   * `TypeError: Cannot read properties of null (reading 'changedTouches')`.
   *
   * The guard that looks like it covers this:
   *
   *     let start = this.startEvent.changedTouches[0]
   *     let end = this.endEvent.changedTouches[0]     // throws here when endEvent is null
   *     if (!start || !end) return null               // never reached
   *
   * (`TouchEvent.js:31-36`). The null check sits *after* the dereference it is meant to protect,
   * so it can only ever catch an empty `changedTouches`, never a missing end event.
   *
   * Reachable by design, not by accident: the constructor's second parameter is optional and
   * defaults to `null`, and `setEndEvent` exists precisely so the end can be supplied later - so
   * "constructed but not yet ended" is an intended state of this object. Any handler that checks
   * the direction on `touchmove`, or after a cancelled gesture, hits it.
   *
   * Expected: `null` - no end event means no direction yet.
   * Observed: throws.
   *
   * Left failing; the fix belongs on its own branch.
   */
  it('reports no direction instead of throwing when the end event has not arrived', () => {
    const event = new TouchEvent(touch(200, 100))

    expect(event.getSwipeDirection()).toBeNull()
  })

  it('reports no direction when a touch list is empty', () => {
    // The case the existing guard does cover.
    const event = new TouchEvent({ changedTouches: [] }, { changedTouches: [] })

    expect(event.getSwipeDirection()).toBeNull()
  })
})
