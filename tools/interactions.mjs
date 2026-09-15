/**
 * The behaviours a visitor triggers by clicking, compared on live and the copy.
 *
 * scrollcompare.mjs covers what happens while scrolling and hovering. What is
 * left is what only happens on a click or a tap: accordions opening, the reviews
 * carousel's arrows and "Read more", video playback, lightboxes, in-page anchor
 * jumps, the phone and email links, and each form's client-side validation.
 *
 * Two things are deliberately never done, because the live site is a working
 * business: no form is submitted — validation is read with checkValidity(),
 * which sends nothing — and the FastBots chat is never opened. Analytics beacons
 * are aborted on both sides (see browser.mjs).
 *
 * Needs `npm run serve`.
 *
 *   node tools/interactions.mjs                   # every page, 1440x900
 *   node tools/interactions.mjs / /contact/ --mobile
 */
import { chromium } from 'playwright-core'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ORIGIN, UA } from './site.mjs'
import { CHROME, blockAnalytics } from './browser.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const argVal = (f) => { const i = args.indexOf(f); return i === -1 ? null : args[i + 1] }
const LOCAL = argVal('--local') || 'http://localhost:4400'
const MOBILE = args.includes('--mobile')
const VIEW = MOBILE ? 'mobile' : 'desktop'
const VIEWPORT = MOBILE ? { width: 390, height: 844 } : { width: 1440, height: 900 }

const VALUED = new Set(['--local', '--shard'])
const SHARD = argVal('--shard')
const positional = args.filter((a, i) => !a.startsWith('--') && !VALUED.has(args[i - 1]))
const mangled = positional.filter((a) => /^[A-Za-z]:[\\/]/.test(a))
if (mangled.length) {
  console.error(`Route argument(s) look like Windows paths: ${mangled.join(', ')}`)
  console.error('Git Bash rewrote them. Run from PowerShell, or prefix MSYS_NO_PATHCONV=1.')
  process.exit(2)
}
const routeList = positional.length ? positional
  : (await readFile(join(ROOT, 'routes.txt'), 'utf8')).split('\n')
      .map((s) => s.trim()).filter((s) => s && !s.startsWith('#') && !s.endsWith('.xml'))
// --shard 2/3 takes every third route starting from the second, so one pass can
// be split across parallel processes without two of them sharing a route.
const routes = SHARD
  ? routeList.filter((_, i) => i % Number(SHARD.split('/')[1]) === Number(SHARD.split('/')[0]) - 1)
  : routeList

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const slugOf = (route) => route.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'home'
const centre = (loc) => loc.evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }))

/**
 * Playwright's error with its call log kept and the terminal colour codes
 * removed. The first line alone says only "Timeout exceeded"; the call log says
 * whether the element was hidden, moving, or covered by something else.
 */
const cleanError = (e) => e.message.replace(/\[\d+m/g, '').split('\n')
  .map((l) => l.trim()).filter(Boolean).slice(0, 12).join(' / ').slice(0, 900)

const browser = await chromium.launch({ executablePath: CHROME })

async function open(ctx, url) {
  const page = await ctx.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 160)))
  await page.goto(url, { waitUntil: 'load', timeout: 60000 })
  // Real input, so anything waiting for a first interaction starts.
  await page.mouse.move(VIEWPORT.width - 2, 300, { steps: 4 })
  await page.mouse.wheel(0, 200)
  await sleep(300)
  await page.mouse.wheel(0, -200)
  await sleep(2500)
  return { page, errors }
}

/** Phone, email and other non-http links: what a tap on each would do. */
function contactLinks(page) {
  return page.evaluate(() => [...document.querySelectorAll('a[href]')]
    .map((a) => a.getAttribute('href'))
    .filter((h) => /^(tel|mailto|sms):/i.test(h))
    .sort())
}

/** Each form's client-side validation, read without ever submitting. */
function forms(page) {
  return page.evaluate(() => [...document.querySelectorAll('form')].map((f) => {
    const fields = [...f.querySelectorAll('input, textarea, select')].filter((e) => e.type !== 'hidden')
    const describe = () => fields.filter((e) => !e.validity.valid).map((e) => `${e.name}: ${e.validationMessage}`)
    const empty = { valid: f.checkValidity(), invalid: describe() }
    // A malformed email, where there is an email field, then put back.
    let badEmail = null
    const email = fields.find((e) => e.type === 'email')
    if (email) {
      const was = email.value
      email.value = 'not-an-email'
      badEmail = email.validationMessage
      email.value = was
    }
    return {
      name: f.getAttribute('name'), noValidate: f.noValidate, method: f.method,
      fields: fields.map((e) => `${e.name}:${e.type}${e.required ? ':required' : ''}`),
      empty, badEmail,
      submit: (f.querySelector('[type="submit"]')?.textContent || '').replace(/\s+/g, ' ').trim(),
    }
  }))
}

