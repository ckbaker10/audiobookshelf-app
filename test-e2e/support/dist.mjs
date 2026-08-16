import { readFile, stat } from 'node:fs/promises'
import { join, extname, normalize } from 'node:path'

/**
 * Resolving a URL path to a file in `dist/`.
 *
 * Shared by the two things that serve the built app: `scripts/serve-dist.mjs` over HTTP, and
 * `fixtures.js` through `route.fulfill` when the browser context is offline. One implementation, so
 * the offline specs and the online ones cannot disagree about what the app is.
 */

export const DIST_ROOT = normalize(join(import.meta.dirname, '..', '..', 'dist'))

const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm'
}

export const contentTypeFor = (file) => CONTENT_TYPES[extname(file)] || 'application/octet-stream'

/** Resolves [urlPath] to a file, trying `index.html` for directories. Null when there is none. */
export async function resolveDistFile(urlPath, root = DIST_ROOT) {
  // Reject traversal outright rather than normalising it away silently.
  const candidate = normalize(join(root, decodeURIComponent(urlPath)))
  if (!candidate.startsWith(root)) return null

  try {
    const stats = await stat(candidate)
    if (stats.isDirectory()) {
      const index = join(candidate, 'index.html')
      await stat(index)
      return index
    }
    return candidate
  } catch {
    return null
  }
}

/**
 * The file to answer [urlPath] with, falling back to `200.html`.
 *
 * `nuxt generate` emits that as the client-side fallback. Without it a deep link like
 * `/bookshelf/library` 404s and a spec fails at navigation rather than at its assertion.
 */
export async function resolveWithFallback(urlPath, root = DIST_ROOT) {
  return (await resolveDistFile(urlPath, root)) || (await resolveDistFile('/200.html', root))
}

export { readFile }
