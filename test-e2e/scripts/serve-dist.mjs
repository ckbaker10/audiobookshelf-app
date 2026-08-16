import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { join, extname, normalize } from 'node:path'

/**
 * Serves `dist/` the way a static host would, for the Playwright web project.
 *
 * Written by hand rather than pulled in as a dependency for one reason: the fallback. `nuxt
 * generate` emits `200.html` as the client-side fallback, and without serving it for unknown paths
 * a deep link like `/bookshelf/library?filter=all` 404s and every spec fails at navigation rather
 * than at its assertion. Most one-line static servers do not do that, and the ones that do are a
 * dependency for something this file says in thirty lines.
 *
 * Usage: node test-e2e/scripts/serve-dist.mjs [port] [root]
 */

const port = Number(process.argv[2] || process.env.E2E_PORT || 4173)
const root = normalize(join(import.meta.dirname, '..', '..', process.argv[3] || 'dist'))

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

/** Resolves a URL path to a file, trying `index.html` for directories. */
async function resolveFile(urlPath) {
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

const server = createServer(async (req, res) => {
  const urlPath = new URL(req.url, 'http://localhost').pathname
  const file = (await resolveFile(urlPath)) || (await resolveFile('/200.html'))

  if (!file) {
    res.writeHead(404, { 'content-type': 'text/plain' })
    res.end('not found')
    return
  }

  const body = await readFile(file)
  res.writeHead(200, {
    'content-type': CONTENT_TYPES[extname(file)] || 'application/octet-stream',
    // The specs reload between assertions and a cached bundle would hide a rebuild.
    'cache-control': 'no-store'
  })
  res.end(body)
})

server.listen(port, () => console.log(`[e2e] serving ${root} on http://localhost:${port}`))
