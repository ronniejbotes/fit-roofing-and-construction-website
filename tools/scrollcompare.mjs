/**
 * Scroll through a page the way a visitor does, on the live site and on the
 * copy at the same time, and compare what happens on the way down.
 *
 * compare.mjs answers "does the finished page look the same?". It walks the page
 * from script, freezes every animation and diffs one full-page screenshot. That
 * is the right test for layout and content, and the wrong one for motion: an
 * entrance animation that never fires, a counter that never counts, a sticky
 * header that never changes and a marquee that never moves all screenshot
 * identically once they have been frozen.
 *
 * So this does the opposite. Nothing is frozen or hidden. Both pages are
 * scrolled together with real wheel input, one step at a time, and at every step
 * each side records:
 *
 *   - a viewport screenshot shortly after the wheel (mid-animation) and another
 *     once the step has settled, with a pixel diff of the settled pair
 *   - which Elementor entrance animations have fired, and which effect each ran
 *   - running CSS animations by name
 *   - counter values and the active slide of every carousel
 *   - the header's position, height and sticky classes
 *   - transforms on motion-effect (parallax) layers
 *   - the reviews widget: how many rendered, which card is first, avatar loads
 *
 * then the two timelines are compared step by step. After the bottom it scrolls
 * back to the top, opens every nav dropdown with real pointer movement (desktop),
 * hovers every element the site's stylesheets give a :hover rule, and at tablet
 * width and below opens the menu toggle and every sub-menu in it.
 *
 * Needs `npm run serve`. Analytics beacons are aborted on both sides.
 *
 *   node tools/scrollcompare.mjs /                     # one page, 1440x900
 *   node tools/scrollcompare.mjs / /about/ --mobile    # 390x844
 *   node tools/scrollcompare.mjs / --tablet            # 768x1024
 *   node tools/scrollcompare.mjs / --size 360x740
 *   node tools/scrollcompare.mjs --all                 # every page in routes.txt
 *   node tools/scrollcompare.mjs / --local http://localhost:4402 --tag delayed
 *
 * Output, per route, in shots/scroll/<view>[-tag]/<route>/:
 *   NN-settled.jpg     LIVE | COPY | DIFF (red = differing pixels)
 *   NN-mid.jpg         LIVE | COPY a moment after the wheel, while things animate
 *   dropdown-N.jpg     LIVE | COPY | DIFF with a nav dropdown open (desktop)
 *   mobile-menu.jpg    LIVE | COPY | DIFF with the menu open (tablet and below)
 *   mobile-submenu.jpg LIVE | COPY | DIFF with its first sub-menu open
 *   report.json        every step's telemetry and the differences found
 *
 * Mid frames are taken at the same moment on both sides but from two separate
 * browsers, so an animation a few milliseconds apart legitimately differs there.
 * The settled frames and the telemetry are the evidence; the mid frames are for
 * a person to look at.
 */
import { chromium } from 'playwright-core'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ORIGIN, UA } from './site.mjs'
import { CHROME, blockAnalytics, realPointer, hoverLikeAPerson } from './browser.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const argVal = (f) => { const i = args.indexOf(f); return i === -1 ? null : args[i + 1] }
const VALUED = new Set(['--local', '--size', '--tag', '--shard'])
const LOCAL = argVal('--local') || 'http://localhost:4400'
const SHARD = argVal('--shard')
const SIZE = argVal('--size')
const TAG = argVal('--tag')
const TABLET = args.includes('--tablet')
const MOBILE = args.includes('--mobile')
const FULL = args.includes('--full')
// --hover-only skips the scroll pass and runs just the dropdown, hover and menu
// probes, for re-checking those without repeating a full scroll-through.
const HOVER_ONLY = args.includes('--hover-only')
const VIEWPORT = SIZE
  ? { width: Number(SIZE.split('x')[0]), height: Number(SIZE.split('x')[1]) }
  : TABLET ? { width: 768, height: 1024 } : MOBILE ? { width: 390, height: 844 } : { width: 1440, height: 900 }
const VIEW = (SIZE ? `size-${SIZE}` : TABLET ? 'tablet' : MOBILE ? 'mobile' : 'desktop') + (TAG ? `-${TAG}` : '')
// Elementor replaces the nav bar with the menu toggle at its tablet breakpoint.
const NARROW = VIEWPORT.width <= 1024
const MID_MS = Number(process.env.MID_MS || 300)
const SETTLE_MS = Number(process.env.SETTLE_MS || 1800)
const MAX_STEPS = Number(process.env.MAX_STEPS || 80)
const HOVER_LIMIT = Number(process.env.HOVER_LIMIT || 60)
// The pointer rests on the right-hand edge while scrolling. It used to rest on
// the left edge, where cards sliding in from the left ran underneath it and were
// caught mid-hover on one side only.
const PARK = { x: VIEWPORT.width - 2, y: Math.round(VIEWPORT.height / 2) }

const positional = args.filter((a, i) => !a.startsWith('--') && !VALUED.has(args[i - 1]))

