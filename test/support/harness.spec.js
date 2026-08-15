import { describe, it, expect } from 'vitest'
import { fakeDb, fakeNativeHttp, storeWith, fakeEventBus, mountComponent } from './harness'

/**
 * Smoke tests for the harness itself. These exist because every other test in this suite trusts
 * these fakes, so a fake that quietly misbehaves would corrupt results elsewhere rather than fail
 * here.
 */
describe('harness', () => {
  it('mounts a component with the injected plugins Nuxt would provide', () => {
    const { wrapper } = mountComponent({
      template: '<div>{{ $strings.ButtonConnect }}-{{ $platform }}</div>'
    })

    expect(wrapper.text()).toBe('ButtonConnect-android')
  })

  it('$strings returns the key, so assertions do not depend on en-us.json', () => {
    const { wrapper } = mountComponent({ template: '<p>{{ $strings.MessageBookshelfEmpty }}</p>' })

    expect(wrapper.text()).toBe('MessageBookshelfEmpty')
  })

  describe('fakeNativeHttp', () => {
    it('rejects by default, so a test that forgets to stub models the offline case', async () => {
      const http = fakeNativeHttp()

      await expect(http.get('/api/libraries/lib-1/items')).rejects.toThrow('offline')
    })

    it('records the requests that were attempted', async () => {
      const http = fakeNativeHttp({ responses: { '/api/libraries': { results: [], total: 0 } } })

      await http.get('/api/libraries/lib-1/items?page=0')

      expect(http.requests).toEqual([{ method: 'GET', url: '/api/libraries/lib-1/items?page=0' }])
    })

    it('returns a queued response when the url matches', async () => {
      const http = fakeNativeHttp({ responses: { '/api/libraries': { results: [{ id: 'a' }], total: 1 } } })

      await expect(http.get('/api/libraries/lib-1/items')).resolves.toEqual({ results: [{ id: 'a' }], total: 1 })
    })

    it('throws a queued Error rather than resolving with it', async () => {
      const http = fakeNativeHttp({ responses: { '/api/me': new Error('401') } })

      await expect(http.get('/api/me')).rejects.toThrow('401')
    })
  })

  describe('fakeDb', () => {
    it('filters local library items by media type, as the real bridge does', async () => {
      const db = fakeDb({
        localLibraryItems: [
          { id: 'a', mediaType: 'book' },
          { id: 'b', mediaType: 'podcast' }
        ]
      })

      expect(await db.getLocalLibraryItems('book')).toEqual([{ id: 'a', mediaType: 'book' }])
      expect(await db.getLocalLibraryItems()).toHaveLength(2)
    })

    it('records calls so a test can assert local storage was consulted at all', async () => {
      const db = fakeDb()

      await db.getLocalLibraryItems('book')

      expect(db.calls).toEqual([{ method: 'getLocalLibraryItems', mediaType: 'book' }])
    })
  })

  describe('storeWith', () => {
    it('defaults to the offline, logged-out state', () => {
      const store = storeWith()

      expect(store.state.user.user).toBeNull()
      expect(store.state.networkConnected).toBe(false)
    })

    it('exposes local media progress through the getter components use', () => {
      const store = storeWith({
        localMediaProgress: [{ localLibraryItemId: 'local-1', progress: 0.5 }]
      })

      const progress = store.getters['globals/getLocalMediaProgressById']('local-1')

      expect(progress.progress).toBe(0.5)
    })
  })

  it('fakeEventBus records emits so components can be asserted on their events', () => {
    const bus = fakeEventBus()

    bus.$emit('bookshelf-total-entities', 7)

    expect(bus.emitted).toEqual([{ event: 'bookshelf-total-entities', args: [7] }])
  })
})
