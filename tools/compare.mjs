/**
 * Compare the mirror against the live site the way a person would: open both in
 * a real browser, scroll each one to the bottom so lazy images, carousels and
 * scroll-triggered animations actually run, then check that what ended up on
 * screen matches.
 *
 * Comparing HTML would not answer this. Two documents can be byte-identical and
 * still render differently if a stylesheet, a font or a script is missing from
 * the copy, and that is exactly the failure this is looking for. So the checks
 * are all made against the rendered page:
 *
 *   - full-page screenshot of each, diffed pixel by pixel
 *   - visible text, compared word for word
 *   - counts of img/video/iframe/svg, and how many images actually decoded
 *   - every console error and failed request the copy produces
 *
 * Needs `node tools/serve.mjs` running (or pass --local http://host:port).
 *
 *   node tools/compare.mjs                    # every route in routes.txt
 *   node tools/compare.mjs / /shop/           # just these
 *   node tools/compare.mjs --mobile           # 390x844 instead of 1440x900
 *   node tools/compare.mjs --shots            # keep the PNGs in shots/
 */
import { chromium } from 'playwright-core'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ORIGIN, UA } from './site.mjs'
import { blockAnalytics } from './browser.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const argVal = (f) => { const i = args.indexOf(f); return i === -1 ? null : args[i + 1] }
const LOCAL = argVal('--local') || 'http://localhost:4400'
const MOBILE = args.includes('--mobile')
const KEEP_SHOTS = args.includes('--shots')
const SHOTS = join(ROOT, 'shots', MOBILE ? 'mobile' : 'desktop')
const EXEC = process.env.CHROME || join(process.env.USERPROFILE || process.env.HOME || '',
  'AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe')
const VIEWPORT = MOBILE ? { width: 390, height: 844 } : { width: 1440, height: 900 }

/**
 * A screenshot of a page carrying a live chat widget, autoplaying video and a
 * YouTube embed will never match twice in a row. Those three are hidden on both
 * sides so the pixel diff reports layout and content drift rather than the frame
 * each happened to be on.
 *
 * The Trustindex reviews widget is deliberately NOT hidden any more. It used to
 * be, and that was a mistake: its stylesheet was missing from the copy, so it
 * rendered several thousand pixels tall with full-size avatars and a collapsed
 * card grid — and the comparison, told to ignore anything matching
 * `[class*="trustindex"]`, reported those pages as pixel-perfect. A check that
 * hides a widget cannot tell you the widget is broken.
 *
 * Its carousel does rotate, so it is frozen on its first slide instead of
 * hidden, and its geometry is compared separately below.
 */
const NEUTRALISE = `
  for (const el of document.querySelectorAll(
      'iframe, video, [id*="fastbots"], [class*="fastbots"]')) {
    el.style.visibility = 'hidden'
  }
  const s = document.createElement('style')
  s.textContent = \`*,*::before,*::after{
    animation-duration:0s!important;animation-delay:0s!important;
    transition-duration:0s!important;transition-delay:0s!important;
    caret-color:transparent!important;scroll-behavior:auto!important}
    .ti-widget .ti-controls,.ti-widget .ti-next,.ti-widget .ti-prev{visibility:hidden!important}\`
  document.head.appendChild(s)
`

async function routeList() {
  const cli = args.filter((a) => !a.startsWith('--') && a !== LOCAL)
  if (cli.length) return cli
  const text = await readFile(join(ROOT, 'routes.txt'), 'utf8')
  return text.split('\n').map((s) => s.trim())
    .filter((s) => s && !s.startsWith('#') && !s.endsWith('.xml'))
}

const routes = await routeList()
await mkdir(SHOTS, { recursive: true })

const browser = await chromium.launch({ executablePath: EXEC })