// Git Bash (MSYS) rewrites any argument that looks like an absolute path before
// Node sees it, so `/` arrives as `C:/Program Files/Git/` and the run compares a
// URL that does not exist on either side. Refuse rather than report on nothing.
const mangled = positional.filter((a) => /^[A-Za-z]:[\\/]/.test(a))
if (mangled.length) {
  console.error(`Route argument(s) look like Windows paths: ${mangled.join(', ')}`)
  console.error('Git Bash rewrote them. Run from PowerShell, or prefix MSYS_NO_PATHCONV=1.')
  process.exit(2)
}

const routeList = positional.length && !args.includes('--all')
  ? positional
  : (await readFile(join(ROOT, 'routes.txt'), 'utf8')).split('\n')
      .map((s) => s.trim()).filter((s) => s && !s.startsWith('#') && !s.endsWith('.xml'))
// --shard 2/3 takes every third route starting from the second, so one pass can
// be split across parallel processes without two of them sharing a route.
const routes = SHARD
  ? routeList.filter((_, i) => i % Number(SHARD.split('/')[1]) === Number(SHARD.split('/')[0]) - 1)
  : routeList

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const slugOf = (route) => route.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'home'

let browser = await chromium.launch({ executablePath: CHROME })

/** Everything that can move, measured in the page. Runs identically on both sides. */
function telemetry() {
  const round = Math.round
  const vw = window.innerWidth, vh = window.innerHeight
  const t = { y: round(window.scrollY), docH: document.documentElement.scrollHeight }

  // Elementor entrance animations. The configured effect is in data-settings;
  // until the widget scrolls into view it carries .elementor-invisible, and when
  // it fires Elementor swaps that for .animated plus the effect's class.
  // Responsive settings fall back mobile -> tablet -> desktop, as Elementor does.
  const bps = vw <= 767 ? ['_mobile', '_tablet', ''] : vw <= 1024 ? ['_tablet', ''] : ['']
  t.fired = []
  t.waiting = []
  for (const el of document.querySelectorAll('[data-settings]')) {
    let s
    try { s = JSON.parse(el.getAttribute('data-settings')) } catch { continue }
    let name = null
    for (const bp of bps) { name = s['_animation' + bp] || s['animation' + bp]; if (name) break }
    if (!name || name === 'none') continue
    const id = el.getAttribute('data-id') || '?'
    if (el.classList.contains('elementor-invisible')) t.waiting.push(`${id}:${name}`)
    else t.fired.push(`${id}:${name}${el.classList.contains('animated') ? '' : '(no .animated)'}`)
  }
  t.fired.sort(); t.waiting.sort()

  t.running = {}
  for (const a of document.getAnimations()) {
    if (a.playState !== 'running' || !a.animationName) continue
    t.running[a.animationName] = (t.running[a.animationName] || 0) + 1
  }

  t.counters = [...document.querySelectorAll('.elementor-counter-number')].map((e) => e.textContent.trim())
  t.swipers = [...document.querySelectorAll('.swiper, .swiper-container')].map((e) =>
    e.swiper ? e.swiper.realIndex
      : [...e.querySelectorAll('.swiper-slide')].findIndex((s) => s.classList.contains('swiper-slide-active')))

  const header = document.querySelector('[data-elementor-type="header"]')
  if (header) {
    const el = header.querySelector('.elementor-sticky:not(.elementor-sticky__spacer)') ||
      header.querySelector('.e-con, .elementor-section') || header
    const r = el.getBoundingClientRect()
    const cs = getComputedStyle(el)
    t.header = {
      top: round(r.top), h: round(r.height),
      cls: [...el.classList].filter((c) => /sticky|effects|shrink|hide/.test(c)).sort().join(' '),
      bg: cs.backgroundColor, position: cs.position,
    }
  }

  t.motion = [...document.querySelectorAll('.elementor-motion-effects-layer, .elementor-motion-effects-element')]
    .slice(0, 16).map((e) => getComputedStyle(e).transform)

  t.popups = [...document.querySelectorAll('.elementor-popup-modal')]
    .filter((e) => getComputedStyle(e).display !== 'none').length

  const inView = [...document.images].filter((i) => {
    const r = i.getBoundingClientRect()
    return r.width > 0 && r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw
  })
  t.imgsInView = inView.length
  t.imgsInViewBroken = inView.filter((i) => i.complete && i.naturalWidth === 0 && i.currentSrc)
    .map((i) => i.currentSrc.replace(location.origin, '')).slice(0, 10)
  t.lottie = document.querySelectorAll('.e-lottie__animation svg, lottie-player').length
  t.chat = !!document.querySelector('iframe[src*="fastbots"], [id*="fastbots"], [class*="fastbots"]')

  // The reviews widget rotates, so which card is first is recorded, not compared.
  const ti = document.querySelector('.ti-widget')
  t.reviews = ti ? ti.querySelectorAll('.ti-review-item').length : 0
  if (ti) {
    const wrap = ti.querySelector('.ti-reviews-container-wrapper') || ti
    const wr = wrap.getBoundingClientRect()
    const items = [...ti.querySelectorAll('.ti-review-item')]
    const first = items.find((it) => {
      const r = it.getBoundingClientRect()
      return r.width > 0 && r.left >= wr.left - 4 && r.left < wr.right
    })
    t.reviewsFirst = first ? ((first.querySelector('.ti-name') || {}).textContent || '').trim() : null
    const avatars = [...ti.querySelectorAll('.ti-profile-img img, .ti-review-header img')]
    t.reviewAvatars = {
      total: avatars.length,
      loaded: avatars.filter((i) => i.complete && i.naturalWidth > 0).length,
      failed: avatars.filter((i) => i.complete && i.naturalWidth === 0).length,
    }
  }
  return t
}

