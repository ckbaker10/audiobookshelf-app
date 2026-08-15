import { describe, it, expect } from 'vitest'
import HomePage from '@/pages/bookshelf/index.vue'
import { mountComponent, storeWith, fakeDb, flush } from '../support/harness'

/**
 * Characterization of the **Home** shelf's offline behaviour.
 *
 * Home already does what the Library tab does not: with no user and no network it reads local
 * storage and builds shelves from downloaded items (`getLocalMediaItemCategories()`). That
 * asymmetry is the whole reason the Library tab reads as broken rather than as a documented
 * boundary - in one offline session the same downloads appear on Home and not in Library.
 *
 * Pinned here for two reasons. It is the contract `offline-library.spec.js` asserts Library should
 * match, so it needs to be executable rather than a claim in a plan document; and the fix for
 * Library is expected to *reuse* this mapping rather than write a second one, which means a change
 * to Home's shape would silently change Library's too.
 *
 * Not a defect spec - Home works. If one of these fails, Home's offline behaviour changed and the
 * Library expectations need revisiting with it.
 */

const localBook = (id, title) => ({
  id,
  libraryItemId: `server-${id}`,
  mediaType: 'book',
  media: { metadata: { title }, episodes: [] }
})

const localPodcast = (id, title, episodes = []) => ({
  id,
  libraryItemId: `server-${id}`,
  mediaType: 'podcast',
  media: { metadata: { title }, episodes }
})

function mountHome({ localLibraryItems = [], localMediaProgress = [] } = {}) {
  const store = storeWith({ user: null, networkConnected: false, localMediaProgress })
  const db = fakeDb({ localLibraryItems })
  return mountComponent(HomePage, { store, db })
}

describe('Home shelf, offline', () => {
  it('builds a local books shelf from downloaded items', async () => {
    const { wrapper } = mountHome({
      localLibraryItems: [localBook('local-1', 'Wizards First Rule'), localBook('local-2', 'Stone of Tears')]
    })

    await wrapper.vm.fetchCategories()
    await flush()

    const books = wrapper.vm.shelves.find((s) => s.id === 'local-books')
    expect(books).toBeTruthy()
    expect(books.entities.map((e) => e.media.metadata.title)).toEqual(['Wizards First Rule', 'Stone of Tears'])
  })

  it('separates local podcasts from local books', async () => {
    const { wrapper } = mountHome({
      localLibraryItems: [localBook('local-1', 'A Book'), localPodcast('local-2', 'A Podcast')]
    })

    await wrapper.vm.fetchCategories()
    await flush()

    expect(wrapper.vm.shelves.map((s) => s.id)).toEqual(['local-books', 'local-podcasts'])
  })

  it('adds a continue-listening shelf for a partly-played download', async () => {
    const { wrapper } = mountHome({
      localLibraryItems: [localBook('local-1', 'Wizards First Rule')],
      localMediaProgress: [{ localLibraryItemId: 'local-1', progress: 0.4, isFinished: false, lastUpdate: 100 }]
    })

    await wrapper.vm.fetchCategories()
    await flush()

    const continueShelf = wrapper.vm.shelves.find((s) => s.id === 'local-books-continue')
    expect(continueShelf).toBeTruthy()
    expect(continueShelf.localOnly).toBe(true)
    expect(continueShelf.entities.map((e) => e.id)).toEqual(['local-1'])
  })

  it('leaves a finished download out of continue-listening but keeps it in the library shelf', async () => {
    const { wrapper } = mountHome({
      localLibraryItems: [localBook('local-1', 'Finished Book')],
      localMediaProgress: [{ localLibraryItemId: 'local-1', progress: 1, isFinished: true, lastUpdate: 100 }]
    })

    await wrapper.vm.fetchCategories()
    await flush()

    expect(wrapper.vm.shelves.find((s) => s.id === 'local-books-continue')).toBeUndefined()
    expect(wrapper.vm.shelves.find((s) => s.id === 'local-books').entities).toHaveLength(1)
  })

  it('shows no shelves when nothing is downloaded', async () => {
    const { wrapper } = mountHome({ localLibraryItems: [] })

    await wrapper.vm.fetchCategories()
    await flush()

    expect(wrapper.vm.shelves).toEqual([])
  })

  it('reads local storage even with no user and no network', async () => {
    // The single line of difference from the Library tab, stated as its own assertion.
    const { wrapper, $db } = mountHome({ localLibraryItems: [localBook('local-1', 'A Book')] })

    await wrapper.vm.fetchCategories()
    await flush()

    expect($db.calls.some((c) => c.method === 'getLocalLibraryItems')).toBe(true)
  })
})