/** Click every accordion or toggle title and measure the panel. */
async function accordions(page) {
  const loc = page.locator('.elementor-accordion .elementor-tab-title, .elementor-toggle .elementor-tab-title, ' +
    '.e-n-accordion-item > summary, details > summary')
  const n = Math.min(await loc.count(), 20)
  const out = []
  for (let i = 0; i < n; i++) {
    const t = loc.nth(i)
    if (!(await t.isVisible().catch(() => false))) { out.push({ i, visible: false }); continue }
    try {
      await centre(t)
      await sleep(250)
      const read = () => t.evaluate((el) => {
        const item = el.closest('details, .elementor-accordion-item, .elementor-toggle-item') || el.parentElement
        const panel = item.querySelector('.elementor-tab-content, [role="region"], .e-n-accordion-item > div')
        return {
          title: el.textContent.replace(/\s+/g, ' ').trim().slice(0, 60),
          open: el.getAttribute('aria-expanded') === 'true' || (item.tagName === 'DETAILS' && item.open) ||
            el.classList.contains('elementor-active'),
          panelH: panel ? Math.round(panel.getBoundingClientRect().height) : 0,
        }
      })
      const before = await read()
      await t.click({ timeout: 3000 })
      await sleep(1000)
      out.push({ i, before, after: await read() })
    } catch (e) { out.push({ i, error: e.message.split('\n')[0].slice(0, 80) }) }
  }
  return out
}

/** The Trustindex reviews carousel: arrows and "Read more". */
async function reviews(page) {
  if (!(await page.locator('.ti-widget').count())) return null
  const state = () => page.evaluate(() => {
    const ti = document.querySelector('.ti-widget')
    const wrap = ti.querySelector('.ti-reviews-container-wrapper') || ti
    const wr = wrap.getBoundingClientRect()
    const items = [...ti.querySelectorAll('.ti-review-item')]
    const first = items.find((it) => { const r = it.getBoundingClientRect(); return r.width > 0 && r.left >= wr.left - 4 && r.left < wr.right })
    return { index: first ? items.indexOf(first) : -1, items: items.length }
  })
  try {
    await centre(page.locator('.ti-widget').first())
    await sleep(1200)
    // Park the pointer over the widget: Trustindex pauses autoplay on hover, so
    // only the clicks move it from here.
    const box = await page.locator('.ti-widget').first().boundingBox()
    if (box) await page.mouse.move(Math.round(box.x + box.width / 2), Math.round(box.y + 20), { steps: 6 })
    await sleep(600)
    const s0 = await state()
    const out = { items: s0.items, nextMoves: null, prevMoves: null, readMore: null }
    const next = page.locator('.ti-widget .ti-next').first()
    if (await next.count() && await next.isVisible().catch(() => false)) {
      await next.click({ timeout: 3000 }); await sleep(1100)
      const s1 = await state()
      out.nextMoves = s1.index !== s0.index
      const prev = page.locator('.ti-widget .ti-prev').first()
      if (await prev.isVisible().catch(() => false)) {
        await prev.click({ timeout: 3000 }); await sleep(1100)
        out.prevMoves = (await state()).index !== s1.index
      }
    }
    // "Read more", on the same review on both sides: the alphabetically first
    // reviewer whose card has one, brought into the carousel window with the
    // arrows, clicked with a real pointer, with every DOM change inside that card
    // counted. Choosing a card by position compared different reviews, because
    // the two carousels are never on the same card at the same moment.
    //
    // Checked on 15 September 2026 (shots/_probe/ti-readmore.mjs): on live, a real
    // click lands on span.ti-read-more and changes nothing — the label stays, the
    // text stays clipped, and not one DOM mutation happens. The copy behaves
    // identically. It is a dead control on the live site, carried over as it is.
    const name = await page.evaluate(() => [...document.querySelectorAll('.ti-widget .ti-review-item')]
      .filter((it) => (it.querySelector('.ti-read-more')?.textContent || '').trim())
      .map((it) => (it.querySelector('.ti-name')?.textContent || '').trim()).sort()[0] || null)
    if (name) {
      const item = page.locator('.ti-widget .ti-review-item')
        .filter({ has: page.locator('.ti-name', { hasText: name }) }).first()
      const inWindow = () => item.evaluate((it) => {
        const ti = it.closest('.ti-widget')
        const wr = (ti.querySelector('.ti-reviews-container-wrapper') || ti).getBoundingClientRect()
        const r = it.getBoundingClientRect()
        return r.left >= wr.left - 1 && r.right <= wr.right + 1
      })
      // Arrow toward the card: back if it sits left of the window, forward if
      // right. Trustindex hides the arrow at each end of the list, so always
      // pressing "next" timed out whenever a carousel had already passed the
      // card — which depends only on when the page loaded. A hidden arrow ends
      // the search instead.
      for (let k = 0; k < 12 && !(await inWindow()); k++) {
        const leftOfWindow = await item.evaluate((it) => {
          const ti = it.closest('.ti-widget')
          const wr = (ti.querySelector('.ti-reviews-container-wrapper') || ti).getBoundingClientRect()
          return it.getBoundingClientRect().left < wr.left
        })
        const arrow = page.locator(`.ti-widget ${leftOfWindow ? '.ti-prev' : '.ti-next'}`).first()
        if (!(await arrow.isVisible().catch(() => false))) break
        await arrow.click({ timeout: 4000 })
        await sleep(900)
      }
      await item.evaluate((it) => {
        window.__tiMutations = 0
        new MutationObserver((ms) => { window.__tiMutations += ms.length })
          .observe(it, { subtree: true, attributes: true, childList: true, characterData: true })
      })
      const read = () => item.evaluate((it) => {
        const more = it.querySelector('.ti-read-more')
        const c = it.querySelector(more?.getAttribute('data-container') || '.ti-review-content')
        return {
          label: (more?.textContent || '').replace(/\s+/g, ' ').trim(),
          clipped: c ? c.scrollHeight > c.clientHeight + 1 : null,
          popups: [...document.querySelectorAll('[class*="ti-popup"], [class*="ti-modal"]')]
            .filter((p) => getComputedStyle(p).display !== 'none').length,
          mutations: window.__tiMutations,
        }
      })
      const before = await read()
      const mb = await item.locator('.ti-read-more').boundingBox()
      if (!(await inWindow())) out.readMore = { review: name, notInView: true }
      else if (mb) {
        await page.mouse.move(Math.round(mb.x + mb.width / 2), Math.round(mb.y + mb.height / 2), { steps: 8 })
        await sleep(200)
        await page.mouse.down()
        await page.mouse.up()
        await sleep(1200)
        out.readMore = { review: name, before, after: await read() }
      }
    }
    return out
  } catch (e) {
    return { error: cleanError(e) }
  }
}