/** Differences between two telemetry snapshots taken at the same scroll step. */
function diffTelemetry(a, b, { final = false } = {}) {
  const d = []
  if (Math.abs(a.y - b.y) > 2) d.push(`scrollY differs: live ${a.y}, copy ${b.y}`)
  if (Math.abs(a.docH - b.docH) > 2) d.push(`page height differs: live ${a.docH}, copy ${b.docH}`)

  const fa = new Set(a.fired), fb = new Set(b.fired)
  const onlyLive = [...fa].filter((x) => !fb.has(x))
  const onlyMine = [...fb].filter((x) => !fa.has(x))
  if (onlyLive.length) d.push(`entrance animations fired on live but not the copy: ${onlyLive.join(', ')}`)
  if (onlyMine.length) d.push(`entrance animations fired on the copy but not live: ${onlyMine.join(', ')}`)
  if (a.waiting.length !== b.waiting.length) {
    d.push(`animations still waiting to fire: live ${a.waiting.length}, copy ${b.waiting.length}`)
  }

  const names = new Set([...Object.keys(a.running), ...Object.keys(b.running)])
  const runOnly = [...names].filter((n) => !a.running[n] !== !b.running[n])
  if (runOnly.length) {
    d.push(`CSS animations running on one side only: ` +
      runOnly.map((n) => `${n} (live ${a.running[n] || 0}, copy ${b.running[n] || 0})`).join(', '))
  }

  if (JSON.stringify(a.counters) !== JSON.stringify(b.counters)) {
    d.push(`counters: live ${JSON.stringify(a.counters)}, copy ${JSON.stringify(b.counters)}` +
      (final ? '' : ' (may still be counting)'))
  }
  if (a.swipers.length !== b.swipers.length) d.push(`carousel count: live ${a.swipers.length}, copy ${b.swipers.length}`)

  if (!!a.header !== !!b.header) d.push(`header present: live ${!!a.header}, copy ${!!b.header}`)
  else if (a.header) {
    const ha = a.header, hb = b.header
    if (Math.abs(ha.top - hb.top) > 2 || Math.abs(ha.h - hb.h) > 2) {
      d.push(`header box: live top ${ha.top} h ${ha.h}, copy top ${hb.top} h ${hb.h}`)
    }
    if (ha.cls !== hb.cls) d.push(`header classes: live "${ha.cls}", copy "${hb.cls}"`)
    if (ha.bg !== hb.bg) d.push(`header background: live ${ha.bg}, copy ${hb.bg}`)
    if (ha.position !== hb.position) d.push(`header position: live ${ha.position}, copy ${hb.position}`)
  }

  if (a.motion.length !== b.motion.length) d.push(`motion-effect layers: live ${a.motion.length}, copy ${b.motion.length}`)
  else {
    const nums = (s) => (s.match(/-?[\d.]+/g) || []).map(Number)
    a.motion.forEach((m, i) => {
      const x = nums(m), y = nums(b.motion[i])
      if (x.length !== y.length || x.some((v, k) => Math.abs(v - y[k]) > 3)) {
        d.push(`motion-effect layer ${i} transform: live ${m}, copy ${b.motion[i]}`)
      }
    })
  }

  if (a.popups !== b.popups) d.push(`popups open: live ${a.popups}, copy ${b.popups}`)
  if (b.imgsInViewBroken.length > a.imgsInViewBroken.length) {
    d.push(`broken images in view on the copy: ${b.imgsInViewBroken.join(', ')}`)
  }
  if (a.lottie !== b.lottie) d.push(`lottie players: live ${a.lottie}, copy ${b.lottie}`)
  if (a.chat !== b.chat) d.push(`chat widget present: live ${a.chat}, copy ${b.chat}`)
  if (a.reviews !== b.reviews) d.push(`reviews rendered: live ${a.reviews}, copy ${b.reviews}`)
  if (a.reviewAvatars && b.reviewAvatars && a.reviewAvatars.failed !== b.reviewAvatars.failed) {
    d.push(`review avatars that failed to load: live ${a.reviewAvatars.failed}, copy ${b.reviewAvatars.failed}`)
  }
  return d
}

/**
 * Decode both screenshots in a page, count differing pixels, and draw a single
 * JPEG a person can read at a glance: LIVE | COPY | DIFF. Done on a canvas in
 * the browser to avoid a native image dependency.
 */
