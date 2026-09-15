/**
 * Browser-driven mirror of fitroofingco.com.
 *
 * A plain HTTP fetch gets the HTML but not the site. This build is Elementor +
 * WooCommerce: background images live in JSON attributes that only the runtime
 * resolves, images sit on data-src until something scrolls them into view,
 * Swiper carousels and Lottie players pull their assets after load, and WP
 * Rocket defers a large share of the JavaScript. So every route is opened in a
 * real Chromium, scrolled top to bottom, given time to settle, and every
 * response the browser actually made is written to disk.
 *
 * Usage:
 *   node tools/mirror-browser.mjs                 # every route in routes.txt
 *   node tools/mirror-browser.mjs / /shop/        # just these routes
 *   TABS=6 node tools/mirror-browser.mjs
 *   MIRROR_DIR=_probe node tools/mirror-browser.mjs
 */
import { chromium } from 'playwright-core'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ORIGIN, UA, rewrite, pathToFile, isPlausiblePage, describeBadPage,
} from './site.mjs'
import { blockAnalytics } from './browser.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, process.env.MIRROR_DIR || '.')
const RAW = join(ROOT, '_raw')
const TABS = Number(process.env.TABS || 4)
const EXEC = process.env.CHROME || join(process.env.USERPROFILE || process.env.HOME || '',
  'AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe')

async function routeManifest() {
  const text = await readFile(join(ROOT, process.env.ROUTES_FILE || 'routes.txt'), 'utf8')
  return text.split('\n').map((s) => s.trim()).filter((s) => s && !s.startsWith('#'))
}

const cliRoutes = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const FULL_RUN = cliRoutes.length === 0
const routes = FULL_RUN ? await routeManifest() : cliRoutes

const stats = { pages: 0, assets: 0, failed: [] }
const written = new Set()

/** Resolve to null rather than hanging for ever. */
function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((r) => setTimeout(() => r(null), ms))])
}

await mkdir(OUT, { recursive: true })
await mkdir(RAW, { recursive: true })

const browser = await chromium.launch({ executablePath: EXEC })
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  userAgent: UA,
  deviceScaleFactor: 1,
})
// Every page view here would otherwise be counted in the client's analytics.
await blockAnalytics(ctx)
// A cold WooCommerce session is what a first-time visitor gets, and it is what
// the mirrored cart/checkout/my-account pages have to show. Nothing here logs
// in or adds to the cart, so that state stays cold for the whole run.

/**
 * Persist one response if it belongs to this site and is not already stored.
 *
 * Documents are excluded deliberately: visit() writes the page's own HTML after
 * rewriting it, and this handler fires for that same response. Both would write
 * the same path, and whichever landed last would decide whether the page kept
 * live-origin URLs — a race, and one the rewritten copy has to win.
 */
async function store(res) {
  const url = res.url()
  if (!url.startsWith(ORIGIN)) return                 // third-party CDN: left alone
  if (res.status() !== 200) return
  if (res.request().resourceType() === 'document') return

  const urlPath = url.slice(ORIGIN.length) || '/'
  const bare = urlPath.split('?')[0]
  if (/\.php(\?|$)/.test(bare)) return                // admin-ajax etc. cannot run statically
  if (bare.startsWith('/wp-json/')) return            // REST API: no static equivalent

  // Never let an asset response land on a page's path. WooCommerce refreshes
  // the mini-cart with GET /?wc-ajax=get_refreshed_fragments — an XHR, so it is
  // not resourceType 'document', and its path is "/" once the query is dropped.
  // That mapped straight onto index.html and replaced the 250 KB homepage with
  // an 827-byte JSON blob, silently, on a run that reported success.
  //
  // Every real asset has a file extension; every page route does not. So the
  // rule is simply: no extension, not ours to write.
  if (!extname(bare)) return

  const file = pathToFile(OUT, urlPath)
  if (written.has(file)) return

  // res.body() has no timeout of its own, and a response that never finishes
  // arriving leaves the promise pending for ever. visit() waits on every one of
  // these before closing its tab, so a single hung body stalls that worker
  // permanently — which is exactly how a first run of this tool wedged all five
  // workers at 108 of 186 pages with no error and no progress.
  let buf
  try { buf = await withTimeout(res.body(), 20000) } catch { return }
  if (!buf) return
  written.add(file)
  await mkdir(dirname(file), { recursive: true })

  const ext = extname(bare)
  if (ext === '.css' || ext === '.js' || ext === '.json' || ext === '.svg') {
    await writeFile(file, rewrite(buf.toString('utf8'), false))
  } else {
    await writeFile(file, buf)
  }
  stats.assets++
}

