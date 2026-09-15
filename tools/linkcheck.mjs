/**
 * Request every internal link on every page, against the running server.
 *
 * verify.mjs answers the same question by looking at files on disk. This asks
 * the server, which also exercises the things a filesystem check cannot see:
 * directory indexes, the redirect replay, the 404 handler, and anchors that
 * have to land on a real element rather than just a real page.
 *
 * Needs `npm run serve`.
 *
 *   node tools/linkcheck.mjs
 *   node tools/linkcheck.mjs --base http://localhost:4400
 */
import { readFile } from 'node:fs/promises'
import { join, resolve, dirname, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { toLocalPath } from './site.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const argVal = (f) => { const i = args.indexOf(f); return i === -1 ? null : args[i + 1] }
const BASE = argVal('--base') || 'http://localhost:4400'
const CONCURRENCY = Number(process.env.CONCURRENCY || 12)

const routes = (await readFile(join(ROOT, 'routes.txt'), 'utf8'))
  .split('\n').map((s) => s.trim()).filter((s) => s && !s.startsWith('#') && !s.endsWith('.xml'))

// Endpoints a static host is not expected to answer. They are absent by design,
// not broken — see the same list in verify.mjs.
const EXPECTED_ABSENT = [/^\/wp-admin/, /^\/wp-login/, /^\/wp-json/, /^\/xmlrpc/, /\.php(\?|$)/, /^\/cdn-cgi\//]

/** link -> { pages: Set, anchor: string|null } */
const links = new Map()

for (const r of routes) {
  const html = await readFile(join(ROOT, r, 'index.html'), 'utf8')
  for (const m of html.matchAll(/href=(["'])(.*?)\1/gi)) {
    const u = toLocalPath(m[2])
    if (!u) continue
    if (EXPECTED_ABSENT.some((re) => re.test(u))) continue
    // Query-string URLs are WooCommerce state, not documents: every one of them
    // is an add-to-cart link, robots.txt disallows them all, and none of them
    // does anything on a static copy. Checking them would report the whole
    // catalogue as broken and say nothing useful.
    if (u.includes('?')) continue
    const [path, anchor] = u.split('#')
    if (!path) continue                       // same-page anchor like href="#top"
    const key = path
    if (!links.has(key)) links.set(key, { pages: new Set(), anchors: new Set() })
    links.get(key).pages.add(r)
    if (anchor) links.get(key).anchors.add(anchor)
  }
}

console.log(`Checking ${links.size} distinct internal links from ${routes.length} pages against ${BASE}\n`)

const bad = []
const redirected = []
const anchorMisses = []
const list = [...links.entries()]
let i = 0

await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  while (i < list.length) {
    const [path, info] = list[i++]
    try {
      const res = await fetch(BASE + path, { redirect: 'manual' })
      if (res.status >= 300 && res.status < 400) {
        redirected.push([path, res.headers.get('location'), info.pages.size])
        continue
      }
      if (!res.ok) {
        bad.push([path, res.status, [...info.pages].slice(0, 3), info.pages.size])
        continue
      }
      // An anchor link has to land on an element that exists, or the visitor
      // gets the top of the page and no indication anything is wrong.
      if (info.anchors.size && (res.headers.get('content-type') || '').includes('html')) {
        const body = await res.text()
        for (const a of info.anchors) {
          const found = body.includes(`id="${a}"`) || body.includes(`id='${a}'`) ||
            body.includes(`name="${a}"`)
          if (!found) anchorMisses.push([`${path}#${a}`, info.pages.size])
        }
      }
    } catch (e) {
      bad.push([path, e.message, [...info.pages].slice(0, 3), info.pages.size])
    }
  }
}))

console.log(`Broken (4xx/5xx): ${bad.length}`)
for (const [p, s, pages, n] of bad) {
  console.log(`   ${s}  ${p}   (linked from ${n} page(s), e.g. ${pages.join(', ')})`)
}

console.log(`\nRedirects (expected — these are the live site's own rules): ${redirected.length}`)
for (const [p, to, n] of redirected) console.log(`   ${p}  ->  ${to}   (${n} page(s))`)

console.log(`\nAnchors that do not exist on the target page: ${anchorMisses.length}`)
for (const [a, n] of anchorMisses) console.log(`   ${a}   (${n} page(s))`)

const fail = bad.length + anchorMisses.length
console.log(`\n${fail === 0 ? 'PASS — every internal link resolves and every anchor exists.' : `${fail} problem(s).`}`)
// exitCode rather than exit(): exiting while fetch's sockets are still closing
// trips a libuv assertion on Windows (UV_HANDLE_CLOSING) after the report prints.
process.exitCode = fail ? 1 : 0