let differ = await browser.newPage()
async function composite(bufA, bufB, withDiff, scale) {
  return differ.evaluate(async ({ a, b, withDiff, scale }) => {
    const load = (src) => new Promise((res, rej) => {
      const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src
    })
    const [ia, ib] = await Promise.all([load(a), load(b)])
    const w = Math.max(ia.width, ib.width), h = Math.max(ia.height, ib.height)
    const canvasOf = (img) => {
      const c = document.createElement('canvas'); c.width = w; c.height = h
      const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, w, h); x.drawImage(img, 0, 0)
      return c
    }
    const ca = canvasOf(ia), cb = canvasOf(ib)
    const A = ca.getContext('2d').getImageData(0, 0, w, h).data
    const B = cb.getContext('2d').getImageData(0, 0, w, h).data
    const cd = document.createElement('canvas'); cd.width = w; cd.height = h
    const D = cd.getContext('2d').createImageData(w, h)
    let diff = 0
    for (let i = 0; i < A.length; i += 4) {
      if (Math.abs(A[i] - B[i]) > 12 || Math.abs(A[i + 1] - B[i + 1]) > 12 || Math.abs(A[i + 2] - B[i + 2]) > 12) {
        diff++
        D.data[i] = 255; D.data[i + 1] = 0; D.data[i + 2] = 0; D.data[i + 3] = 255
      } else {
        const g = 255 - (255 - (B[i] + B[i + 1] + B[i + 2]) / 3) * 0.25
        D.data[i] = D.data[i + 1] = D.data[i + 2] = g; D.data[i + 3] = 255
      }
    }
    cd.getContext('2d').putImageData(D, 0, 0)

    const panels = withDiff ? [ca, cb, cd] : [ca, cb]
    const labels = ['LIVE', 'COPY', 'DIFF']
    const sw = Math.round(w * scale), sh = Math.round(h * scale), gap = 8, top = 22
    const out = document.createElement('canvas')
    out.width = sw * panels.length + gap * (panels.length - 1); out.height = sh + top
    const o = out.getContext('2d')
    o.fillStyle = '#222'; o.fillRect(0, 0, out.width, out.height)
    panels.forEach((c, k) => {
      const x0 = k * (sw + gap)
      o.drawImage(c, x0, top, sw, sh)
      o.fillStyle = '#fff'; o.font = 'bold 14px sans-serif'; o.fillText(labels[k], x0 + 6, 16)
    })
    return {
      pct: +(100 * diff / (w * h)).toFixed(2),
      jpeg: out.toDataURL('image/jpeg', 0.72),
      sizes: `${ia.width}x${ia.height} / ${ib.width}x${ib.height}`,
    }
  }, {
    a: 'data:image/png;base64,' + bufA.toString('base64'),
    b: 'data:image/png;base64,' + bufB.toString('base64'),
    withDiff, scale,
  })
}

async function saveJpeg(file, dataUrl) {
  await writeFile(file, Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64'))
}

/** Open one side, recording its errors and failed requests. */
async function open(ctx, base, route) {
  const page = await ctx.newPage()
  const errors = [], failed = [], thirdPartyFailed = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)) })
  page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 200)))
  page.on('response', (r) => {
    const u = r.url()
    if (r.status() < 400) return
    if (u.startsWith(base)) failed.push(`HTTP ${r.status()} ${u.slice(base.length)}`)
    else thirdPartyFailed.push(`HTTP ${r.status()} ${u.slice(0, 140)}`)
  })
  page.on('requestfailed', (r) => {
    const u = r.url()
    const e = r.failure()?.errorText || 'failed'
    if (u.startsWith(base) && !e.includes('ERR_ABORTED')) failed.push(`${e} ${u.slice(base.length)}`)
  })
  let loadError = null
  try {
    await page.goto(base + route, { waitUntil: 'load', timeout: 60000 })
  } catch (e) { loadError = e.message.split('\n')[0] }
  return { page, errors, failed, thirdPartyFailed, loadError }
}

/**
 * Resolve once every finite transition and animation on the element has ended,
 * or after `cap` ms. Infinite ones (pulses, spinners) are ignored, since they
 * never end.
 *
 * Without this, a hover was read 700ms after the pointer arrived. The post and
 * blog templates give their large rounded blocks `--background-transition: 5s`,
 * so both sides were read part-way through a five-second fade — live at alpha
 * 0.294, the copy at 0.298 — and reported as different.
 */
function settleAnimations(el, cap) {
  const finite = el.getAnimations().filter((a) => {
    const t = a.effect && a.effect.getComputedTiming()
    return t && Number.isFinite(t.endTime)
  })
  return Promise.race([
    Promise.all(finite.map((a) => a.finished.catch(() => {}))),
    new Promise((r) => setTimeout(r, cap)),
  ])
}

/** The computed styles a :hover rule is likely to change. */
function readHoverStyles(el) {
  const s = getComputedStyle(el)
  return [s.transform, s.backgroundColor, s.color, s.borderColor, s.boxShadow,
    s.opacity, s.filter, s.textDecorationLine].join(' | ')
}

/**
 * Every element the site's own stylesheets give a :hover rule, hovered the way
 * a person does, with the styles that can change read before and after.
 *
 * The candidates come from the stylesheets rather than a list of class names,
 * because a list only ever finds what someone thought to write down: the first
 * version of this hovered the first ten buttons and never reached the cards that
 * scale up on the homepage. Rules specific to one element (elementor-element-*)
 * go first, then the rest alphabetically, and each selector contributes its
 * first visible match. The list is built on each side independently; the copy's
 * CSS is byte-identical to live's, so a different list is itself a finding.
 */