/**
 * Walk the page the way a visitor does, so everything deferred actually loads:
 * scroll to the bottom in steps small enough that each lazy image crosses the
 * viewport, let Swiper and Lottie start, then return to the top so any
 * scroll-triggered state that changes the DOM is left in its initial position.
 */
async function exercise(page) {
  // The step count is capped, and the cap matters. scrollHeight is re-read on
  // every iteration because that is the point — lazy content grows the page as
  // it loads — but a widget that keeps appending height makes the loop's own
  // exit condition recede for ever, and page.evaluate has no timeout to break
  // it. So the number of steps is fixed up front: 400 steps at 60% of the
  // viewport covers a page roughly 200 screens tall, far past anything here.
  await withTimeout(page.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
    const step = Math.max(200, Math.round(window.innerHeight * 0.6))
    let y = 0
    for (let i = 0; i < 400; i++) {
      if (y >= document.body.scrollHeight) break
      window.scrollTo(0, y)
      await sleep(90)
      y += step
    }
    window.scrollTo(0, document.body.scrollHeight)
    await sleep(300)
    window.scrollTo(0, 0)
    await sleep(150)
  }).catch(() => {}), 60000)

  // Force anything still parked on a lazy attribute to resolve. WP Rocket's
  // lazyload and Elementor both use these, and a carousel slide that never
  // entered the viewport keeps its placeholder otherwise.
  await page.evaluate(() => {
    for (const el of document.querySelectorAll('[data-lazy-src],[data-src]')) {
      const v = el.getAttribute('data-lazy-src') || el.getAttribute('data-src')
      if (v && !el.getAttribute('src')) el.setAttribute('src', v)
    }
    for (const el of document.querySelectorAll('[data-lazy-srcset],[data-srcset]')) {
      const v = el.getAttribute('data-lazy-srcset') || el.getAttribute('data-srcset')
      if (v && !el.getAttribute('srcset')) el.setAttribute('srcset', v)
    }
  }).catch(() => {})

  await page.waitForTimeout(1200)
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {})
}

async function visit(route) {
  const page = await ctx.newPage()
  const pending = []
  // Response bodies have to be read before the page closes, so every store()
  // promise is kept and settled below. Fire-and-forget silently loses any asset
  // whose body is still being read when the tab goes away.
  const docs = new Map()
  page.on('response', (r) => {
    if (r.request().resourceType() === 'document') {
      if (!docs.has(r.url())) {
        docs.set(r.url(), withTimeout(r.body(), 20000)
          .then((b) => (b ? b.toString('utf8') : null)).catch(() => null))
      }
      return
    }
    pending.push(store(r).catch(() => {}))
  })
  page.on('pageerror', () => {})   // live-site JS errors are not ours to fix

  try {
    const res = await page.goto(ORIGIN + route, { waitUntil: 'domcontentloaded', timeout: 60000 })
    if (!res) throw new Error('no response')

    // goto()'s own response is the document to keep. Chromium sometimes evicts
    // the body before it is read, so the captured copy is the fallback.
    //
    // Both reads are bounded. res.text() waits for the whole body with no
    // timeout of its own, so a response that stops arriving mid-stream parks
    // this worker for ever — no error, no progress, and with every worker in
    // that state the run simply stops. That is what wedged the first attempt.
    let html = await withTimeout(res.text().catch(() => null), 25000)
    if (html == null) html = await docs.get(res.url())
    if (html == null) throw new Error('could not read the document body')

    await exercise(page)

    if (!isPlausiblePage(html)) {
      stats.failed.push(`${route} — rejected: ${describeBadPage(html)}`)
      await withTimeout(Promise.allSettled(pending), 30000)
      await page.close().catch(() => {})
      return
    }

    // The untouched capture, kept out of the published tree, so any later
    // question about what the rewrite changed can be answered from the bytes
    // the server actually sent rather than from memory.
    const rawFile = pathToFile(RAW, route)
    await mkdir(dirname(rawFile), { recursive: true })
    await writeFile(rawFile, html)

    const file = pathToFile(OUT, route)
    await mkdir(dirname(file), { recursive: true })
    await writeFile(file, rewrite(html, true))
    stats.pages++
    if (stats.pages % 10 === 0) {
      console.log(`  …${stats.pages}/${todo.length} pages, ${stats.assets} assets`)
    }
  } catch (e) {
    stats.failed.push(`${route} — ${e.message.split('\n')[0]}`)
  }
  await withTimeout(Promise.allSettled(pending), 30000)
  await page.close().catch(() => {})
}

