import { describe, it, expect, beforeAll } from 'vitest'
import { loadInitPluginHelpers } from '../support/initPlugin'

/**
 * The display formatters in `plugins/init.client.js`.
 *
 * These are pure functions with no test coverage, reached from item pages, the player, download
 * lists and the sleep timer. Nothing here mounts a component or touches a native bridge.
 *
 * Written as behaviour+edge-case characterization, not as defect specs: where a result is odd but
 * arguably intended, it is pinned and labelled rather than asserted as wrong. Where a result is
 * indefensible for any caller, it is a defect spec and says so. No production code is changed on
 * this branch either way.
 */

let $
beforeAll(async () => {
  $ = await loadInitPluginHelpers()
})

describe('$bytesPretty', () => {
  it('formats each magnitude with two decimals by default', () => {
    expect($.$bytesPretty(1024)).toBe('1 KB')
    expect($.$bytesPretty(1536)).toBe('1.5 KB')
    expect($.$bytesPretty(1024 * 1024)).toBe('1 MB')
    expect($.$bytesPretty(1024 * 1024 * 1024 * 2.5)).toBe('2.5 GB')
  })

  it('honours the decimals argument and treats a negative count as zero', () => {
    expect($.$bytesPretty(1536, 0)).toBe('2 KB')
    expect($.$bytesPretty(1536, 3)).toBe('1.5 KB')
    expect($.$bytesPretty(1590, -1)).toBe('2 KB')
  })

  it('has explicit answers for zero, null and NaN', () => {
    expect($.$bytesPretty(0)).toBe('0 Bytes')
    expect($.$bytesPretty(null)).toBe('Invalid Bytes')
    expect($.$bytesPretty(NaN)).toBe('Invalid Bytes')
    expect($.$bytesPretty(undefined)).toBe('Invalid Bytes')
  })

  it('drops a trailing zero rather than padding to the requested decimals', () => {
    // parseFloat(...) after toFixed, so "1.00 KB" becomes "1 KB". Cosmetic, and pinned because it
    // is the kind of thing a well-meaning refactor to Intl.NumberFormat would silently change.
    expect($.$bytesPretty(1024, 2)).toBe('1 KB')
  })

  /**
   * Characterization, not a contract. A negative size produces `NaN undefined`:
   * `Math.log(negative)` is NaN, so the unit index is NaN and `sizes[NaN]` is undefined.
   *
   * Pinned rather than enabled as a failure because no caller is known to produce one - sizes come
   * from the server or from a file on disk. If a source of negative sizes ever appears, this is
   * the spec to convert.
   */
  it('produces NaN undefined for a negative size (characterization)', () => {
    expect($.$bytesPretty(-1024)).toBe('NaN undefined')
  })
})

describe('$elapsedPretty', () => {
  it('uses seconds below a minute', () => {
    expect($.$elapsedPretty(0)).toBe('0 sec')
    expect($.$elapsedPretty(59)).toBe('59 sec')
    expect($.$elapsedPretty(59.9)).toBe('59 sec')
  })

  it('uses minutes up to seventy, then switches to hours', () => {
    // The threshold is 70 minutes, not 60 - so 69 minutes reads as "69 min" rather than "1 hr 9 min".
    expect($.$elapsedPretty(60)).toBe('1 min')
    expect($.$elapsedPretty(69 * 60)).toBe('69 min')
    expect($.$elapsedPretty(70 * 60)).toBe('1 hr 10 min')
  })

  it('omits the minutes component on a whole number of hours', () => {
    expect($.$elapsedPretty(2 * 3600)).toBe('2 hr')
  })

  it('pluralises correctly with full names', () => {
    expect($.$elapsedPretty(60, true)).toBe('1 minute')
    expect($.$elapsedPretty(120, true)).toBe('2 minutes')
    expect($.$elapsedPretty(3600 * 2, true)).toBe('2 hours')
    // 62 minutes, which is still under the 70-minute threshold, so it stays in minutes.
    expect($.$elapsedPretty(3600 + 120, true)).toBe('62 minutes')
    expect($.$elapsedPretty(3600 + 600, true)).toBe('1 hour 10 minutes')
  })

  /**
   * Characterization. `hours` is never singularised in the short form (`'hr'` either way) but is
   * in the long form, and a negative input falls through the `< 60` branch to "-N sec".
   */
  it('reports a negative duration in seconds (characterization)', () => {
    expect($.$elapsedPretty(-90)).toBe('-90 sec')
  })
})