async function hoverProbe(page, limit) {
  await page.mouse.move(PARK.x, 2)
  const targets = await page.evaluate((limit) => {
    const bases = new Set()
    const walk = (rules) => {
      for (const r of rules) {
        if (r.selectorText) {
          if (!r.selectorText.includes(':hover')) continue
          for (const s of r.selectorText.split(',')) {
            if (!s.includes(':hover')) continue
            const base = s.replace(/:hover/g, '').replace(/::?(before|after)\b/g, '').trim()
            if (base) bases.add(base)
          }
        } else if (r.cssRules) walk(r.cssRules)
      }
    }
    for (const sheet of document.styleSheets) {
      try { walk(sheet.cssRules) } catch { /* cross-origin stylesheet */ }
    }
    const ordered = [...bases].sort((a, b) => {
      const sa = a.includes('elementor-element-') ? 0 : 1, sb = b.includes('elementor-element-') ? 0 : 1
      return sa - sb || a.localeCompare(b)
    })
    const seen = new Set(), out = []
    for (const sel of ordered) {
      let els
      try { els = document.querySelectorAll(sel) } catch { continue }
      const el = [...els].find((e) => {
        const r = e.getBoundingClientRect(), cs = getComputedStyle(e)
        // Excluded: menus (dropdownProbe covers them), the rotating reviews
        // carousel, and the FastBots launcher, whose inline style pulses its
        // scale for ever (avatar-pulse 2s infinite) so no reading is ever at rest.
        return r.width > 4 && r.height > 4 && cs.visibility !== 'hidden' && cs.display !== 'none' &&
          !e.closest('.sub-menu, .elementor-nav-menu--dropdown, .ti-widget, [class*="fastbots"], ' +
            '[id^="chat-widget"], [class*="avatar-animation"]')
      })
      if (!el || seen.has(el)) continue
      seen.add(el)
      el.setAttribute('data-hover-probe', String(out.length))
      out.push(sel)
      if (out.length >= limit) break
    }
    return out
  }, limit)

  await realPointer(page, PARK.x - 40, 200)
  const out = []
  for (let i = 0; i < targets.length; i++) {
    const loc = page.locator(`[data-hover-probe="${i}"]`)
    try {
      await loc.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }))
      await page.mouse.move(PARK.x, 2, { steps: 4 })
      await sleep(300)
      await loc.evaluate(settleAnimations, 6000)
      const before = await loc.evaluate(readHoverStyles)
      const box = await loc.boundingBox()
      if (!box) { out.push({ sel: targets[i], error: 'no box' }); continue }
      await hoverLikeAPerson(page, box)
      await sleep(250)
      await loc.evaluate(settleAnimations, 6000)
      const after = await loc.evaluate(readHoverStyles)
      out.push({ sel: targets[i], before, after, changed: before !== after })
    } catch (e) { out.push({ sel: targets[i], error: e.message.split('\n')[0].slice(0, 80) }) }
  }
  await page.mouse.move(PARK.x, 2)
  return out
}

/** Open every top-level nav dropdown with real pointer movement (desktop). */
async function dropdownProbe(page) {
  const out = []
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
  await sleep(500)
  await realPointer(page, Math.round(VIEWPORT.width / 2), VIEWPORT.height - 120)
  const parents = page.locator('.elementor-nav-menu--main > ul > li.menu-item-has-children')
  const n = await parents.count()
  for (let i = 0; i < n; i++) {
    const li = parents.nth(i)
    if (!(await li.isVisible().catch(() => false))) continue
    const box = await li.boundingBox()
    if (!box) continue
    await hoverLikeAPerson(page, box)
    await sleep(900)
    const state = await li.evaluate((el) => {
      const a = el.querySelector(':scope > a')
      const ul = el.querySelector(':scope > ul')
      if (!ul) return { label: (a?.textContent || '').trim(), submenu: false }
      const s = getComputedStyle(ul), r = ul.getBoundingClientRect()
      return {
        label: (a?.textContent || '').trim(),
        visible: s.display !== 'none' && s.visibility !== 'hidden' && r.height > 10,
        x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height),
        bg: s.backgroundColor,
        items: [...ul.querySelectorAll(':scope > li > a')].map((x) => x.textContent.trim()),
      }
    })
    let subHover = null
    const first = li.locator(':scope > ul > li > a').first()
    if (state.visible && await first.count()) {
      const fb = await first.boundingBox()
      if (fb) {
        await page.mouse.move(Math.round(fb.x + fb.width / 2), Math.round(fb.y + fb.height / 2), { steps: 6 })
        await sleep(600)
        subHover = await first.evaluate((a) => { const s = getComputedStyle(a); return `${s.color} on ${s.backgroundColor}` })
      }
    }
    const shot = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: VIEWPORT.width, height: Math.min(VIEWPORT.height, 560) } })
    out.push({ ...state, subHover, shot })
    await page.mouse.move(Math.round(VIEWPORT.width / 2), VIEWPORT.height - 60, { steps: 10 })
    await sleep(1100)
  }
  return out
}