/** Load one page, run it, and report what it rendered. */
async function capture(ctx, url, tag) {
  const page = await ctx.newPage()
  const errors = []
  const failed = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)) })
  page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 200)))
  page.on('requestfailed', (r) => {
    const u = r.url()
    // Third-party widgets fail independently on both sides and say nothing
    // about whether the copy is faithful.
    if (!u.startsWith(ORIGIN) && !u.startsWith(LOCAL)) return
    failed.push(`${r.failure()?.errorText || 'failed'}  ${u.replace(ORIGIN, '').replace(LOCAL, '')}`)
  })
  // A 404 is a perfectly successful HTTP exchange, so requestfailed never sees
  // it — but a 404 on the copy is exactly the signature of an asset that was
  // never downloaded, which is the main thing worth catching here.
  page.on('response', (r) => {
    const u = r.url()
    if (!u.startsWith(ORIGIN) && !u.startsWith(LOCAL)) return
    if (r.status() >= 400) failed.push(`HTTP ${r.status()}  ${u.replace(ORIGIN, '').replace(LOCAL, '')}`)
  })

  try {
    // 'load', not 'domcontentloaded'. WP Rocket attaches its delayed-script
    // interaction listeners late; input dispatched before they exist is simply
    // missed, and the delayed scripts then never run for the whole visit.
    await page.goto(url, { waitUntil: 'load', timeout: 60000 })
  } catch (e) {
    await page.close()
    return { error: e.message.split('\n')[0], tag }
  }

  // Real pointer input first. WP Rocket holds its delayed scripts until a
  // genuine user-input event, and window.scrollTo() from inside page.evaluate is
  // not one — it is script, not input. Every earlier pass of this tool scrolled
  // that way, so the delayed script never ran on either site and the Trustindex
  // widget stayed an empty <template> in both captures. Two identical blanks
  // compare as a perfect match, which is how a visibly broken widget passed.
  // A mouse move and one wheel tick release it.
  await page.mouse.move(200, 300, { steps: 6 }).catch(() => {})
  for (let i = 0; i < 4; i++) {
    await page.mouse.wheel(0, 500).catch(() => {})
    await page.waitForTimeout(150)
  }
  await page.mouse.move(700, 500, { steps: 6 }).catch(() => {})
  await page.waitForTimeout(800)

  // Then walk the page from script, which is fast, for the lazy images.
  await page.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
    const step = Math.max(200, Math.round(window.innerHeight * 0.6))
    let y = 0
    for (let i = 0; i < 400; i++) {
      if (y >= document.body.scrollHeight) break
      window.scrollTo(0, y); await sleep(80); y += step
    }
    window.scrollTo(0, document.body.scrollHeight); await sleep(250)
    window.scrollTo(0, 0); await sleep(150)
  }).catch(() => {})
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {})
  // The reviews widget is fetched and built after the delayed script releases,
  // so give it time to appear before anything is measured or screenshotted.
  await page.waitForSelector('.ti-widget', { timeout: 8000 }).catch(() => {})
  await page.evaluate(NEUTRALISE).catch(() => {})
  await page.waitForTimeout(600)

  const info = await page.evaluate(() => {
    const vis = (el) => {
      const s = getComputedStyle(el)
      return s.display !== 'none' && s.visibility !== 'hidden'
    }
    const imgs = [...document.images]
    return {
      title: document.title,
      text: (document.body.innerText || '').replace(/\s+/g, ' ').trim(),
      height: document.body.scrollHeight,
      counts: {
        img: imgs.length,
        imgLoaded: imgs.filter((i) => i.complete && i.naturalWidth > 0).length,
        video: document.querySelectorAll('video').length,
        iframe: document.querySelectorAll('iframe').length,
        svg: document.querySelectorAll('svg').length,
        link: [...document.querySelectorAll('a[href]')].filter(vis).length,
        button: document.querySelectorAll('button,[role="button"],.elementor-button').length,
        form: document.querySelectorAll('form').length,
      },
      // Images the browser tried and could not decode. On the copy this is the
      // signature of a file that was never downloaded.
      brokenImages: imgs.filter((i) => i.complete && i.naturalWidth === 0 && i.currentSrc)
        .map((i) => i.currentSrc.replace(location.origin, '')).slice(0, 25),

      // Third-party widgets, measured rather than trusted. The ones hidden for
      // the pixel diff are invisible to it by definition, and the reviews widget
      // proved that a widget can be catastrophically broken while every
      // whole-page measure still matches. A size is the cheapest thing that
      // cannot be faked: an unstyled widget is the wrong height, and a widget
      // that failed to build has no height at all.
      widgets: (() => {
        const box = (sel) => {
          const el = document.querySelector(sel)
          if (!el) return null
          const r = el.getBoundingClientRect()
          return { w: Math.round(r.width), h: Math.round(r.height) }
        }
        const ti = document.querySelector('.ti-widget')
        return {
          // Whether this page even has a reviews widget to check. Without it,
          // "trustindex: null on both sides" is ambiguous — it could mean the
          // page has no widget, or that the widget failed to build on both and
          // the comparison is blind. The template is in the served HTML either
          // way, so its presence separates the two cases.
          trustindexExpected: !!document.getElementById('trustindex-google-widget-html'),
          trustindex: box('.ti-widget'),
          trustindexReviews: ti ? ti.querySelectorAll('.ti-review-item').length : 0,
          trustindexAvatar: (() => {
            const a = ti && ti.querySelector('.ti-profile-img, img')
            if (!a) return null
            const r = a.getBoundingClientRect()
            return { w: Math.round(r.width), h: Math.round(r.height) }
          })(),
          chat: box('[class*="fastbots"], [id*="fastbots"]'),
        }
      })(),
    }
  })

  let shot = null
  try {
    shot = await page.screenshot({ fullPage: true, animations: 'disabled', timeout: 45000 })
  } catch { /* very tall pages can time out; the DOM checks still stand */ }

  await page.close()
  return { ...info, errors, failed, shot, tag }
}