// The sitemaps are in routes.txt because they are part of the mirror, but they
// are not pages: opening one in a browser yields Chromium's XML viewer, which
// has no <body> and so fails the plausibility check every time. They are
// fetched verbatim in the orphan pass below, which is the only correct way to
// store them anyway.
const pageRoutes = routes.filter((r) => !r.endsWith('.xml'))

// --resume skips routes already captured, so an interrupted run continues
// instead of refetching 100+ pages and every asset attached to them.
const todo = process.argv.includes('--resume')
  ? pageRoutes.filter((r) => !existsSync(pathToFile(RAW, r)))
  : pageRoutes

console.log(`Browser-mirroring ${todo.length} routes into ${OUT}` +
  (todo.length !== pageRoutes.length ? ` (${pageRoutes.length - todo.length} already captured)` : ''))

let i = 0
await Promise.all(Array.from({ length: TABS }, async () => {
  while (i < todo.length) {
    const route = todo[i++]
    // Outer watchdog. Every wait inside visit() is individually bounded, but
    // this is the guarantee that one pathological page can never cost more
    // than its share of the run, whatever the cause turns out to be.
    const done = await withTimeout(visit(route).then(() => true), 180000)
    if (!done) stats.failed.push(`${route} — abandoned after 180s`)
  }
}))

// ---- files no page links to ------------------------------------------------

const recordedRedirects = []

async function fetchDirect(urlPath, saveAs) {
  try {
    // Deliberately not followed: several of these are redirects on the live
    // site, and following one would save the target's body under the source's
    // path instead of recording that a redirect is needed at the new host.
    const res = await fetch(ORIGIN + urlPath, {
      headers: { 'User-Agent': UA }, redirect: 'manual',
    })
    if (res.status >= 300 && res.status < 400) {
      const to = (res.headers.get('location') || '').replace(ORIGIN, '') || '/'
      recordedRedirects.push(`${urlPath}  ${to}  ${res.status}`)
      return null
    }
    const body = Buffer.from(await res.arrayBuffer())
    if (!res.ok && !saveAs) return `${res.status} ${urlPath}`
    const file = saveAs ? join(OUT, saveAs) : pathToFile(OUT, urlPath)
    await mkdir(dirname(file), { recursive: true })
    // Sitemaps and robots.txt are written verbatim, deliberately. Both specs
    // require absolute URLs — a root-relative <loc> makes a sitemap invalid and
    // a relative Sitemap: line in robots.txt is ignored — so the rewrite that
    // makes pages origin-independent must not touch them.
    const isMeta = urlPath.endsWith('.xml') || urlPath.endsWith('.txt')
    await writeFile(file, isMeta ? body : Buffer.from(rewrite(body.toString('utf8'), true)))
    stats.assets++
    return null
  } catch (e) { return `${urlPath} — ${e.message}` }
}

if (FULL_RUN) {
  console.log('\nFetching files no page links to (sitemaps, robots.txt, 404 template)…')
  const orphans = [
    ['/robots.txt', null],
    ['/sitemap_index.xml', null],
    ['/post-sitemap.xml', null],
    ['/page-sitemap.xml', null],
    // Yoast's generated llms.txt. Absolute URLs, so written verbatim like the
    // sitemaps.
    ['/llms.txt', null],
    // WordPress renders the 404 template at any unused path. Saved at the root
    // as 404.html, which is what every static host looks for.
    ['/this-path-does-not-exist-mirror-404-probe/', '404.html'],
    // Not files: each of these is a redirect on the live site. Requesting them
    // unfollowed records the rule in _redirects.observed.
    ['/feed/', null], ['/comments/feed/', null], ['/blog/feed/', null],
    ['/sitemap.xml', null], ['/wp-sitemap.xml', null], ['/home/', null], ['/favicon.ico', null],
  ]
  for (const [u, as] of orphans) {
    const err = await fetchDirect(u, as)
    if (err) stats.failed.push(`orphan ${err}`)
  }

  if (recordedRedirects.length) {
    const dest = join(OUT, '_redirects.observed')
    await writeFile(dest,
      '# Redirects observed while mirroring. Reconciled by hand into _redirects.\n' +
      recordedRedirects.join('\n') + '\n')
    console.log(`  noted ${recordedRedirects.length} redirect(s) in _redirects.observed`)
  }
}

await browser.close()
console.log('\n--- browser mirror complete ---')
console.log(`pages:   ${stats.pages}`)
console.log(`assets:  ${stats.assets}`)
console.log(`failed:  ${stats.failed.length}`)
for (const f of stats.failed.slice(0, 30)) console.log(`  ! ${f}`)
if (stats.failed.length > 30) console.log(`  …and ${stats.failed.length - 30} more`)