/** Open the menu toggle, then every sub-menu inside it (tablet width and below). */
async function mobileMenuProbe(page) {
  const toggle = page.locator('.elementor-menu-toggle').first()
  if (!(await toggle.count()) || !(await toggle.isVisible().catch(() => false))) return null
  const url = page.url()
  try {
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
    await sleep(300)
    await toggle.click({ timeout: 4000 })
    await sleep(800)
    const menu = await page.evaluate(() => {
      const d = [...document.querySelectorAll('.elementor-nav-menu--dropdown')]
        .find((e) => e.getBoundingClientRect().height > 0)
      if (!d) return { open: false }
      const s = getComputedStyle(d), b = d.getBoundingClientRect()
      return {
        open: s.display !== 'none' && s.visibility !== 'hidden' && b.height > 20,
        h: Math.round(b.height),
        links: [...d.querySelectorAll('a')].filter((a) => a.getBoundingClientRect().height > 0).length,
      }
    })
    const shot = await page.screenshot({ type: 'png' })
    const subs = []
    let subShot = null
    const arrows = page.locator('.elementor-nav-menu--dropdown li.menu-item-has-children > a .sub-arrow')
    const n = await arrows.count()
    for (let i = 0; i < n; i++) {
      const arrow = arrows.nth(i)
      if (!(await arrow.isVisible().catch(() => false))) continue
      await arrow.click({ timeout: 3000 })
      await sleep(800)
      if (page.url() !== url) { subs.push({ navigatedTo: page.url() }); break }
      const state = await arrow.evaluate((el) => {
        const li = el.closest('li')
        const ul = li && li.querySelector(':scope > ul')
        if (!ul) return null
        const s = getComputedStyle(ul), r = ul.getBoundingClientRect()
        return {
          label: (li.querySelector(':scope > a')?.textContent || '').trim(),
          open: s.display !== 'none' && r.height > 10, h: Math.round(r.height),
          items: [...ul.querySelectorAll(':scope > li > a')].map((a) => a.textContent.trim()),
        }
      })
      subs.push(state)
      if (!subShot) subShot = await page.screenshot({ type: 'png' })
      await arrow.click({ timeout: 3000 }).catch(() => {})
      await sleep(700)
    }
    await toggle.click({ timeout: 4000 }).catch(() => {})
    return { ...menu, subs, shot, subShot }
  } catch (e) { return { error: e.message.split('\n')[0].slice(0, 80) } }
}

