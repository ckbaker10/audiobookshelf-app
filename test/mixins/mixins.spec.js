import { describe, it, expect, vi, beforeEach } from 'vitest'

const dialogConfirm = vi.fn()
vi.mock('@capacitor/dialog', () => ({ Dialog: { confirm: (...a) => dialogConfirm(...a) } }))

const jumpLabel = (await import('@/mixins/jumpLabel')).default
const cellularPermissionHelpers = (await import('@/mixins/cellularPermissionHelpers')).default

/**
 * The two small mixins with no coverage.
 *
 * Both are pure decision logic once their injected dependencies are supplied, so the methods are
 * called with an explicit `this` rather than through a mounted component - the component would add
 * nothing and hide which inputs actually matter.
 *
 * `bookshelfCardsHelpers` is deliberately excluded: it constructs and mounts card components
 * against real DOM measurements, which happy-dom reports as zero. See FRONTEND_TESTING.md.
 */

describe('jumpLabel', () => {
  /** Mirrors the two injected helpers the mixin uses, so the chosen key and value are observable. */
  const vm = {
    $getString: (key, subs) => `${key}:${subs.join(',')}`,
    $formatNumber: (n) => String(n)
  }
  const label = (seconds) => jumpLabel.methods.getJumpLabel.call(vm, seconds)

  it('renders seconds below the two-minute cutoff', () => {
    expect(label(10)).toBe('UnitSecondsShort:10')
    expect(label(30)).toBe('UnitSecondsShort:30')
  })

  it('keeps sixty as seconds rather than promoting it to a minute', () => {
    // Explicit in the source: `const useMinutes = val >= 120 // keep 60s as seconds`.
    expect(label(60)).toBe('UnitSecondsShort:60')
  })

  it('switches to minutes at exactly one hundred and twenty', () => {
    expect(label(119)).toBe('UnitSecondsShort:119')
    expect(label(120)).toBe('UnitMinutesShort:2')
    expect(label(300)).toBe('UnitMinutesShort:5')
  })

  it('accepts a numeric string, since settings round-trip through storage', () => {
    expect(label('30')).toBe('UnitSecondsShort:30')
    expect(label('300')).toBe('UnitMinutesShort:5')
  })

  it('returns an empty string for a non-numeric value rather than rendering NaN', () => {
    expect(label('abc')).toBe('')
    expect(label(undefined)).toBe('')
    expect(label(NaN)).toBe('')
  })

  /**
   * Characterization. `Number(null)` is 0 and `Number('')` is 0, so both render as "0 sec" rather
   * than taking the empty-string guard that `undefined` takes. The two nullish values therefore
   * behave differently, which is not obvious from the code.
   */
  it('treats null and empty string as zero seconds, unlike undefined (characterization)', () => {
    expect(label(null)).toBe('UnitSecondsShort:0')
    expect(label('')).toBe('UnitSecondsShort:0')
  })

  it('renders a fractional minute value rather than rounding it', () => {
    expect(label(150)).toBe('UnitMinutesShort:2.5')
  })
})

describe('cellularPermissionHelpers', () => {
  /** Builds the `this` the mixin reaches through, and records what the user was shown. */
  function vmWith({ connectionType = 'cellular', download = 'ALWAYS', streaming = 'ALWAYS' } = {}) {
    const toasts = []
    return {
      toasts,
      // checkCellularPermission calls its sibling `this.confirmAction`, so the vm has to carry the
      // mixin's own methods as well as the injected dependencies.
      ...cellularPermissionHelpers.methods,
      $store: {
        state: { networkConnectionType: connectionType },
        getters: {
          getCanDownloadUsingCellular: download,
          getCanStreamingUsingCellular: streaming
        }
      },
      $strings: new Proxy({}, { get: (_, key) => key }),
      $toast: { error: (m) => toasts.push(m) }
    }
  }

  const check = (vm, action) => cellularPermissionHelpers.methods.checkCellularPermission.call(vm, action)

  beforeEach(() => {
    dialogConfirm.mockReset()
  })

  it('allows anything when not on cellular, without consulting the setting', async () => {
    const vm = vmWith({ connectionType: 'wifi', download: 'NEVER' })

    await expect(check(vm, 'download')).resolves.toBe(true)
    expect(dialogConfirm).not.toHaveBeenCalled()
    expect(vm.toasts).toEqual([])
  })

  it('allows on cellular when the setting is ALWAYS', async () => {
    await expect(check(vmWith({ download: 'ALWAYS' }), 'download')).resolves.toBe(true)
    await expect(check(vmWith({ streaming: 'ALWAYS' }), 'streaming')).resolves.toBe(true)
    expect(dialogConfirm).not.toHaveBeenCalled()
  })

  it('refuses and explains when the setting is NEVER', async () => {
    const vm = vmWith({ download: 'NEVER' })

    await expect(check(vm, 'download')).resolves.toBe(false)
    expect(vm.toasts).toEqual(['ToastDownloadNotAllowedOnCellular'])
  })

  it('uses the streaming setting and message for a streaming action', async () => {
    const vm = vmWith({ streaming: 'NEVER' })

    await expect(check(vm, 'streaming')).resolves.toBe(false)
    expect(vm.toasts).toEqual(['ToastStreamingNotAllowedOnCellular'])
  })

  it('does not let the download setting block streaming, or the reverse', async () => {
    await expect(check(vmWith({ download: 'NEVER', streaming: 'ALWAYS' }), 'streaming')).resolves.toBe(true)
    await expect(check(vmWith({ download: 'ALWAYS', streaming: 'NEVER' }), 'download')).resolves.toBe(true)
  })

  it('asks the user when the setting is ASK, and honours the answer', async () => {
    dialogConfirm.mockResolvedValue({ value: true })
    await expect(check(vmWith({ download: 'ASK' }), 'download')).resolves.toBe(true)

    dialogConfirm.mockResolvedValue({ value: false })
    await expect(check(vmWith({ download: 'ASK' }), 'download')).resolves.toBe(false)
  })

  it('shows the action-specific message in the confirmation dialog', async () => {
    dialogConfirm.mockResolvedValue({ value: true })

    await check(vmWith({ download: 'ASK' }), 'download')
    expect(dialogConfirm.mock.calls[0][0].message).toBe('MessageConfirmDownloadUsingCellular')

    dialogConfirm.mockClear()
    await check(vmWith({ streaming: 'ASK' }), 'streaming')
    expect(dialogConfirm.mock.calls[0][0].message).toBe('MessageConfirmStreamingUsingCellular')
  })

  /**
   * Characterization, and the sharpest edge here. An unrecognised action type matches neither
   * branch, so `permission` stays `undefined`, the `ASK` check does not fire, and the method falls
   * through to `return true`.
   *
   * A typo'd or newly-added action therefore silently gets cellular access without asking, which
   * is the opposite of what a permission check should do when it does not understand its input.
   * Pinned rather than called a defect because the only two call sites today pass literals; it
   * becomes one the moment a third action type is added.
   */
  it('permits an unknown action type by default (characterization)', async () => {
    const vm = vmWith({ download: 'NEVER', streaming: 'NEVER' })

    await expect(check(vm, 'sync')).resolves.toBe(true)
    expect(vm.toasts).toEqual([])
  })
})