/**
 * Pixel-diff two PNGs by decoding both in a page and comparing on a canvas.
 * Done in the browser to avoid a native image dependency for one number.
 */
const differ = await browser.newPage()
async function diffPct(a, b) {
  if (!a || !b) return null
  return differ.evaluate(async ([da, db]) => {
    const load = (d) => new Promise((res, rej) => {
      const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = d
    })
    const [ia, ib] = await Promise.all([load(da), load(db)])
    const w = Math.max(ia.width, ib.width), h = Math.max(ia.height, ib.height)
    const mk = (img) => {
      const c = document.createElement('canvas'); c.width = w; c.height = h
      const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, w, h)
      x.drawImage(img, 0, 0)
      return x.getImageData(0, 0, w, h).data
    }
    const A = mk(ia), B = mk(ib)
    let diff = 0
    for (let i = 0; i < A.length; i += 4) {
      if (Math.abs(A[i] - B[i]) > 12 || Math.abs(A[i + 1] - B[i + 1]) > 12 ||
          Math.abs(A[i + 2] - B[i + 2]) > 12) diff++
    }
    return {
      pct: +(100 * diff / (w * h)).toFixed(2),
      sizeA: `${ia.width}x${ia.height}`, sizeB: `${ib.width}x${ib.height}`,
    }
  }, [`data:image/png;base64,${a.toString('base64')}`, `data:image/png;base64,${b.toString('base64')}`])
}

/** Words present on one side and not the other. */
function textDelta(liveText, mineText) {
  const norm = (t) => t.toLowerCase().replace(/[^\p{L}\p{N}\s$%.,-]/gu, ' ').split(/\s+/).filter(Boolean)
  const L = norm(liveText), M = norm(mineText)
  const cnt = (arr) => { const m = new Map(); for (const w of arr) m.set(w, (m.get(w) || 0) + 1); return m }
  const cl = cnt(L), cm = cnt(M)
  const missing = [], extra = []
  for (const [w, n] of cl) { const d = n - (cm.get(w) || 0); if (d > 0) missing.push([w, d]) }
  for (const [w, n] of cm) { const d = n - (cl.get(w) || 0); if (d > 0) extra.push([w, d]) }
  return {
    liveWords: L.length,
    mineWords: M.length,
    missing: missing.sort((a, b) => b[1] - a[1]).slice(0, 12),
    extra: extra.sort((a, b) => b[1] - a[1]).slice(0, 12),
  }
}

const ctxLive = await browser.newContext({ viewport: VIEWPORT, userAgent: UA })
const ctxMine = await browser.newContext({ viewport: VIEWPORT, userAgent: UA })
// Every page view here would otherwise be counted in the client's analytics.
await blockAnalytics(ctxLive)
await blockAnalytics(ctxMine)

const report = []
console.log(`Comparing ${routes.length} route(s) at ${VIEWPORT.width}x${VIEWPORT.height}`)
console.log(`  live:  ${ORIGIN}\n  local: ${LOCAL}\n`)

