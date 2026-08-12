const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const root = path.resolve(__dirname, '../..')

function loadVueComponent(relativePath) {
  const source = fs.readFileSync(path.join(root, relativePath), 'utf8')
  const script = source.match(/<script>([\s\S]*?)<\/script>/)?.[1]
  assert.ok(script, `${relativePath} must contain a script block`)

  const executable = script
    .replace(/^import .*$/gm, '')
    .replace('export default', 'component =')
  const context = { component: null, bookshelfCardsHelpers: {}, console, screen: {}, URLSearchParams }
  vm.runInNewContext(executable, context, { filename: relativePath })
  return context.component
}

const LazyBookshelf = loadVueComponent('components/bookshelf/LazyBookshelf.vue')

function localBook(id, title) {
  return {
    id,
    libraryItemId: id.replace('local_', ''),
    mediaType: 'book',
    isLocal: true,
    media: { metadata: { title } }
  }
}

function bookshelf(overrides = {}) {
  const events = []
  const instance = {
    ...LazyBookshelf.data(),
    ...LazyBookshelf.methods,
    page: 'books',
    entityName: 'books',
    currentLibraryId: 'library-1',
    currentLibraryMediaType: 'book',
    user: null,
    networkConnected: false,
    entitiesPerShelf: 2,
    shelvesPerPage: 2,
    $eventBus: { $emit: (...args) => events.push(args) },
    $db: { getLocalLibraryItems: async () => [] },
    $nativeHttp: { get: async () => { throw new Error('server unavailable') } },
    initSizeData() {},
    mountEntites() {},
    destroyEntityComponents() {},
    ...overrides
  }
  instance.events = events
  return instance
}

test('Library tab lists downloaded books when no server user is available', async () => {
  const downloads = [localBook('local_book-1', 'One'), localBook('local_book-2', 'Two')]
  let requestedMediaType = null
  const subject = bookshelf({
    $db: {
      getLocalLibraryItems: async (mediaType) => {
        requestedMediaType = mediaType
        return downloads
      }
    }
  })

  await LazyBookshelf.methods.init.call(subject)

  assert.equal(requestedMediaType, 'book')
  assert.deepEqual(subject.entities, downloads)
  assert.equal(subject.totalEntities, 2)
  assert.equal(subject.totalShelves, 1)
  assert.equal(subject.initialized, true)
  assert.deepEqual(subject.events.at(-1), ['bookshelf-total-entities', 2])
})

test('Library tab falls back to downloaded books when its server request fails', async () => {
  const downloads = [localBook('local_book-1', 'One')]
  let serverRequests = 0
  const subject = bookshelf({
    user: { id: 'user-1' },
    networkConnected: true,
    $db: { getLocalLibraryItems: async () => downloads },
    $nativeHttp: {
      get: async () => {
        serverRequests++
        throw new Error('server unavailable')
      }
    }
  })

  await LazyBookshelf.methods.init.call(subject)

  assert.equal(serverRequests, 1)
  assert.deepEqual(subject.entities, downloads)
  assert.equal(subject.totalEntities, 1)
  assert.equal(subject.initialized, true)
})

test('APK workflow builds without making JVM tests part of the APK job', () => {
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/build-apk.yml'), 'utf8')
  assert.doesNotMatch(workflow, /testDebugUnitTest/)
  assert.match(workflow, /assembleDebug/)
})
