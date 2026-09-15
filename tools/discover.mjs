/**
 * Work out what "the whole site" actually is, and write it to routes.txt.
 *
 * The sitemaps are a starting point, not the answer: Yoast omits paginated
 * archives, WooCommerce product-category and tag archives, author archives, the
 * feeds, and anything the client has deliberately excluded but still links to.
 * So this starts from the sitemaps, then crawls every same-origin link it finds
 * until nothing new turns up, recording the HTTP status of each URL.
 *
 * Output:
 *   routes.txt     the capture manifest (200-only, one path per line)
 *   .probe.json    full record: status, redirect target, title, bytes
 *
 * Usage:
 *   node tools/discover.mjs
 *   node tools/discover.mjs --depth 3      # stop crawling after N waves
 */
import { writeFile } from 'node:fs/promises'
import { join, extname, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ORIGIN, UA, toLocalPath } from './site.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CONCURRENCY = Number(process.env.CONCURRENCY || 6)
const args = process.argv.slice(2)
const argVal = (f) => { const i = args.indexOf(f); return i === -1 ? null : args[i + 1] }
const MAX_DEPTH = Number(argVal('--depth') || 12)

/** Routes a static mirror must not try to capture as pages. */
const SKIP = [
  /^\/wp-admin/, /^\/wp-login/, /^\/wp-json/, /^\/wp-cron/, /^\/xmlrpc/,
  /^\/feed\/?$/, // handled explicitly as an orphan, not crawled into
  /^\/\?/,
]

const probe = new Map()   // path -> { status, location, title, bytes, from }
const queue = []
const seen = new Set()

function enqueue(path, from) {
  if (!path || seen.has(path)) return
  if (SKIP.some((re) => re.test(path))) return
  seen.add(path)
  queue.push({ path, from })
}

async function get(url, { redirect = 'manual' } = {}) {
  for (let i = 0; i < 3; i++) {
    try {
      return await fetch(url, { redirect, headers: { 'User-Agent': UA } })
    } catch (e) {
      if (i === 2) throw e
      await new Promise((r) => setTimeout(r, 500 * (i + 1)))
    }
  }
}

/** Same-origin page links (extension-less, or .xml/.html) found in a document. */
function linksFrom(html) {
  const out = new Set()
  for (const m of html.matchAll(/href=(["'])(.*?)\1/gi)) {
    let u = toLocalPath(m[2])
    if (!u) continue
    u = u.split('#')[0]
    // Query strings are WooCommerce/Elementor state (add-to-cart, orderby,
    // filters), not distinct documents. robots.txt disallows them all.
    if (u.includes('?')) continue
    if (!u) continue
    const ext = extname(u)
    if (ext && ext !== '.xml' && ext !== '.html') continue
    if (!ext && !u.endsWith('/')) u += '/'
    out.add(u)
  }
  return [...out]
}

// ---- seed from the sitemaps ------------------------------------------------

console.log('Reading sitemaps…')
const seeds = new Set(['/'])
const sitemapFiles = new Set(['/sitemap_index.xml'])

const idx = await (await get(`${ORIGIN}/sitemap_index.xml`, { redirect: 'follow' })).text()
for (const m of idx.matchAll(/<loc>([^<]+)<\/loc>/g)) {
  const p = toLocalPath(m[1])
  if (p) sitemapFiles.add(p)
}
for (const sm of [...sitemapFiles]) {
  if (sm === '/sitemap_index.xml') continue
  const xml = await (await get(ORIGIN + sm, { redirect: 'follow' })).text()
  for (const m of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) {
    const p = toLocalPath(m[1])
    if (p) seeds.add(p)
  }
}
console.log(`  ${seeds.size} URLs across ${sitemapFiles.size} sitemap files`)

/**
 * Routes WordPress always answers on that nothing necessarily links to. Each is
 * probed like any other candidate, so anything that 404s simply drops out.
 */
const WELL_KNOWN = [
  // In no sitemap, but each answers 200 on the live site (checked against the
  // REST API inventory on 15 September 2026): a second copy of the homepage,
  // the empty default category, the blog's second page and four tag archives.
  '/home-2/', '/uncategorized/', '/blog/page/2/',
  '/tag/maintenance/', '/tag/planning/', '/tag/professional-services/', '/tag/property-protection/',
  // Redirects on the live site, probed so they are recorded in .probe.json and
  // carried into _redirects rather than silently becoming 404s.
  '/home/', '/author/p3akl3ads/', '/author/seodev2/', '/2026/', '/category/uncategorized/',
  '/comments/feed/', '/blog/feed/', '/sitemap.xml', '/wp-sitemap.xml',
]
for (const p of [...seeds, ...WELL_KNOWN]) enqueue(p, 'seed')

// ---- crawl -----------------------------------------------------------------

let depth = 0
let cursor = 0
while (cursor < queue.length && depth < MAX_DEPTH) {
  const wave = queue.slice(cursor)
  cursor = queue.length
  depth++
  console.log(`Wave ${depth}: ${wave.length} URLs…`)
  let i = 0
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (i < wave.length) {
      const { path, from } = wave[i++]
      try {
        const res = await get(ORIGIN + path)
        const rec = { status: res.status, from }
        if (res.status >= 300 && res.status < 400) {
          rec.location = (res.headers.get('location') || '').replace(ORIGIN, '') || '/'
          probe.set(path, rec)
          // Follow the redirect target so its own page is captured too.
          const t = toLocalPath(rec.location) || rec.location
          if (t && t.startsWith('/')) enqueue(t, path)
          continue
        }
        const ct = res.headers.get('content-type') || ''
        const body = await res.text()
        rec.bytes = body.length
        rec.type = ct.split(';')[0]
        const tm = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(body)
        if (tm) rec.title = tm[1].trim().slice(0, 120)
        probe.set(path, rec)
        if (res.ok && ct.includes('html')) for (const l of linksFrom(body)) enqueue(l, path)
      } catch (e) {
        probe.set(path, { status: 0, error: e.message, from })
      }
    }
  }))
}

