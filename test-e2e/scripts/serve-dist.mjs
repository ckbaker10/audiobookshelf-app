import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { DIST_ROOT, contentTypeFor, resolveWithFallback } from '../support/dist.mjs'

/**
 * Serves `dist/` the way a static host would, for the Playwright web project.
 *
 * Written by hand rather than pulled in as a dependency for one reason: the fallback. `nuxt
 * generate` emits `200.html` as the client-side fallback, and without serving it for unknown paths
 * a deep link like `/bookshelf/library?filter=all` 404s and every spec fails at navigation rather
 * than at its assertion. Most one-line static servers do not do that, and the ones that do are a
 * dependency for something this file says in thirty lines.
 *
 * The resolution itself lives in `support/dist.mjs`, because the offline specs serve the same files
 * through `route.fulfill` instead of over HTTP and the two must not disagree.
 *
 * Usage: node test-e2e/scripts/serve-dist.mjs [port]
 */

const port = Number(process.argv[2] || process.env.E2E_PORT || 4173)

const server = createServer(async (req, res) => {
  const urlPath = new URL(req.url, 'http://localhost').pathname
  const file = await resolveWithFallback(urlPath)

  if (!file) {
    res.writeHead(404, { 'content-type': 'text/plain' })
    res.end('not found')
    return
  }

  const body = await readFile(file)
  res.writeHead(200, {
    'content-type': contentTypeFor(file),
    // The specs reload between assertions and a cached bundle would hide a rebuild.
    'cache-control': 'no-store'
  })
  res.end(body)
})

server.listen(port, () => console.log(`[e2e] serving ${DIST_ROOT} on http://localhost:${port}`))
