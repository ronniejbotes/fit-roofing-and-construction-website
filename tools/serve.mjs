/**
 * Static server for the mirror, behaving the way the production host will:
 * directory indexes, the 404 template with a real 404 status, and a replay of
 * the redirects the live site already answers.
 *
 * It exists so "does the copy behave like the original?" can be answered by
 * clicking through it, not by reading HTML.
 *
 *   node tools/serve.mjs            # http://localhost:4400
 *   PORT=5000 node tools/serve.mjs
 *   npm run serve:lan              # 0.0.0.0:4401 — reachable from a phone on
 *                                  # the same network; prints the LAN URL
 */
import { createServer } from 'node:http'
import { networkInterfaces } from 'node:os'
import { readFile, stat } from 'node:fs/promises'
import { join, extname, resolve, dirname, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseRedirects, matchRedirect } from './site.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DIR = join(ROOT, process.env.SERVE_DIR || '.')
const PORT = Number(process.env.PORT || 4400)
// 0.0.0.0 exposes the preview to the local network so it can be opened on a
// phone. Every URL in the mirror is root-relative, so it serves correctly from
// any host without a rebuild.
const HOST = process.env.HOST || '127.0.0.1'
// A fixed delay before every response. Localhost answers in under a millisecond,
// which changes the order things load in and so the timing of anything that
// races the network (lazy images choosing a srcset candidate, third-party
// widgets starting). DELAY_MS gives the copy a real origin's latency when that
// timing is what is being compared.
const DELAY_MS = Number(process.env.DELAY_MS || 0)

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.eot': 'application/vnd.ms-fontobject',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.pdf': 'application/pdf',
}

/** The redirects the live site already answers, so the copy answers them too. */
let redirects = []
try {
  redirects = parseRedirects(await readFile(join(DIR, '_redirects'), 'utf8'))
  console.log(`Loaded ${redirects.length} redirect(s) from _redirects`)
} catch { /* none yet */ }

async function tryFiles(urlPath) {
  const clean = normalize(decodeURIComponent(urlPath.split('?')[0])).replace(/\\/g, '/')
  if (clean.includes('..')) return null
  const candidates = clean.endsWith('/')
    ? [join(DIR, clean, 'index.html')]
    : [join(DIR, clean), join(DIR, clean, 'index.html')]
  for (const f of candidates) {
    try {
      const s = await stat(f)
      if (s.isFile()) return f
    } catch { /* next */ }
  }
  return null
}

createServer(async (req, res) => {
  if (DELAY_MS) await new Promise((r) => setTimeout(r, DELAY_MS))
  const urlPath = req.url.split('?')[0]

  // A rule matches with or without its trailing slash, in file order, and
  // understands the :name and * patterns — the same matcher verify.mjs uses. The
  // live site answers both forms of every redirect, and pages link both, so a
  // literal string comparison sends a real visitor to the 404 handler instead.
  const hit = matchRedirect(redirects, urlPath)
  if (hit) {
    res.writeHead(hit.code, { Location: hit.to })
    return res.end()
  }

  // A directory URL without its trailing slash resolves relative links one
  // level too high, exactly as it would on a real host. Redirect rather than
  // serve, so the mirror is exercised the way production will serve it.
  if (!extname(urlPath) && !urlPath.endsWith('/')) {
    if (await tryFiles(urlPath + '/')) {
      res.writeHead(301, { Location: urlPath + '/' })
      return res.end()
    }
  }

  const file = await tryFiles(urlPath)
  if (file) {
    const body = await readFile(file)
    const type = TYPES[extname(file).toLowerCase()] || 'application/octet-stream'

    // Byte ranges, because <video> depends on them. Chromium asks for a range
    // when it loads media; a server that answers 200 with the whole file makes
    // it abort the request, and the video then looks broken on the copy while
    // working on the original — a difference introduced by the test rig rather
    // than by the mirror. Every real static host answers 206 here.
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '')
    if (range) {
      const end = range[2] ? Math.min(Number(range[2]), body.length - 1) : body.length - 1
      const start = range[1] ? Number(range[1]) : Math.max(0, body.length - Number(range[2] || 0))
      if (start > end || start >= body.length) {
        res.writeHead(416, { 'Content-Range': `bytes */${body.length}` })
        return res.end()
      }
      const slice = body.subarray(start, end + 1)
      res.writeHead(206, {
        'Content-Type': type,
        'Content-Length': slice.length,
        'Content-Range': `bytes ${start}-${end}/${body.length}`,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-store',
      })
      return res.end(slice)
    }

    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': body.length,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
    })
    return res.end(body)
  }

  try {
    const body = await readFile(join(DIR, '404.html'))
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' })
    return res.end(body)
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' })
    return res.end('404')
  }
}).listen(PORT, HOST, () => {
  console.log(`Serving ${DIR}${DELAY_MS ? ` with ${DELAY_MS} ms added to every response` : ''}`)
  console.log(`  http://localhost:${PORT}/`)
  if (HOST === '0.0.0.0') {
    for (const [name, addrs] of Object.entries(networkInterfaces())) {
      for (const a of addrs || []) {
        if (a.family === 'IPv4' && !a.internal) {
          console.log(`  http://${a.address}:${PORT}/   (${name} — open this on a phone)`)
        }
      }
    }
  }
})