/** Every video: its attributes, and whether it actually plays. */
function videos(page) {
  return page.evaluate(async () => {
    const out = []
    for (const v of document.querySelectorAll('video')) {
      v.scrollIntoView({ block: 'center', behavior: 'instant' })
      await new Promise((r) => setTimeout(r, 500))
      const rec = {
        autoplay: v.autoplay, muted: v.muted, loop: v.loop, controls: v.controls, playsInline: v.playsInline,
        poster: (v.poster || '').replace(location.origin, ''),
        src: (v.currentSrc || v.src || v.querySelector('source')?.src || '').replace(location.origin, ''),
      }
      const t0 = v.currentTime
      if (v.paused) { v.muted = true; try { await v.play() } catch (e) { rec.playError = e.name } }
      await new Promise((r) => setTimeout(r, 2500))
      rec.plays = v.currentTime > t0
      rec.size = `${v.videoWidth}x${v.videoHeight}`
      rec.duration = Math.round(v.duration || 0)
      v.pause()
      out.push(rec)
    }
    return out
  })
}

/** Click the first image that opens Elementor's lightbox, if any. */
async function lightbox(page) {
  const loc = page.locator('a[data-elementor-open-lightbox="yes"], a[data-elementor-open-lightbox="default"]')
  const n = await loc.count()
  const url = page.url()
  for (let i = 0; i < n; i++) {
    const a = loc.nth(i)
    if (!(await a.isVisible().catch(() => false))) continue
    try {
      await centre(a); await sleep(300)
      await a.click({ timeout: 3000 }); await sleep(1500)
      if (page.url() !== url) { const to = page.url(); await page.goBack().catch(() => {}); return { navigatedTo: to } }
      const st = await page.evaluate(() => {
        const lb = [...document.querySelectorAll('.dialog-type-lightbox, .elementor-lightbox')]
          .find((e) => getComputedStyle(e).display !== 'none')
        if (!lb) return { opened: false }
        const img = lb.querySelector('img')
        return { opened: true, image: img ? (img.currentSrc || img.src).replace(location.origin, '') : null }
      })
      const shot = await page.screenshot({ type: 'png' })
      await page.keyboard.press('Escape'); await sleep(700)
      return { ...st, candidates: n, shot }
    } catch (e) { return { error: e.message.split('\n')[0].slice(0, 80) } }
  }
  return n ? { candidates: n, visible: 0 } : null
}

