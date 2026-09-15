/**
 * Is the copy still, byte for byte, what the live site serves?
 *
 * The scroll-through review watches behaviour in one browser at a few widths.
 * This answers the question underneath it for every width and every browser at
 * once. A page is built from three kinds of bytes: its HTML, the site's own
 * stylesheets and scripts, and third-party code fetched from other hosts. If the
 * first two are identical to live — after live's copy has been through the same
 * origin rewrite the mirror applied — then everything they define is identical
 * by construction: which elements animate and with what effect, duration, delay
 * and easing; every hover state; the tablet and narrow-phone breakpoints; the
 * menu script. What that leaves is only what bytes cannot settle: load timing,
 * and third-party code (Trustindex, FastBots, Google) that both sides fetch from
 * the same place.
 *
 * It also catches drift — live being edited after the capture.
 *
 *   node tools/parity.mjs             # every page, sitemap, robots, llms, 404,
 *                                     # and every same-origin CSS/JS/JSON/SVG/XSL
 *   node tools/parity.mjs --binary    # also hash every image, font and video
 *   node tools/parity.mjs /about/     # just these pages, no assets
 */
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join, resolve, dirname, extname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ORIGIN, UA, rewrite } from './site.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const BINARY = args.includes('--binary')
const cli = args.filter((a) => !a.startsWith('--'))
const CONCURRENCY = Number(process.env.CONCURRENCY || 6)

/**
 * Values WordPress and its plugins regenerate on every render, which would make
 * two fetches of an unchanged page differ. Each is swapped for a fixed marker on
 * both sides before comparing. They are listed one by one, narrowly, so nothing
 * real can hide behind a pattern broader than it needs to be.
 */
const VOLATILE = [
  [/("[a-z_]*nonce"\s*:\s*")[a-f0-9]{10}(")/gi, '$1NONCE$2'],
  [/(_wpnonce=)[a-f0-9]{10}/gi, '$1NONCE'],
  [/(data-nonce=")[a-f0-9]{10}(")/gi, '$1NONCE$2'],
  // Trustindex: base64 of the page path plus a _wpnonce.
  [/(<meta name="ti-site-data" content=")[^"]*(")/g, '$1TI-SITE-DATA$2'],
]
const normalise = (s) => VOLATILE.reduce((t, [re, to]) => t.replace(re, to), s.replace(/\r\n/g, '\n'))

async function get(urlPath) {
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(ORIGIN + urlPath, { headers: { 'User-Agent': UA }, redirect: 'manual' })
      return { status: res.status, buf: Buffer.from(await res.arrayBuffer()) }
    } catch (e) {
      if (i === 2) return { status: 0, buf: Buffer.alloc(0), error: e.message }
      await new Promise((r) => setTimeout(r, 700 * (i + 1)))
    }
  }
}

async function pool(items, fn) {
  const out = new Array(items.length)
  let i = 0
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]) }
  }))
  return out
}

function firstDifference(x, y) {
  let i = 0
  while (i < x.length && i < y.length && x[i] === y[i]) i++
  const from = Math.max(0, i - 80)
  return { at: i, live: x.slice(from, i + 120), copy: y.slice(from, i + 120) }
}

/** Lines on one side and not the other, each live-only line paired with a copy-only one. */
function lineDelta(a, b) {
  const count = (s) => { const m = new Map(); for (const l of s.split('\n')) m.set(l, (m.get(l) || 0) + 1); return m }
  const A = count(a), B = count(b)
  const onlyLive = [], onlyCopy = []
  for (const [l, n] of A) for (let k = 0; k < n - (B.get(l) || 0); k++) onlyLive.push(l)
  for (const [l, n] of B) for (let k = 0; k < n - (A.get(l) || 0); k++) onlyCopy.push(l)
  const pairs = []
  for (let k = 0; k < Math.max(onlyLive.length, onlyCopy.length) && pairs.length < 8; k++) {
    const l = onlyLive[k] ?? '', c = onlyCopy[k] ?? ''
    pairs.push(firstDifference(l, c))
  }
  return { onlyLive: onlyLive.length, onlyCopy: onlyCopy.length, pairs }
}

// ---- documents ---------------------------------------------------------------

const routes = cli.length ? cli
  : (await readFile(join(ROOT, 'routes.txt'), 'utf8')).split('\n').map((s) => s.trim())
      .filter((s) => s && !s.startsWith('#'))

const docs = routes.map((r) => ({ path: r, file: extname(r) ? r : r + 'index.html', kind: extname(r) ? 'verbatim' : 'page' }))
if (!cli.length) {
  docs.push({ path: '/robots.txt', file: '/robots.txt', kind: 'verbatim' })
  docs.push({ path: '/llms.txt', file: '/llms.txt', kind: 'verbatim' })
  // The same unused path the capture requested, so the template renders the same.
  docs.push({ path: '/this-path-does-not-exist-mirror-404-probe/', file: '/404.html', kind: 'page', status: 404 })
}

