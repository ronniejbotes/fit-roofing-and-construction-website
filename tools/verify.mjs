/**
 * Prove the mirror is complete and self-contained.
 *
 * Four questions, answered against the files on disk rather than against a
 * memory of what the capture printed:
 *
 *   1. Is every route in routes.txt actually present?
 *   2. Does every same-origin reference in every page resolve to a file here?
 *   3. Did the rewrite leave any live-origin URL where something would *load*
 *      from it (as opposed to the canonical/og/schema tags, which must stay)?
 *   4. Does each page still carry the title and description the live site sent?
 *
 *   node tools/verify.mjs              # 1-3, offline
 *   node tools/verify.mjs --live       # adds 4, refetching every page
 */
import { readFile, readdir, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, resolve, dirname, extname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ORIGIN, UA, assetsFromHtml, assetsFromCss, toLocalPath, parseRedirects, matchRedirect } from './site.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DIR = join(ROOT, process.env.MIRROR_DIR || '.')
const LIVE = process.argv.includes('--live')

const SKIP_DIRS = new Set(['.git', 'node_modules', '_raw', 'tools', '.probe', 'shots'])

async function walk(dir, out = []) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue
    const p = join(dir, e.name)
    if (e.isDirectory()) await walk(p, out)
    else out.push(p)
  }
  return out
}

const files = await walk(DIR)
const htmlFiles = files.filter((f) => f.endsWith('.html'))
const cssFiles = files.filter((f) => f.endsWith('.css'))
const present = new Set(files.map((f) => '/' + relative(DIR, f).split('\\').join('/')))

console.log(`${files.length} files — ${htmlFiles.length} HTML, ${cssFiles.length} CSS\n`)

// ---- 1. every route present ------------------------------------------------

const routes = (await readFile(join(ROOT, 'routes.txt'), 'utf8'))
  .split('\n').map((s) => s.trim()).filter((s) => s && !s.startsWith('#'))

const missingRoutes = []
for (const r of routes) {
  const f = extname(r) ? join(DIR, r) : join(DIR, r, 'index.html')
  if (!existsSync(f)) missingRoutes.push(r)
}
console.log(`1. Routes present:      ${routes.length - missingRoutes.length}/${routes.length}`)
for (const r of missingRoutes) console.log(`   MISSING  ${r}`)

/**
 * Every shipped page against the untouched capture it came from.
 *
 * The rewrite only ever shortens a page — it strips the origin from URLs — so a
 * shipped page should land within a few per cent of its raw counterpart. A page
 * that is dramatically smaller was overwritten by something that is not that
 * page. That is not hypothetical: WooCommerce's mini-cart XHR
 * (GET /?wc-ajax=get_refreshed_fragments) has a URL path of "/", and an earlier
 * build of the capture wrote its 827-byte JSON response over the 250 KB
 * homepage. Every other check still passed — the file existed, its links
 * resolved, no origin leaked — because the file was simply not the homepage any
 * more. Only a size comparison catches that.
 */
const RAW = join(ROOT, '_raw')
const shrunk = []
if (existsSync(RAW)) {
  for (const r of routes) {
    if (extname(r)) continue
    const mine = join(DIR, r, 'index.html')
    const raw = join(RAW, r, 'index.html')
    if (!existsSync(mine) || !existsSync(raw)) continue
    const a = (await stat(mine)).size
    const b = (await stat(raw)).size
    if (a < b * 0.8) shrunk.push([r, a, b])
  }
  console.log(`   Page sizes vs _raw:  ${shrunk.length === 0 ? 'all within range' : `${shrunk.length} suspiciously small`}`)
  for (const [r, a, b] of shrunk) console.log(`   SHRUNK   ${r}  ${a} bytes vs ${b} raw`)
} else {
  console.log('   Page sizes vs _raw:  skipped (_raw not present)')
}

// ---- 2. every reference resolves -------------------------------------------

/** Does this same-origin path exist in the mirror, as a file or a directory index? */
function resolves(p) {
  const bare = p.split('?')[0].split('#')[0]
  if (!bare || bare === '/') return present.has('/index.html')
  let decoded
  try { decoded = decodeURIComponent(bare) } catch { decoded = bare }
  if (present.has(decoded)) return true
  if (present.has(decoded + 'index.html')) return true
  if (present.has(decoded + '/index.html')) return true
  return false
}