// The sitemaps and robots.txt are part of the mirror even though no page links
// to them; crawlers ask for them directly.
for (const sm of sitemapFiles) probe.set(sm, { status: 200, type: 'text/xml', from: 'orphan' })
probe.set('/robots.txt', { status: 200, type: 'text/plain', from: 'orphan' })

// ---- report ----------------------------------------------------------------

const all = [...probe.entries()].sort((a, b) => a[0].localeCompare(b[0]))
const ok = all.filter(([, r]) => r.status === 200)
const redirects = all.filter(([, r]) => r.status >= 300 && r.status < 400)
const missing = all.filter(([, r]) => r.status === 404)
const other = all.filter(([, r]) => r.status !== 200 && !(r.status >= 300 && r.status < 400) && r.status !== 404)

const routes = ok.filter(([p]) => !extname(p) || extname(p) === '.xml').map(([p]) => p)

await writeFile(join(ROOT, 'routes.txt'),
  '# Every URL that answers 200 on fitroofingco.com, as discovered by\n' +
  '# tools/discover.mjs. This is the capture manifest for tools/mirror-browser.mjs.\n' +
  `# Generated ${new Date().toISOString().slice(0, 10)} — ${routes.length} routes.\n` +
  routes.join('\n') + '\n')

await writeFile(join(ROOT, '.probe.json'), JSON.stringify(Object.fromEntries(all), null, 1))

console.log('\n--- discovery complete ---')
console.log(`200:        ${ok.length}`)
console.log(`redirects:  ${redirects.length}`)
console.log(`404:        ${missing.length}`)
console.log(`other:      ${other.length}`)
console.log(`routes.txt: ${routes.length} routes`)
if (redirects.length) {
  console.log('\nRedirects on the live site (these must be reproduced at the new host):')
  for (const [p, r] of redirects) console.log(`  ${r.status}  ${p}  ->  ${r.location}`)
}
if (missing.length) {
  console.log('\nLinked but 404 on the live site (broken there, not here):')
  for (const [p, r] of missing.slice(0, 40)) console.log(`  404  ${p}   (linked from ${r.from})`)
  if (missing.length > 40) console.log(`  …and ${missing.length - 40} more`)
}
if (other.length) {
  console.log('\nOther statuses:')
  for (const [p, r] of other) console.log(`  ${r.status || r.error}  ${p}   (from ${r.from})`)
}