describe('$elapsedPrettyExtended', () => {
  it('builds a compact d/h/m/s string, omitting zero components', () => {
    expect($.$elapsedPrettyExtended(90)).toBe('1m 30s')
    expect($.$elapsedPrettyExtended(3600)).toBe('1h')
    expect($.$elapsedPrettyExtended(3661)).toBe('1h 1m 1s')
    expect($.$elapsedPrettyExtended(86400 + 3600)).toBe('1d 1h')
  })

  it('keeps hours instead of days when useDays is false', () => {
    expect($.$elapsedPrettyExtended(86400 + 3600, false)).toBe('25h')
  })

  it('rounds minutes up when seconds are hidden and the remainder is at least thirty', () => {
    expect($.$elapsedPrettyExtended(90, true, false)).toBe('2m')
    expect($.$elapsedPrettyExtended(80, true, false)).toBe('1m')
  })

  it('returns an empty string for NaN or null rather than a broken string', () => {
    expect($.$elapsedPrettyExtended(NaN)).toBe('')
    expect($.$elapsedPrettyExtended(null)).toBe('')
  })

  it('returns an empty string for zero, which is not the same as "0s"', () => {
    // Every component is falsy, so nothing is pushed. Callers rendering "time left" get a blank
    // rather than a zero - pinned because it is easy to change accidentally.
    expect($.$elapsedPrettyExtended(0)).toBe('')
  })

  it('switches to days past a hundred hours even when useDays is false', () => {
    // `useDays || Math.floor(hours / 24) >= 100` - the override exists so a very large number does
    // not render as an unreadable hour count.
    const seconds = 101 * 24 * 3600
    expect($.$elapsedPrettyExtended(seconds, false)).toBe('101d')
  })
})

describe('$secondsToTimestamp', () => {
  it('omits the hour component below an hour', () => {
    expect($.$secondsToTimestamp(0)).toBe('0:00')
    expect($.$secondsToTimestamp(9)).toBe('0:09')
    expect($.$secondsToTimestamp(75)).toBe('1:15')
  })

  it('includes and zero-pads the hour component at or above an hour', () => {
    expect($.$secondsToTimestamp(3600)).toBe('1:00:00')
    expect($.$secondsToTimestamp(3661)).toBe('1:01:01')
    expect($.$secondsToTimestamp(36000)).toBe('10:00:00')
  })

  it('truncates fractional seconds rather than rounding them up', () => {
    expect($.$secondsToTimestamp(59.9)).toBe('0:59')
  })

  it('does not roll a large hour count over into days', () => {
    expect($.$secondsToTimestamp(100 * 3600)).toBe('100:00:00')
  })

  /**
   * Characterization. A negative position yields `-1:58:30` for -90 seconds: `Math.floor` rounds
   * towards negative infinity, so -90s becomes -2 minutes with +30 seconds left over, then -1
   * hours with +58 minutes left over. The truthy `-1` hour even switches on the hour component,
   * so a position 90 seconds *before* the start renders as if it were over an hour long.
   *
   * Reachable in principle from a seek before zero; callers clamp today. Pinned rather than
   * enabled as a failure so that changing it is a deliberate decision.
   */
  it('produces a nonsensical timestamp for a negative position (characterization)', () => {
    expect($.$secondsToTimestamp(-90)).toBe('-1:58:30')
  })
})

describe('$secondsToTimestampFull', () => {
  it('always renders hh:mm:ss with zero padding', () => {
    expect($.$secondsToTimestampFull(0)).toBe('00:00:00')
    expect($.$secondsToTimestampFull(75)).toBe('00:01:15')
    expect($.$secondsToTimestampFull(3661)).toBe('01:01:01')
  })

  /**
   * **Defect spec.** `59.6` renders as `00:00:60`, which is not a valid timestamp.
   *
   * The method rounds the seconds *before* deriving minutes from the original value:
   *
   *     let _seconds = Math.round(seconds)      // 60
   *     let _minutes = Math.floor(seconds / 60) // 0, from the unrounded input
   *     _seconds -= _minutes * 60               // still 60
   *
   * so the carry never happens (`init.client.js:138-146`). Any duration whose fractional part
   * rounds the seconds up to 60 hits it - roughly one second in every minute of possible inputs.
   *
   * Expected: `00:01:00`. Left failing; the fix belongs on its own branch.
   */
  it('rolls sixty rounded seconds over into the next minute', () => {
    expect($.$secondsToTimestampFull(59.6)).toBe('00:01:00')
  })

  it('rounds down without a carry', () => {
    // The guard on the fix above: rounding must still round.
    expect($.$secondsToTimestampFull(59.4)).toBe('00:00:59')
  })

  it('keeps a three-digit hour count rather than truncating it', () => {
    expect($.$secondsToTimestampFull(100 * 3600)).toBe('100:00:00')
  })
})

describe('$encodeUriPath', () => {
  it('normalises backslashes and escapes only percent and hash', () => {
    expect($.$encodeUriPath('C:\\books\\a.mp3')).toBe('C:/books/a.mp3')
    expect($.$encodeUriPath('/books/100% Real.mp3')).toBe('/books/100%25 Real.mp3')
    expect($.$encodeUriPath('/books/Track #1.mp3')).toBe('/books/Track %231.mp3')
  })

  /**
   * Characterization, and worth knowing given the name. This is *not* a general URI encoder: it
   * leaves spaces, apostrophes, `?` and `&` untouched, handling only the two characters that would
   * break a path used inside a URL. A caller assuming it produces a safe URI component would be
   * wrong.
   */
  it('leaves spaces, apostrophes and query characters alone (characterization)', () => {
    expect($.$encodeUriPath("/books/Wizard's First Rule.mp3")).toBe("/books/Wizard's First Rule.mp3")
    expect($.$encodeUriPath('/books/a?b&c.mp3')).toBe('/books/a?b&c.mp3')
  })
})