// Paths that legitimately have no file: WordPress endpoints a static host does
// not serve, and the redirects the live site answers (checked separately).
const EXPECTED_ABSENT = [
  /^\/wp-admin/, /^\/wp-login/, /^\/wp-json/, /^\/xmlrpc/, /\.php(\?|$)/,
  /^\/cdn-cgi\//,        // Cloudflare's own endpoints, injected at the edge
  /^\/\?/, /^\/#/,
  // Elementor hands its JavaScript a set of base URLs to build paths from:
  //   "urls":{"assets":"/wp-content/plugins/elementor/assets/",
  //           "uploadUrl":"/wp-content/uploads"}
  // They are directories, not resources. The extractor cannot tell them from a
  // file path, so they are excused here — an extension-less /wp-content/ path
  // is always one of these.
  /^\/wp-(?:content|includes)\/[^?#]*[^/.]$/,
  /^\/wp-(?:content|includes)\/[^?#]*\/$/,
]
let redirectRules = []
try { redirectRules = parseRedirects(await readFile(join(DIR, '_redirects'), 'utf8')) } catch { /* none */ }

/**
 * A reference that lands on a redirect is not broken — the live site answers it
 * the same way, and _redirects carries it across. Matched with the same rules
 * the server replays, so /2026/05/14/ (linked from the post dates on /blog/)
 * counts as redirected because /2026/* says so, not because it is listed.
 */
function isRedirect(ref) {
  return !!matchRedirect(redirectRules, ref)
}

const broken = new Map()   // ref -> Set(pages)
function note(ref, page) {
  if (EXPECTED_ABSENT.some((re) => re.test(ref))) return
  if (isRedirect(ref)) return
  if (!broken.has(ref)) broken.set(ref, new Set())
  broken.get(ref).add(page)
}

for (const f of htmlFiles) {
  const rel = '/' + relative(DIR, f).split('\\').join('/')
  const html = await readFile(f, 'utf8')
  for (const ref of assetsFromHtml(html)) if (!resolves(ref)) note(ref, rel)
  // Navigation links, which assetsFromHtml only partly covers.
  for (const m of html.matchAll(/href=(["'])(.*?)\1/gi)) {
    const u = toLocalPath(m[2])
    if (!u) continue
    const bare = u.split('#')[0].split('?')[0]
    if (!bare || extname(bare)) continue
    if (!resolves(bare.endsWith('/') ? bare : bare + '/')) note(bare, rel)
  }
}
for (const f of cssFiles) {
  const rel = '/' + relative(DIR, f).split('\\').join('/')
  for (const ref of assetsFromCss(await readFile(f, 'utf8'), rel)) if (!resolves(ref)) note(ref, rel)
}

const brokenList = [...broken.entries()].sort((a, b) => b[1].size - a[1].size)
console.log(`\n2. Unresolved references: ${brokenList.length}`)
for (const [ref, pages] of brokenList.slice(0, 40)) {
  console.log(`   ${String(pages.size).padStart(4)}x  ${ref}`)
  if (pages.size <= 3) for (const p of pages) console.log(`          on ${p}`)
}
if (brokenList.length > 40) console.log(`   …and ${brokenList.length - 40} more`)

// ---- 3. live-origin URLs that would still load ----------------------------

/**
 * Canonical, og:, twitter:, article: and the JSON-LD graph are supposed to name
 * the live origin — they are identity, not fetches. Anything else pointing at
 * the live host means the mirror would pull that byte from production.
 */
const leaks = new Map()
for (const f of [...htmlFiles, ...cssFiles]) {
  const rel = '/' + relative(DIR, f).split('\\').join('/')
  const text = await readFile(f, 'utf8')
  const stripped = text
    .replace(/<link[^>]+rel=["'](?:canonical|alternate|shortlink|EditURI|https:\/\/api\.w\.org\/)["'][^>]*>/gi, '')
    .replace(/<meta[^>]+(?:property|name)=["'](?:og:[a-z:_]+|twitter:[a-z:_]+|article:[a-z:_]+|product:[a-z:_]+)["'][^>]*>/gi, '')
    .replace(/<script[^>]+type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi, '')
  for (const m of stripped.matchAll(/https?:(?:\\)?\/(?:\\)?\/(?:www\.)?fitroofingco\.com[^\s"'<>)]*/g)) {
    const key = m[0].slice(0, 120)
    if (!leaks.has(key)) leaks.set(key, new Set())
    leaks.get(key).add(rel)
  }
}
const leakList = [...leaks.entries()].sort((a, b) => b[1].size - a[1].size)
console.log(`\n3. Live-origin URLs outside identity metadata: ${leakList.length}`)
for (const [u, pages] of leakList.slice(0, 25)) console.log(`   ${String(pages.size).padStart(4)}x  ${u}`)
if (leakList.length > 25) console.log(`   …and ${leakList.length - 25} more`)

// ---- 4. title/description match the live site ------------------------------

if (LIVE) {
  console.log('\n4. Comparing <title> and meta description against live…')
  const grab = (html, re) => { const m = re.exec(html); return m ? m[1].trim() : null }
  const T = /<title[^>]*>([\s\S]*?)<\/title>/i
  const D = /<meta\s+name=["']description["']\s+content=["']([\s\S]*?)["']/i
  const diffs = []
  let checked = 0
  let i = 0
  await Promise.all(Array.from({ length: 5 }, async () => {
    while (i < routes.length) {
      const r = routes[i++]
      if (extname(r)) continue
      const f = join(DIR, r, 'index.html')
      if (!existsSync(f)) continue
      const mine = await readFile(f, 'utf8')
      let live
      try {
        const res = await fetch(ORIGIN + r, { headers: { 'User-Agent': UA } })
        live = await res.text()
      } catch { continue }
      checked++
      const lt = grab(live, T), mt = grab(mine, T)
      const ld = grab(live, D), md = grab(mine, D)
      if (lt !== mt) diffs.push(`${r}\n     live title: ${lt}\n     mine:       ${mt}`)
      if (ld !== md) diffs.push(`${r}\n     live desc:  ${ld}\n     mine:       ${md}`)
    }
  }))
  console.log(`   checked ${checked} pages — ${diffs.length} difference(s)`)
  for (const d of diffs.slice(0, 20)) console.log(`   ! ${d}`)
}

const fail = missingRoutes.length + shrunk.length + brokenList.length + leakList.length
console.log(`\n${fail === 0 ? 'PASS — mirror is complete and self-contained.' : `${fail} issue group(s) above.`}`)