/** In-page anchor links: where a click lands. */
async function anchors(page) {
  const hrefs = await page.evaluate(() => [...new Set([...document.querySelectorAll('a[href*="#"]')]
    .filter((a) => {
      const u = new URL(a.href, location.href)
      const r = a.getBoundingClientRect()
      return u.pathname === location.pathname && u.hash.length > 1 && r.width > 0 && r.height > 0
    })
    .map((a) => a.getAttribute('href')))].slice(0, 8))
  const out = []
  for (const h of hrefs) {
    try {
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
      await sleep(300)
      const a = page.locator(`a[href=${JSON.stringify(h)}]`).filter({ visible: true }).first()
      await a.click({ timeout: 3000 })
      await sleep(1600)
      out.push({ href: h, ...(await page.evaluate((hash) => {
        const id = decodeURIComponent(hash.slice(hash.indexOf('#') + 1))
        const el = document.getElementById(id)
        return { y: Math.round(scrollY), targetTop: el ? Math.round(el.getBoundingClientRect().top) : null }
      }, h)) })
    } catch (e) { out.push({ href: h, error: e.message.split('\n')[0].slice(0, 80) }) }
  }
  return out
}

async function composite(differ, bufA, bufB) {
  return differ.evaluate(async ({ a, b }) => {
    const load = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src })
    const [ia, ib] = await Promise.all([load(a), load(b)])
    const w = Math.max(ia.width, ib.width), h = Math.max(ia.height, ib.height), s = w > 800 ? 0.5 : 1
    const out = document.createElement('canvas')
    out.width = Math.round(w * s) * 2 + 8; out.height = Math.round(h * s) + 22
    const o = out.getContext('2d')
    o.fillStyle = '#222'; o.fillRect(0, 0, out.width, out.height)
    ;[ia, ib].forEach((img, k) => {
      const x0 = k * (Math.round(w * s) + 8)
      o.drawImage(img, x0, 22, Math.round(img.width * s), Math.round(img.height * s))
      o.fillStyle = '#fff'; o.font = 'bold 14px sans-serif'; o.fillText(k ? 'COPY' : 'LIVE', x0 + 6, 16)
    })
    return out.toDataURL('image/jpeg', 0.72)
  }, { a: 'data:image/png;base64,' + bufA.toString('base64'), b: 'data:image/png;base64,' + bufB.toString('base64') })
}

const differ = await browser.newPage()

