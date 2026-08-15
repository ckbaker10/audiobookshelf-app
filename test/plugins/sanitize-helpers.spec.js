import { describe, it, expect, beforeAll } from 'vitest'
import { loadInitPluginHelpers } from '../support/initPlugin'

/**
 * The sanitizers and encoders in `plugins/init.client.js`.
 *
 * `$sanitizeFilename` decides what a downloaded file is called on disk, so its edge cases are the
 * ones that produce unopenable files, collisions, or a crash mid-download. `$sanitizeSlug`,
 * `$encode`/`$decode` and `$xmlToJson` are pure string handling with no coverage at all.
 *
 * Behaviour and edge-case tests. Where a result is odd but defensible it is pinned as a
 * characterization; where it is indefensible for any caller it is a defect spec and says so. No
 * production code is changed on this branch.
 */

let $
beforeAll(async () => {
  $ = await loadInitPluginHelpers()
})

describe('$sanitizeFilename', () => {
  it('leaves an ordinary filename alone', () => {
    expect($.$sanitizeFilename('Wizards First Rule.mp3')).toBe('Wizards First Rule.mp3')
  })

  it('rejects a non-string input rather than coercing it', () => {
    expect($.$sanitizeFilename(null)).toBe(false)
    expect($.$sanitizeFilename(undefined)).toBe(false)
    expect($.$sanitizeFilename(42)).toBe(false)
    expect($.$sanitizeFilename({})).toBe(false)
  })

  it('strips characters that are illegal in a filename', () => {
    expect($.$sanitizeFilename('a/b\\c<d>e*f|g"h.mp3')).toBe('abcdefgh.mp3')
  })

  it('strips control characters and line breaks', () => {
    expect($.$sanitizeFilename('ChapterOne\nTwo\rThree.mp3')).toBe('ChapterOneTwoThree.mp3')
  })

  it('replaces a colon with the configured replacement', () => {
    // Note the double space: the replacement is ' - ' and the space that followed the colon in the
    // title is kept, so "Book: Subtitle" becomes "Book -  Subtitle". Cosmetic, but it is what
    // lands on disk, and it is the sort of thing a later "tidy up whitespace" change would alter
    // without realising a filename is involved.
    expect($.$sanitizeFilename('Book: Subtitle.mp3')).toBe('Book -  Subtitle.mp3')
    expect($.$sanitizeFilename('Book: Subtitle.mp3', '_')).toBe('Book_ Subtitle.mp3')
  })

  it('removes trailing dots and spaces, which Windows will not store', () => {
    expect($.$sanitizeFilename('Chapter One...')).toBe('Chapter One')
    expect($.$sanitizeFilename('Chapter One   ')).toBe('Chapter One')
  })

  it('blanks a Windows reserved device name', () => {
    expect($.$sanitizeFilename('con')).toBe('')
    expect($.$sanitizeFilename('LPT1.mp3')).toBe('')
    expect($.$sanitizeFilename('nul.txt')).toBe('')
  })

  it('blanks a name that is only dots', () => {
    expect($.$sanitizeFilename('..')).toBe('')
  })

  /**
   * Characterization. Only the **first** colon is *replaced* - `String.replace` with a string
   * pattern is not global, unlike the regex passes around it (`init.client.js:165`). Later colons
   * are not left in place, though: `:` is also in `illegalRe`, so they are silently **deleted**.
   *
   * The upshot is inconsistent: "A: B: C" becomes "A -  B C". The first separator is preserved as
   * punctuation and the second is destroyed, which is a strange thing for two identical characters
   * in one title to do. Pinned rather than called a defect, because the inline comment says
   * "Replace first occurrence of a colon" and may well be deliberate.
   */
  it('replaces the first colon and deletes any later ones (characterization)', () => {
    expect($.$sanitizeFilename('A: B: C.mp3')).toBe('A -  B C.mp3')
  })

  /**
   * **Defect spec.** A filename longer than 240 characters throws
   * `ReferenceError: Path is not defined`.
   *
   * The truncation branch calls `Path.extname(...)` and `Path.basename(...)`
   * (`init.client.js:175-176`), but `Path` is never imported into that module - the import list at
   * the top has no `path` entry of any casing. The branch is simply unreachable without throwing.
   *
   * Inputs: any name over `MAX_FILENAME_LEN` (240). Long titles with series and subtitle are
   * realistic, and the value exists specifically to handle them.
   *
   * Expected: a truncated name that keeps its extension.
   * Observed: the helper throws, out of a download path that has no catch for it.
   *
   * Left failing; the fix belongs on its own branch.
   */
  it('truncates an over-long filename instead of throwing', () => {
    const longName = `${'a'.repeat(300)}.mp3`

    const sanitized = $.$sanitizeFilename(longName)

    expect(typeof sanitized).toBe('string')
    expect(sanitized.length).toBeLessThanOrEqual(240)
    expect(sanitized.endsWith('.mp3')).toBe(true)
  })

  it('does not truncate a name that is exactly at the limit', () => {
    // The guard on the fix: the boundary itself must stay untouched.
    const atLimit = 'a'.repeat(240)

    expect($.$sanitizeFilename(atLimit)).toBe(atLimit)
  })
})