async function run(route) {
  const dir = join(ROOT, 'shots', 'scroll', VIEW, slugOf(route))
  await mkdir(dir, { recursive: true })
  const ctxLive = await browser.newContext({ viewport: VIEWPORT, userAgent: UA })
  const ctxMine = await browser.newContext({ viewport: VIEWPORT, userAgent: UA })
  await blockAnalytics(ctxLive)
  await blockAnalytics(ctxMine)
  const [L, M] = await Promise.all([open(ctxLive, ORIGIN, route), open(ctxMine, LOCAL, route)])
  const report = { route, viewport: VIEW, size: VIEWPORT, local: LOCAL, steps: [], problems: [] }

  if (L.loadError || M.loadError) {
    report.problems.push(`load failed — live: ${L.loadError || 'ok'}, copy: ${M.loadError || 'ok'}`)
  }

  const scale = VIEWPORT.width <= 800 ? 1 : 0.5
  const both = (fn) => Promise.all([fn(L.page), fn(M.page)])

  // Let the first-paint animations (the hero) play out, and put the pointer on
  // the page so wheel input lands on the document.
  await sleep(2500)
  await both((p) => p.mouse.move(PARK.x, PARK.y))

  const snap = async (stepNo, label, { final = false } = {}) => {
    const [ta, tb] = await both((p) => p.evaluate(telemetry))
    const [sa, sb] = await both((p) => p.screenshot({ type: 'png' }))
    const c = await composite(sa, sb, true, scale)
    const name = `${String(stepNo).padStart(2, '0')}-${label}`
    await saveJpeg(join(dir, `${name}.jpg`), c.jpeg)
    if (FULL) {
      await writeFile(join(dir, `${name}.live.png`), sa)
      await writeFile(join(dir, `${name}.copy.png`), sb)
    }
    const diffs = diffTelemetry(ta, tb, { final })
    const notes = []
    if (ta.reviews && ta.reviewsFirst !== tb.reviewsFirst) {
      notes.push(`reviews carousel on different cards: live "${ta.reviewsFirst}", copy "${tb.reviewsFirst}"`)
    }
    const step = { step: stepNo, label, y: ta.y, pixelPct: c.pct, diffs, notes, live: ta, copy: tb }
    report.steps.push(step)
    return step
  }

  await snap(0, 'top')

  let stepNo = 0
  for (; stepNo < (HOVER_ONLY ? 0 : MAX_STEPS); stepNo++) {
    const pos = await L.page.evaluate(() => ({ y: window.scrollY, h: document.documentElement.scrollHeight, vh: window.innerHeight }))
    if (pos.y + pos.vh >= pos.h - 2) break
    const delta = Math.round(VIEWPORT.height * 0.75)
    await both((p) => p.mouse.wheel(0, delta))
    await sleep(150)

    // Two browsers do not always land on the same pixel. Align the copy to the
    // live position so the frames are comparable, and record the gap: a
    // persistent one means the pages are different heights above this point.
    const [ya, yb] = await both((p) => p.evaluate(() => window.scrollY))
    if (Math.abs(ya - yb) > 2) {
      await M.page.evaluate((y) => window.scrollTo({ top: y, behavior: 'instant' }), ya)
    }

    await sleep(Math.max(0, MID_MS - 150))
    const [ma, mb] = await both((p) => p.screenshot({ type: 'png' }))
    const mc = await composite(ma, mb, false, scale)
    await saveJpeg(join(dir, `${String(stepNo + 1).padStart(2, '0')}-mid.jpg`), mc.jpeg)

    await sleep(Math.max(0, SETTLE_MS - MID_MS))
    const s = await snap(stepNo + 1, 'settled')
    if (Math.abs(ya - yb) > 2) s.diffs.unshift(`wheel landed at different positions: live ${ya}, copy ${yb} (copy aligned)`)
  }

  if (!HOVER_ONLY) {
    // Counters and late animations finish after the last step.
    await sleep(2500)
    await snap(stepNo + 1, 'bottom-final', { final: true })

    // Back to the top with the wheel: sticky and scroll-up header effects.
    for (let i = 0; i < MAX_STEPS; i++) {
      const y = await L.page.evaluate(() => window.scrollY)
      if (y <= 0) break
      await both((p) => p.mouse.wheel(0, -Math.round(VIEWPORT.height * 1.5)))
      await sleep(120)
    }
    await sleep(1200)
    await both((p) => p.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' })))
    await sleep(600)
    await snap(stepNo + 2, 'back-to-top', { final: true })
  }

  // ---- nav dropdowns (desktop) ----
  if (!NARROW) {
    const [da, db] = await both((p) => dropdownProbe(p))
    const strip = ({ shot, ...s }) => s
    report.dropdowns = { live: da.map(strip), copy: db.map(strip), pixelPct: [] }
    for (let i = 0; i < Math.max(da.length, db.length); i++) {
      const a = da[i], b = db[i]
      if (!a || !b) { report.problems.push(`dropdown ${i} present: live ${!!a}, copy ${!!b}`); continue }
      const c = await composite(a.shot, b.shot, true, scale)
      await saveJpeg(join(dir, `dropdown-${i}.jpg`), c.jpeg)
      report.dropdowns.pixelPct.push(c.pct)
      const sa = JSON.stringify(strip(a)), sb = JSON.stringify(strip(b))
      if (sa !== sb) report.problems.push(`dropdown "${a.label}": live ${sa}, copy ${sb}`)
    }
    if (da.length && !da.some((d) => d.visible)) {
      report.problems.push('no nav dropdown opened on live — the dropdown check is blind on this page')
    }
  }

  // ---- :hover rules ----
  const [ha, hb] = await both((p) => hoverProbe(p, HOVER_LIMIT))
  report.hover = { live: ha, copy: hb }
  const hoverDiffs = []
  if (ha.map((h) => h.sel).join('\n') !== hb.map((h) => h.sel).join('\n')) {
    hoverDiffs.push(`hover targets differ: live ${ha.length}, copy ${hb.length}`)
  }
  const copyBySel = new Map(hb.map((h) => [h.sel, h]))
  for (const a of ha) {
    const b = copyBySel.get(a.sel)
    if (!b) continue
    if (a.error || b.error) {
      if (!!a.error !== !!b.error) hoverDiffs.push(`hover ${a.sel}: live ${a.error || 'ok'}, copy ${b.error || 'ok'}`)
      continue
    }
    if (a.before !== b.before || a.after !== b.after) {
      hoverDiffs.push(`hover ${a.sel}: live ${a.before} -> ${a.after}; copy ${b.before} -> ${b.after}`)
    }
  }
  report.hoverDiffs = hoverDiffs
  report.hoverSummary = {
    targets: ha.length,
    changedOnLive: ha.filter((h) => h.changed).length,
    changedOnCopy: hb.filter((h) => h.changed).length,
  }
  if (ha.length && !ha.some((h) => h.changed)) {
    report.problems.push('no hover changed anything on live — the hover check is blind on this page')
  }

  // ---- menu toggle and sub-menus (tablet and below) ----
  if (NARROW) {
    const [ma, mb] = await both((p) => mobileMenuProbe(p))
    const strip = (m) => m && { ...m, shot: undefined, subShot: undefined }
    report.mobileMenu = { live: strip(ma), copy: strip(mb) }
    if (!!ma !== !!mb) report.problems.push(`menu toggle present: live ${!!ma}, copy ${!!mb}`)
    else if (ma) {
      if (ma.shot && mb.shot) {
        const c = await composite(ma.shot, mb.shot, true, scale)
        await saveJpeg(join(dir, 'mobile-menu.jpg'), c.jpeg)
        report.mobileMenu.pixelPct = c.pct
      }
      if (ma.subShot && mb.subShot) {
        const c = await composite(ma.subShot, mb.subShot, true, scale)
        await saveJpeg(join(dir, 'mobile-submenu.jpg'), c.jpeg)
        report.mobileMenu.subPixelPct = c.pct
      }
      if (JSON.stringify(strip(ma)) !== JSON.stringify(strip(mb))) {
        report.problems.push(`menu: live ${JSON.stringify(strip(ma))}, copy ${JSON.stringify(strip(mb))}`)
      }
      if (ma.subs && ma.subs.length && !ma.subs.some((s) => s && s.open)) {
        report.problems.push('no sub-menu opened on live — the sub-menu check is blind on this page')
      }
    }
  }

  const liveErr = new Set(L.errors), liveFail = new Set(L.failed)
  report.copyOnlyErrors = [...new Set(M.errors.filter((e) => !liveErr.has(e)))]
  report.copyOnlyFailedRequests = [...new Set(M.failed.filter((f) => !liveFail.has(f)))]
  report.liveFailedRequests = [...new Set(L.failed)]
  report.thirdPartyFailed = { live: [...new Set(L.thirdPartyFailed)], copy: [...new Set(M.thirdPartyFailed)] }

  const pcts = report.steps.map((s) => s.pixelPct)
  report.summary = {
    steps: report.steps.length,
    maxPixelPct: Math.max(...pcts),
    meanPixelPct: +(pcts.reduce((x, y) => x + y, 0) / pcts.length).toFixed(2),
    stepsOver1Pct: report.steps.filter((s) => s.pixelPct > 1).map((s) => `${s.step}-${s.label} ${s.pixelPct}%`),
    stepsWithTelemetryDiffs: report.steps.filter((s) => s.diffs.length).length,
    dropdownsOpened: report.dropdowns ? `${report.dropdowns.live.filter((d) => d.visible).length}/${report.dropdowns.live.length}` : null,
    hoverTargets: report.hoverSummary.targets,
    hoverChanged: `${report.hoverSummary.changedOnLive} live / ${report.hoverSummary.changedOnCopy} copy`,
    hoverDiffs: hoverDiffs.length,
    problems: report.problems.length,
    copyOnlyErrors: report.copyOnlyErrors.length,
    copyOnlyFailedRequests: report.copyOnlyFailedRequests.length,
  }

  await writeFile(join(dir, 'report.json'), JSON.stringify(report, null, 1))
  await ctxLive.close()
  await ctxMine.close()
  return report
}

console.log(`Scroll-through comparison of ${routes.length} route(s) at ${VIEWPORT.width}x${VIEWPORT.height} (${VIEW})`)
console.log(`  live:  ${ORIGIN}\n  local: ${LOCAL}\n`)

const all = []
for (const route of routes) {
  let r
  for (let attempt = 1; attempt <= 2 && !r; attempt++) {
    try { r = await run(route) } catch (e) {
      const msg = e.message.split('\n')[0]
      console.log(`! ${route}  attempt ${attempt} FATAL ${msg}`)
      if (attempt === 2) r = { route, viewport: VIEW, fatal: msg }
      else {
        // A crashed renderer takes the browser or its contexts with it, and then
        // every later route fails too. One retry in a fresh browser separates a
        // transient crash from a page that genuinely fails every time.
        await browser.close().catch(() => {})
        browser = await chromium.launch({ executablePath: CHROME })
        differ = await browser.newPage()
      }
    }
  }
  if (r.fatal) { all.push(r); continue }
  const s = r.summary
  const flag = s.stepsOver1Pct.length || s.stepsWithTelemetryDiffs || s.hoverDiffs ||
    s.copyOnlyErrors || s.copyOnlyFailedRequests || r.problems.length ? '!' : ' '
  console.log(`${flag} ${route}  steps ${s.steps}  pixel max ${s.maxPixelPct}% mean ${s.meanPixelPct}%` +
    `  telemetry-diff steps ${s.stepsWithTelemetryDiffs}` +
    (s.dropdownsOpened ? `  dropdowns opened ${s.dropdownsOpened}` : '') +
    `  hover ${s.hoverTargets} targets (${s.hoverChanged} changed), ${s.hoverDiffs} diffs` +
    `  copy-only errors ${s.copyOnlyErrors}  copy-only failed ${s.copyOnlyFailedRequests}`)
  for (const st of r.steps) for (const d of st.diffs) console.log(`     [${st.step}-${st.label}] ${d}`)
  for (const d of r.hoverDiffs) console.log(`     [hover] ${d}`)
  for (const p of r.problems) console.log(`     [problem] ${p}`)
  for (const e of r.copyOnlyErrors) console.log(`     [copy-only error] ${e}`)
  for (const f of r.copyOnlyFailedRequests) console.log(`     [copy-only failed] ${f}`)
  all.push({ route, viewport: VIEW, summary: s, problems: r.problems, hoverDiffs: r.hoverDiffs,
    copyOnlyErrors: r.copyOnlyErrors, copyOnlyFailedRequests: r.copyOnlyFailedRequests })
}

await browser.close()
const outFile = join(ROOT, `.scrollcompare-${VIEW}${SHARD ? `-shard${SHARD.replace('/', 'of')}` : ''}` +
  `${positional.length && !args.includes('--all') ? '-partial' : ''}.json`)
await writeFile(outFile, JSON.stringify(all, null, 1))
console.log(`\n--- scroll comparison complete ---\nreport: ${outFile}\nframes: shots/scroll/${VIEW}/`)