async function run(route) {
  const dir = join(ROOT, 'shots', 'interactions', VIEW, slugOf(route))
  await mkdir(dir, { recursive: true })
  const ctxL = await browser.newContext({ viewport: VIEWPORT, userAgent: UA })
  const ctxC = await browser.newContext({ viewport: VIEWPORT, userAgent: UA })
  await blockAnalytics(ctxL)
  await blockAnalytics(ctxC)
  const [L, C] = await Promise.all([open(ctxL, ORIGIN + route), open(ctxC, LOCAL + route)])
  const both = (fn) => Promise.all([fn(L.page), fn(C.page)])
  const r = { route, viewport: VIEW, diffs: [], notes: [] }
  const cmp = (name, a, b) => {
    r[name] = { live: a, copy: b }
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      r.diffs.push(`${name}: live ${JSON.stringify(a).slice(0, 500)} | copy ${JSON.stringify(b).slice(0, 500)}`)
    }
  }

  cmp('contactLinks', ...(await both(contactLinks)))
  cmp('forms', ...(await both(forms)))
  cmp('accordions', ...(await both(accordions)))
  // The carousel rotates, so the two sides may be on different reviews. What is
  // compared is what the controls do, not which card they land on.
  const [ra, rb] = await both(reviews)
  const behaviour = (x) => x && (x.error ? { error: true } : {
    items: x.items, nextMoves: x.nextMoves, prevMoves: x.prevMoves,
    readMore: x.readMore && (x.readMore.notInView ? { review: x.readMore.review, notInView: true } : {
      review: x.readMore.review,
      changesCard: x.readMore.after.mutations > 0,
      labels: [x.readMore.before.label, x.readMore.after.label],
      unclips: !!x.readMore.before.clipped && !x.readMore.after.clipped,
      opensPopup: x.readMore.after.popups > x.readMore.before.popups,
    }),
  })
  cmp('reviews', behaviour(ra), behaviour(rb))
  r.reviews.raw = { live: ra, copy: rb }

  const [va, vb] = await both(videos)
  r.videos = { live: va, copy: vb }
  const vkey = (v) => JSON.stringify({ ...v, plays: undefined })
  if (va.map(vkey).join() !== vb.map(vkey).join()) r.diffs.push(`videos: live ${JSON.stringify(va)} | copy ${JSON.stringify(vb)}`)
  va.forEach((v, i) => {
    if (vb[i] && v.plays !== vb[i].plays) r.diffs.push(`video ${i} plays: live ${v.plays}, copy ${vb[i].plays}`)
  })

  const [la, lb] = await both(lightbox)
  r.lightbox = { live: la && { ...la, shot: undefined }, copy: lb && { ...lb, shot: undefined } }
  if (JSON.stringify(r.lightbox.live) !== JSON.stringify(r.lightbox.copy)) {
    r.diffs.push(`lightbox: live ${JSON.stringify(r.lightbox.live)} | copy ${JSON.stringify(r.lightbox.copy)}`)
  }
  if (la?.shot && lb?.shot) {
    const jpeg = await composite(differ, la.shot, lb.shot)
    await writeFile(join(dir, 'lightbox.jpg'), Buffer.from(jpeg.slice(jpeg.indexOf(',') + 1), 'base64'))
  }

  const [aa, ab] = await both(anchors)
  r.anchors = { live: aa, copy: ab }
  if (aa.length !== ab.length) r.diffs.push(`anchor links: live ${aa.length}, copy ${ab.length}`)
  aa.forEach((a, i) => {
    const b = ab[i]
    if (!b || a.href !== b.href || !!a.error !== !!b.error ||
        Math.abs((a.y ?? 0) - (b.y ?? 0)) > 6 || Math.abs((a.targetTop ?? 0) - (b.targetTop ?? 0)) > 6) {
      r.diffs.push(`anchor ${a.href}: live ${JSON.stringify(a)}, copy ${JSON.stringify(b)}`)
    }
  })

  const liveErr = new Set(L.errors)
  r.copyOnlyErrors = [...new Set(C.errors.filter((e) => !liveErr.has(e)))]
  await writeFile(join(dir, 'report.json'), JSON.stringify(r, null, 1))
  await ctxL.close()
  await ctxC.close()
  return r
}

console.log(`Interaction comparison of ${routes.length} route(s) at ${VIEWPORT.width}x${VIEWPORT.height}`)
console.log(`  live:  ${ORIGIN}\n  local: ${LOCAL}\n`)
const all = []
for (const route of routes) {
  let r
  try { r = await run(route) } catch (e) {
    console.log(`! ${route}  FATAL ${e.message.split('\n')[0]}`)
    all.push({ route, fatal: e.message.split('\n')[0] })
    continue
  }
  const count = (x) => (x && x.live ? (Array.isArray(x.live) ? x.live.length : 1) : 0)
  console.log(`${r.diffs.length || r.copyOnlyErrors.length ? '!' : ' '} ${route}` +
    `  forms ${count(r.forms)}  accordions ${count(r.accordions)}  reviews ${r.reviews.live ? 'yes' : 'no'}` +
    `  videos ${r.videos.live.length}  lightbox ${r.lightbox.live ? (r.lightbox.live.opened ? 'opened' : 'present') : 'no'}` +
    `  anchors ${r.anchors.live.length}  contact links ${r.contactLinks.live.length}` +
    `  diffs ${r.diffs.length}  copy-only errors ${r.copyOnlyErrors.length}`)
  for (const d of r.diffs) console.log(`     ${d}`)
  for (const e of r.copyOnlyErrors) console.log(`     [copy-only error] ${e}`)
  all.push({ route, diffs: r.diffs, copyOnlyErrors: r.copyOnlyErrors })
}
await browser.close()
const outFile = join(ROOT, `.interactions-${VIEW}${SHARD ? `-shard${SHARD.replace('/', 'of')}` : ''}.json`)
await writeFile(outFile, JSON.stringify(all, null, 1))
const bad = all.filter((x) => x.fatal || x.diffs.length || x.copyOnlyErrors.length)
console.log(`\n--- interaction comparison complete ---\nroutes ${all.length}, differing ${bad.length}\nreport: ${outFile}`)
process.exitCode = bad.length ? 1 : 0