describe('$sanitizeSlug', () => {
  it('lowercases, trims and hyphenates', () => {
    expect($.$sanitizeSlug('  Wizards First Rule  ')).toBe('wizards-first-rule')
  })

  it('transliterates accented characters', () => {
    expect($.$sanitizeSlug('Café')).toBe('cafe')
    expect($.$sanitizeSlug('Señor')).toBe('senor')
  })

  it('collapses repeated whitespace and dashes', () => {
    expect($.$sanitizeSlug('a    b')).toBe('a-b')
    expect($.$sanitizeSlug('a---b')).toBe('a-b')
  })

  it('returns an empty string for empty or nullish input', () => {
    expect($.$sanitizeSlug('')).toBe('')
    expect($.$sanitizeSlug(null)).toBe('')
    expect($.$sanitizeSlug(undefined)).toBe('')
  })

  /**
   * Characterization. Only the **first** dot becomes a dash, for the same non-global
   * `String.replace` reason as the colon in `$sanitizeFilename` (`:245`). Later dots are *not*
   * removed either - see the character-range quirk below - so `a.b.c` becomes `a-b.c`: one
   * separator converted, the next left as a literal dot in a slug.
   */
  it('converts only the first dot to a dash and leaves the rest (characterization)', () => {
    expect($.$sanitizeSlug('a.b.c')).toBe('a-b.c')
  })

  /**
   * Characterization of a character-class quirk. The "remove invalid chars" pass is
   * `/[^a-z0-9 -_]/g`; inside a class, `-` between a space and `_` is a **range** (0x20-0x5F), not
   * a literal. That range covers digits, punctuation and uppercase letters, so several characters
   * the rule appears to forbid actually survive.
   */
  it('keeps characters the invalid-char range unintentionally admits (characterization)', () => {
    expect($.$sanitizeSlug('a+b')).toBe('a+b')
    expect($.$sanitizeSlug('a(b)c')).toBe('a(b)c')
    // A literal dot survives for the same reason, which is what makes the spec above look odd.
    expect($.$sanitizeSlug('a.b')).toBe('a-b')
    expect($.$sanitizeSlug('ab.cd.ef')).toBe('ab-cd.ef')
  })
})

describe('$encode / $decode', () => {
  it('round-trips plain text', () => {
    expect($.$decode($.$encode('Wizards First Rule'))).toBe('Wizards First Rule')
  })

  it('round-trips characters that are unsafe in a URL', () => {
    const raw = 'a/b+c=d&e?f#g'

    expect($.$decode($.$encode(raw))).toBe(raw)
  })

  it('round-trips non-ascii text', () => {
    expect($.$decode($.$encode('Café ☕ 日本語'))).toBe('Café ☕ 日本語')
  })

  it('round-trips an empty string', () => {
    expect($.$decode($.$encode(''))).toBe('')
  })

  it('produces a value safe to place in a url', () => {
    const encoded = $.$encode('a/b+c=d')

    expect(encoded).not.toMatch(/[/+=]/)
  })
})

describe('$xmlToJson', () => {
  it('maps a flat element list to keys', () => {
    expect($.$xmlToJson('<a>1</a><b>2</b>')).toEqual({ a: '1', b: '2' })
  })

  it('nests child elements', () => {
    expect($.$xmlToJson('<outer><inner>x</inner></outer>')).toEqual({ outer: { inner: 'x' } })
  })

  it('maps a self-closing element to null', () => {
    expect($.$xmlToJson('<a/>')).toEqual({ a: null })
  })

  it('maps an empty element to null', () => {
    expect($.$xmlToJson('<a></a>')).toEqual({ a: null })
  })

  it('returns an empty object for input with no elements', () => {
    expect($.$xmlToJson('')).toEqual({})
    expect($.$xmlToJson('just text')).toEqual({})
  })

  /**
   * Characterization of two real limits of a regex-based parser, recorded so nobody mistakes this
   * for an XML parser: repeated sibling elements collapse to the last one, because each is
   * assigned to the same object key; and attributes are matched but discarded.
   *
   * Both matter if this is ever pointed at an RSS feed, where repeated `<item>` elements are the
   * entire point.
   */
  it('keeps only the last of repeated siblings and drops attributes (characterization)', () => {
    expect($.$xmlToJson('<item>1</item><item>2</item>')).toEqual({ item: '2' })
    expect($.$xmlToJson('<a href="x">1</a>')).toEqual({ a: '1' })
  })
})