console.log(`Parity against ${ORIGIN}: ${docs.length} document(s)…`)
const docResults = await pool(docs, async (d) => {
  const local = await readFile(join(ROOT, d.file), 'utf8').catch(() => null)
  if (local == null) return { ...d, ok: false, reason: 'missing in the repo' }
  const live = await get(d.path)
  if (live.status !== (d.status || 200)) return { ...d, ok: false, reason: `live answered ${live.status || live.error}` }
  const liveText = live.buf.toString('utf8')
  const expected = d.kind === 'page' ? rewrite(liveText, true) : liveText
  if (expected === local) return { ...d, ok: true, exact: true }
  const A = normalise(expected), B = normalise(local)
  if (A === B) return { ...d, ok: true, exact: false }
  const delta = lineDelta(A, B)
  return { ...d, ok: false, reason: `${delta.onlyLive} line(s) only on live, ${delta.onlyCopy} only in the copy`, delta }
})

// ---- the site's own files ----------------------------------------------------

const SKIP = new Set(['.git', 'node_modules', '_raw', 'tools', 'shots', '.probe'])
const TEXT = new Set(['.css', '.js', '.json', '.svg', '.xsl', '.txt', '.xml', '.html'])
async function walk(dir, out = []) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue
    const p = join(dir, e.name)
    if (e.isDirectory()) await walk(p, out)
    else out.push(p)
  }
  return out
}

let assets = []
if (!cli.length) {
  assets = (await walk(ROOT)).map((f) => '/' + relative(ROOT, f).split('\\').join('/'))
    .filter((p) => p.startsWith('/wp-content/') || p.startsWith('/wp-includes/'))
    .filter((p) => BINARY || TEXT.has(extname(p).toLowerCase()))
}
if (assets.length) console.log(`…and ${assets.length} same-origin file(s)${BINARY ? ' including binaries' : ''}`)

const sha = (b) => createHash('sha256').update(b).digest('hex')
const assetResults = await pool(assets, async (p) => {
  const local = await readFile(join(ROOT, p))
  const live = await get(encodeURI(p))
  if (live.status !== 200) return { path: p, ok: false, reason: `live answered ${live.status || live.error}` }
  if (TEXT.has(extname(p).toLowerCase())) {
    // Line endings are normalised: .gitattributes stores text as LF, so a CRLF
    // file from the server is byte-different in a checkout while identical to a
    // browser.
    const lt = live.buf.toString('utf8').replace(/\r\n/g, '\n')
    const lc = local.toString('utf8').replace(/\r\n/g, '\n')
    if (lc === lt || lc === rewrite(lt, false)) return { path: p, ok: true }
    const d = firstDifference(rewrite(lt, false), lc)
    return { path: p, ok: false, reason: `differs at character ${d.at} (live ${lt.length}, copy ${lc.length})`, snippet: d }
  }
  return sha(live.buf) === sha(local)
    ? { path: p, ok: true }
    : { path: p, ok: false, reason: `sha256 differs (live ${live.buf.length} bytes, copy ${local.length})` }
})

// ---- report ------------------------------------------------------------------

const badDocs = docResults.filter((r) => !r.ok)
const badAssets = assetResults.filter((r) => !r.ok)
const exact = docResults.filter((r) => r.ok && r.exact).length

console.log(`\nDocuments identical to live: ${docResults.length - badDocs.length}/${docResults.length}` +
  ` (${exact} byte-exact, ${docResults.length - badDocs.length - exact} identical once per-render nonces are masked)`)
for (const r of badDocs) {
  console.log(`  ! ${r.path}  ${r.reason}`)
  for (const p of (r.delta?.pairs || []).slice(0, 4)) {
    console.log(`      at ${p.at}\n        live: ${JSON.stringify(p.live)}\n        copy: ${JSON.stringify(p.copy)}`)
  }
}
if (assets.length) {
  console.log(`\nSite files identical to live: ${assetResults.length - badAssets.length}/${assetResults.length}`)
  for (const r of badAssets) {
    console.log(`  ! ${r.path}  ${r.reason}`)
    if (r.snippet) console.log(`        live: ${JSON.stringify(r.snippet.live)}\n        copy: ${JSON.stringify(r.snippet.copy)}`)
  }
}

await writeFile(join(ROOT, '.parity.json'), JSON.stringify({ docs: docResults, assets: assetResults }, null, 1))
const fail = badDocs.length + badAssets.length
console.log(`\n${fail === 0 ? 'PASS — the copy is byte-identical to what live serves now.' : `${fail} file(s) differ from live.`}`)
process.exitCode = fail ? 1 : 0
