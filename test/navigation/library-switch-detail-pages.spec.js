import { describe, it, expect } from 'vitest'
import CollectionPage from '@/pages/collection/_id.vue'
import PlaylistPage from '@/pages/playlist/_id.vue'
import { mountComponent, storeWith, fakeRouter, flush } from '../support/harness'

/**
 * Issues #1711 and #1712 - a collection/playlist detail page stays open after switching libraries.
 *
 * Open a collection, switch to another library from the libraries modal, and the collection detail
 * page is still on screen showing items from the library you just left. Its contents belong to a
 * library that is no longer selected, and nothing on the page says so.
 *
 * Production path: both pages fetch their subject in `asyncData` and hold it in component state
 * (`pages/collection/_id.vue:36-65`, `pages/playlist/_id.vue:36-73`). `LibrariesModal` announces
 * the change with `$eventBus.$emit('library-changed', lib.id)` (`:56`), and several components
 * subscribe - `LazyBookshelf` (`:505`), `pages/bookshelf/authors.vue`, `latest.vue`,
 * `add-podcast.vue`, `index.vue`.
 *
 * Neither detail page does. `collection/_id.vue` has a literally empty `mounted() {}` (`:140`);
 * `playlist/_id.vue` subscribes to `playlist_updated`/`playlist_removed` on the socket but not to
 * `library-changed` (`:167-174`). So the event fires and these two pages ignore it.
 *
 * The contract: when the selected library changes, a detail page for an entity from the old
 * library leaves, the same way `LazyBookshelf.libraryChanged()` already routes away from a
 * collections shelf that the new library cannot show (`:436-440`).
 *
 * The socket-listener specs on the playlist page pass today and are guards - the existing cleanup
 * must not be dropped while adding the new listener.
 */

const collection = {
  id: 'col-1',
  libraryId: 'lib-1',
  name: 'My Collection',
  books: []
}

const playlist = {
  id: 'pl-1',
  libraryId: 'lib-1',
  name: 'My Playlist',
  items: []
}

function mountCollection() {
  const router = fakeRouter({ path: '/collection/col-1', name: 'collection-id' })
  return mountComponent(CollectionPage, {
    store: storeWith({ user: { id: 'u1' }, currentLibraryId: 'lib-1', networkConnected: true }),
    router,
    data: { collection }
  })
}

function mountPlaylist() {
  const router = fakeRouter({ path: '/playlist/pl-1', name: 'playlist-id' })
  return mountComponent(PlaylistPage, {
    store: storeWith({ user: { id: 'u1' }, currentLibraryId: 'lib-1', networkConnected: true }),
    router,
    data: { playlist }
  })
}

describe('#1711/#1712 detail pages must leave when the library changes', () => {
  describe('collection detail', () => {
    it('routes back to the collections shelf on library-changed', async () => {
      const { wrapper, $eventBus, $router } = mountCollection()

      $eventBus.$emit('library-changed', 'lib-2')
      await flush()

      expect($router.navigations).toContainEqual({ method: 'replace', to: '/bookshelf/collections' })
      wrapper.destroy()
    })

    it('marks itself as leaving so nothing repopulates it on the way out', async () => {
      // Stated separately from the routing assertion because "went somewhere" and "stopped
      // accepting content for the old library" are different contracts, and a fix could satisfy
      // one without the other.
      //
      // Asserted on the leaving flag rather than on `collection` being null: routing is
      // asynchronous, so the page re-renders at least once before it unmounts, and a template
      // built around `collection.books` would throw if the object were cleared.
      const { wrapper, $eventBus } = mountCollection()

      $eventBus.$emit('library-changed', 'lib-2')
      await flush()

      expect(wrapper.vm.leavingLibrary).toBe(true)
      wrapper.destroy()
    })

    it('subscribes to library-changed while mounted and unsubscribes on destroy', async () => {
      // Asserted on the subscriber count rather than only on the side effect. While no listener
      // exists at all, a destroy-then-emit test passes because nothing happens either way - it
      // would be green today and green after a fix that forgot to clean up.
      const { wrapper, $eventBus } = mountCollection()

      expect($eventBus.listenerCount('library-changed')).toBe(1)

      wrapper.destroy()
      expect($eventBus.listenerCount('library-changed')).toBe(0)
    })
  })

  describe('playlist detail', () => {
    it('routes back to the playlists shelf on library-changed', async () => {
      const { wrapper, $eventBus, $router } = mountPlaylist()

      $eventBus.$emit('library-changed', 'lib-2')
      await flush()

      expect($router.navigations).toContainEqual({ method: 'replace', to: '/bookshelf/playlists' })
      wrapper.destroy()
    })

    it('subscribes to library-changed while mounted and unsubscribes on destroy', async () => {
      const { wrapper, $eventBus } = mountPlaylist()

      expect($eventBus.listenerCount('library-changed')).toBe(1)

      wrapper.destroy()
      expect($eventBus.listenerCount('library-changed')).toBe(0)
    })

    it('a socket update for the old playlist cannot repopulate the page after leaving', async () => {
      const { wrapper, $eventBus, $socket } = mountPlaylist()

      $eventBus.$emit('library-changed', 'lib-2')
      await flush()
      $socket.$emit('playlist_updated', { id: 'pl-1', libraryId: 'lib-1', name: 'Renamed', items: [] })
      await flush()

      expect(wrapper.vm.playlist?.name).toBe('My Playlist')
      wrapper.destroy()
    })
  })

  describe('existing socket cleanup (guards)', () => {
    it('playlist page subscribes to and cleans up its socket listeners', async () => {
      const { wrapper, $socket } = mountPlaylist()

      expect($socket.listenerCount('playlist_updated')).toBe(1)
      expect($socket.listenerCount('playlist_removed')).toBe(1)

      wrapper.destroy()
      expect($socket.listenerCount('playlist_updated')).toBe(0)
      expect($socket.listenerCount('playlist_removed')).toBe(0)
    })

    it('playlist page leaves when its own playlist is removed', async () => {
      const { wrapper, $socket, $router } = mountPlaylist()

      $socket.$emit('playlist_removed', { id: 'pl-1' })
      await flush()

      expect($router.navigations).toContainEqual({ method: 'replace', to: '/bookshelf/playlists' })
      wrapper.destroy()
    })
  })
})