for (const route of routes) {
  const [live, mine] = await Promise.all([
    capture(ctxLive, ORIGIN + route, 'live'),
    capture(ctxMine, LOCAL + route, 'mine'),
  ])

  const row = { route }
  if (live.error || mine.error) {
    row.error = live.error ? `live: ${live.error}` : `mine: ${mine.error}`
    report.push(row)
    console.log(`! ${route}  ${row.error}`)
    continue
  }

  const d = await diffPct(live.shot, mine.shot).catch(() => null)
  row.pixel = d
  row.title = live.title === mine.title ? null : { live: live.title, mine: mine.title }
  row.text = textDelta(live.text, mine.text)
  row.counts = {}
  for (const k of Object.keys(live.counts)) {
    if (live.counts[k] !== mine.counts[k]) row.counts[k] = { live: live.counts[k], mine: mine.counts[k] }
  }
  row.brokenImages = mine.brokenImages
  // Only failures the copy has and the original does not. The live site 404s on
  // a few of its own links (/products, /partner/insurance), and those are
  // faithfully reproduced here — reporting them as mirror defects would bury
  // the real ones.
  const liveFailed = new Set(live.failed)
  row.failedRequests = mine.failed
    .filter((f) => !liveFailed.has(f))
    // /cdn-cgi/ is Cloudflare's own edge namespace — the RUM beacon and
    // rocket-loader endpoints are injected into the HTML by the CDN, not served
    // from the site's files. They 404 off the copy by definition and say
    // nothing about whether the mirror is complete.
    .filter((f) => !f.includes('/cdn-cgi/'))
  row.liveFailedRequests = live.failed
  row.jsErrors = { live: live.errors.length, mine: mine.errors.length }
  row.mineErrorSamples = mine.errors.filter((e) => !live.errors.includes(e)).slice(0, 5)

  // Third-party widget geometry, compared side by side. A tolerance of 2px
  // absorbs sub-pixel layout; anything larger means the widget is built
  // differently on the copy, which is what a missing stylesheet looks like.
  row.widgetsSeen = {
    expected: !!(live.widgets && live.widgets.trustindexExpected),
    live: !!(live.widgets && live.widgets.trustindex),
    mine: !!(mine.widgets && mine.widgets.trustindex),
  }
  row.widgets = {}
  for (const k of Object.keys(live.widgets || {})) {
    if (k === 'trustindexExpected') continue      // reported via widgetsSeen
    const a = live.widgets[k], b = mine.widgets[k]
    if (a == null && b == null) continue
    if (a == null || b == null) { row.widgets[k] = { live: a, mine: b }; continue }
    if (typeof a === 'number') { if (a !== b) row.widgets[k] = { live: a, mine: b }; continue }
    if (Math.abs(a.w - b.w) > 2 || Math.abs(a.h - b.h) > 2) row.widgets[k] = { live: a, mine: b }
  }

  if (KEEP_SHOTS && live.shot && mine.shot) {
    const base = route.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'home'
    await writeFile(join(SHOTS, `${base}.live.png`), live.shot)
    await writeFile(join(SHOTS, `${base}.mine.png`), mine.shot)
  }

  const bad = (d && d.pct > 2) || row.title || Object.keys(row.counts).length ||
    row.text.missing.length || row.brokenImages.length || row.failedRequests.length ||
    Object.keys(row.widgets).length
  const flag = bad ? '!' : ' '
  console.log(`${flag} ${route}` +
    `  pixel ${d ? d.pct + '%' : 'n/a'}` +
    `  words ${row.text.liveWords}/${row.text.mineWords}` +
    `  img ${live.counts.imgLoaded}/${live.counts.img} vs ${mine.counts.imgLoaded}/${mine.counts.img}` +
    (row.brokenImages.length ? `  BROKEN-IMG ${row.brokenImages.length}` : '') +
    (row.failedRequests.length ? `  FAILED-REQ ${row.failedRequests.length}` : '') +
    (Object.keys(row.counts).length ? `  COUNTS ${JSON.stringify(row.counts)}` : '') +
    (Object.keys(row.widgets).length ? `  WIDGETS ${JSON.stringify(row.widgets)}` : ''))
  report.push(row)
}

await browser.close()

const out = join(ROOT, `.compare${MOBILE ? '-mobile' : ''}.json`)
await writeFile(out, JSON.stringify(report, null, 1))

const flagged = report.filter((r) => r.error || (r.pixel && r.pixel.pct > 2) || r.title ||
  (r.counts && Object.keys(r.counts).length) || (r.brokenImages && r.brokenImages.length) ||
  (r.failedRequests && r.failedRequests.length) || (r.text && r.text.missing.length) ||
  (r.widgets && Object.keys(r.widgets).length))

console.log(`\n--- comparison complete ---`)
console.log(`routes compared: ${report.length}`)
console.log(`clean:           ${report.length - flagged.length}`)
console.log(`flagged:         ${flagged.length}`)
console.log(`full report:     ${out}`)

/**
 * A page that carries the reviews template but rendered no widget on EITHER
 * side was not compared — it was skipped, silently, and counted as a match.
 * That is the exact shape of the failure this tool missed before: two identical
 * absences look like agreement. Say so rather than reporting a clean run.
 */
const blind = report.filter((r) => r.widgetsSeen &&
  r.widgetsSeen.expected && !r.widgetsSeen.live && !r.widgetsSeen.mine)
if (blind.length) {
  console.log(`\nWARNING: the reviews widget did not render on either side for ${blind.length} route(s).`)
  console.log(`Those pages were NOT compared for it — an unrendered widget matches an`)
  console.log(`unrendered widget. Check WP Rocket's delayed script is being released.`)
  for (const r of blind.slice(0, 10)) console.log(`   ${r.route}`)
}
const built = report.filter((r) => r.widgetsSeen && r.widgetsSeen.live).length
const expected = report.filter((r) => r.widgetsSeen && r.widgetsSeen.expected).length
if (expected) console.log(`\nreviews widget: built on live for ${built}/${expected} page(s) that carry it`)
