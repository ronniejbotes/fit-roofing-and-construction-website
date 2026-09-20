/**
 * Probe: drive the motion layer in a real browser and screenshot it.
 * Needs `npm run serve` on :4400. Screenshots go to $OUT (default %TEMP%it-qa).
 *
 *   npm run motion:qa
 */
import { chromium } from 'playwright-core'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { CHROME, blockAnalytics, realPointer } from './browser.mjs'

const BASE = process.env.LOCAL || 'http://localhost:4400'
const OUT = process.env.OUT || join(process.env.TEMP || '.', 'fit-qa')
await mkdir(OUT, { recursive: true })

const problems = []
const note = (s) => console.log(s)
const bad = (s) => { problems.push(s); console.log('  !! ' + s) }

async function watch(page, label) {
  const errors = []
  const failed = []
  const offOrigin = []
  page.on('pageerror', (e) => errors.push(String(e.message || e)))
  page.on('console', (m) => {
    if (m.type() !== 'error') return
    const url = m.location()?.url || ''
    // Aborted analytics beacons (tools/browser.mjs) log as ERR_FAILED from
    // Google's origin. Only same-origin or script errors count against us.
    if (url && !url.startsWith(BASE)) { offOrigin.push(url.slice(0, 90)); return }
    errors.push(m.text() + (url ? '  @ ' + url : ''))
  })
  page.on('requestfailed', (r) => {
    if (!r.url().startsWith(BASE)) return
    const why = r.failure()?.errorText || ''
    // net::ERR_ABORTED is Chromium cancelling its own request (a srcset
    // re-pick, a media element unmounting), never the server failing —
    // MIRROR.md records the same on the untouched mirror for the logo PNG.
    // A real failure arrives as an HTTP status via the response handler.
    if (why === 'net::ERR_ABORTED') return
    failed.push(r.url() + ' ' + why)
  })
  page.on('response', (r) => { if (r.url().startsWith(BASE) && r.status() >= 400) failed.push(r.url() + ' HTTP ' + r.status()) })
  return () => {
    if (errors.length) bad(`${label}: ${errors.length} console/page error(s):\n     ` + errors.slice(0, 6).join('\n     '))
    if (failed.length) bad(`${label}: ${failed.length} failed same-origin request(s):\n     ` + failed.slice(0, 6).join('\n     '))
    if (!errors.length && !failed.length) note(`  ${label}: 0 errors, 0 failed requests` + (offOrigin.length ? ` (${offOrigin.length} off-origin beacon(s) aborted by the harness: ${[...new Set(offOrigin)].join(', ')})` : ''))
  }
}

const browser = await chromium.launch({ executablePath: CHROME, headless: true })

/* ---------------- Desktop: gate → hero → scroll → hover → transition ---- */
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
  await blockAnalytics(ctx)
  await ctx.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      window.__fitArriving = document.documentElement.classList.contains('fit-arriving')
    })
  })
  const page = await ctx.newPage()
  const report = await watch(page, 'desktop /')

  note('\n[desktop] / — gate')
  await page.goto(BASE + '/', { waitUntil: 'load' })
  await page.waitForTimeout(600)
  const gate = await page.$('#fit-build-gate')
  if (!gate) bad('gate not present on /')
  else {
    const state = await gate.getAttribute('data-state')
    const locked = await page.evaluate(() => document.documentElement.classList.contains('fit-gate-open'))
    note(`  gate state=${state} locked=${locked}`)
    await page.screenshot({ path: join(OUT, '01-gate-closed.png') })

    // Scroll must be refused while closed.
    await page.mouse.move(700, 450)
    await page.mouse.wheel(0, 800)
    await page.waitForTimeout(200)
    const y0 = await page.evaluate(() => window.scrollY)
    if (y0 !== 0) bad(`scroll not locked behind gate (scrollY=${y0})`)
    else note('  scroll locked ✓')

    const btnText = await page.textContent('.fit-gate-btn')
    const kicker = await page.textContent('.fit-gate-kicker')
    note(`  copy: "${kicker}" / "${btnText}"`)

    // Which fixed elements are not ours? (finds the chat launcher selector)
    const fixed = await page.evaluate(() => Array.from(document.querySelectorAll('body *'))
      .filter((el) => getComputedStyle(el).position === 'fixed' && !el.closest('#fit-build-gate'))
      .map((el) => `${el.tagName.toLowerCase()}#${el.id || '-'}.${(el.className && el.className.toString().split(' ').slice(0, 3).join('.')) || '-'} z=${getComputedStyle(el).zIndex} vis=${getComputedStyle(el).visibility} ${el.src ? 'src=' + el.src.slice(0, 60) : ''}`))
    note('  fixed elements (not gate):\n     ' + (fixed.join('\n     ') || '(none)'))

    await page.click('.fit-gate-btn')
    await page.waitForTimeout(1200)
    await page.screenshot({ path: join(OUT, '02-gate-playing.png') })
    const playing = await page.evaluate(() => {
      const v = document.querySelector('.fit-gate-video')
      return v ? { paused: v.paused, t: v.currentTime.toFixed(2), dur: v.duration, state: document.querySelector('#fit-build-gate')?.getAttribute('data-state') } : null
    })
    note(`  playing: ${JSON.stringify(playing)}`)
    if (!playing || playing.paused) bad('video did not start playing after click')

    await page.waitForFunction(() => !document.querySelector('#fit-build-gate'), null, { timeout: 12000 }).catch(() => bad('gate never removed itself'))
    await page.waitForTimeout(400)
    const unlocked = await page.evaluate(() => !document.documentElement.classList.contains('fit-gate-open'))
    if (!unlocked) bad('scroll still locked after gate')
    await page.screenshot({ path: join(OUT, '03-after-gate-hero.png') })
  }

  note('[desktop] / — hero + tags')
  const tags = await page.evaluate(() => ({
    motion: document.documentElement.classList.contains('fit-motion'),
    hero: !!document.querySelector('.fit-hero'),
    heroBg: !!document.querySelector('.fit-hero-bg__img') && getComputedStyle(document.querySelector('.fit-hero-bg__img')).backgroundImage.includes('url('),
    heroOwnBg: document.querySelector('.fit-hero') ? getComputedStyle(document.querySelector('.fit-hero')).backgroundImage : null,
    owner: !!document.querySelector('.fit-owner-glow'),
    cue: !!document.querySelector('.fit-scroll-cue'),
    h1: !!document.querySelector('.fit-h1'),
    reveal: document.querySelectorAll('[data-fit-reveal]').length,
    revealedNow: document.querySelectorAll('[data-fit-reveal].fit-in').length,
    cards: document.querySelectorAll('.fit-card').length,
    tiles: document.querySelectorAll('.fit-tile').length,
    h2: document.querySelectorAll('.fit-h2').length,
    progress: !!document.querySelector('.fit-progress'),
  }))
  note('  ' + JSON.stringify(tags))
  if (!tags.motion) bad('html.fit-motion not set')
  if (!tags.hero || !tags.heroBg) bad('hero layer not built')
  if (tags.heroOwnBg && tags.heroOwnBg !== 'none') bad('hero container still paints its own background: ' + tags.heroOwnBg)
  if (!tags.owner) bad('owner glow missing')
  if (!tags.cards) bad('no service cards tagged')
  if (!tags.tiles) bad('no tiles tagged')

  // Owner parallax: the widget must not be a reveal target, and must move.
  await page.evaluate(() => window.scrollTo(0, 200))
  await page.waitForTimeout(350)
  const ownerT = await page.evaluate(() => {
    const w = document.querySelector('.fit-owner .elementor-widget-image')
    return w ? { reveal: w.hasAttribute('data-fit-reveal'), t: getComputedStyle(w).transform } : null
  })
  note('  owner widget after 200px scroll: ' + JSON.stringify(ownerT))
  if (!ownerT) bad('owner widget not found')
  else if (ownerT.reveal) bad('owner widget is still a reveal target')
  else if (!/matrix\(1, 0, 0, 1, 0, 1[4-8]/.test(ownerT.t)) bad('owner parallax not applied (computed ' + ownerT.t + ')')
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.waitForTimeout(250)

  note('[desktop] / — scroll-through')
  await realPointer(page, 700, 500)
  const H = await page.evaluate(() => document.documentElement.scrollHeight)
  let shot = 4
  for (let y = 0; y < H; y += 675) {
    await page.mouse.wheel(0, 675)
    await page.waitForTimeout(140)
    if (y > 0 && Math.floor(y / 675) % 3 === 0 && shot < 9) {
      await page.waitForTimeout(700)
      await page.screenshot({ path: join(OUT, `0${shot++}-scroll-${Math.round(y)}.png`) })
    }
  }
  await page.waitForTimeout(900)
  const after = await page.evaluate(() => ({
    total: document.querySelectorAll('[data-fit-reveal]').length,
    inView: document.querySelectorAll('[data-fit-reveal].fit-in').length,
    progress: getComputedStyle(document.documentElement).getPropertyValue('--fit-scroll').trim(),
    sticky: !!document.querySelector('.elementor-sticky--active'),
    heroY: document.querySelector('.fit-hero-bg')?.style.getPropertyValue('--fit-hero-y'),
  }))
  note('  ' + JSON.stringify(after))
  if (after.inView < after.total) {
    const left = await page.evaluate(() => Array.from(document.querySelectorAll('[data-fit-reveal]:not(.fit-in)'))
      .map((el) => `${el.tagName.toLowerCase()}.${el.className.toString().split(' ').filter((c) => /^elementor-(widget-|hidden|element-)/.test(c)).join('.')} display=${getComputedStyle(el).display} box=${el.offsetWidth}x${el.offsetHeight}`))
    bad(`${after.total - after.inView} reveal target(s) never revealed after a full scroll:\n     ` + left.join('\n     '))
  }
  await page.screenshot({ path: join(OUT, '09-bottom.png') })

  note('[desktop] / — card hover')
  const card = await page.$('.fit-card')
  if (card) {
    await card.scrollIntoViewIfNeeded()
    await page.waitForTimeout(500)
    const box = await card.boundingBox()
    await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.3, { steps: 8 })
    await page.waitForTimeout(1100)
    const t = await card.evaluate((el) => el.style.transform)
    note(`  card inline transform: ${t || '(none)'}`)
    if (!/rotate/.test(t)) bad('tilt did not apply on hover')
    const imgT = await card.evaluate((el) => { const i = el.querySelector('.elementor-widget-image img'); return i ? getComputedStyle(i).transform : 'no img' })
    note(`  card image transform on hover: ${imgT}`)
    if (!/^matrix\(1\.05/.test(imgT)) bad('card image zoom not applied on hover (computed ' + imgT + ')')
    await page.screenshot({ path: join(OUT, '10-card-hover.png'), clip: { x: Math.max(0, box.x - 40), y: Math.max(0, box.y - 40), width: Math.min(1440, box.width + 80), height: Math.min(900, box.height + 80) } })
    await page.mouse.move(10, 10)
  }

  note('[desktop] / — tile hover + counters')
  const tile = await page.$('.fit-tile')
  if (tile) {
    await tile.scrollIntoViewIfNeeded()
    await page.waitForTimeout(700)
    const tb = await tile.boundingBox()
    await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2, { steps: 6 })
    await page.waitForTimeout(700)
    const tt = await tile.evaluate((el) => getComputedStyle(el).transform)
    note(`  tile hover transform: ${tt}`)
    if (!/matrix\(1, 0, 0, 1, 0, -4\)/.test(tt)) bad('tile hover lift not applied (computed ' + tt + ')')
    await page.mouse.move(10, 10)
  }
  const counters = await page.evaluate(() => Array.from(document.querySelectorAll('.elementor-widget-counter')).map((el) => getComputedStyle(el).transform))
  note(`  counter transforms after reveal: ${JSON.stringify(counters)}`)
  if (counters.some((c) => c !== 'none' && !/^matrix\(1, 0, 0, 1, 0, 0\)$/.test(c))) bad('a counter is still offset after reveal')

  note('[desktop] / → /about/ — roofline transition')
  const link = await page.$('a[href="/about"], a[href="/about/"]')
  if (!link) bad('no /about link to test the transition')
  else {
    await link.scrollIntoViewIfNeeded()
    await page.waitForTimeout(300)
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
      (async () => {
        await link.click()
        await page.waitForTimeout(160)
        const leaving = await page.evaluate(() => document.documentElement.classList.contains('fit-leaving')).catch(() => null)
        note(`  fit-leaving after click: ${leaving}`)
        await page.screenshot({ path: join(OUT, '11-leaving.png') }).catch(() => {})
        await page.waitForTimeout(180)
        await page.screenshot({ path: join(OUT, '11b-leaving-late.png') }).catch(() => {})
      })(),
    ])
    // The curtain is lifting from first paint; catch it early, then mid-way.
    await page.screenshot({ path: join(OUT, '12-arriving.png') }).catch(() => {})
    await page.waitForTimeout(260)
    await page.screenshot({ path: join(OUT, '12b-arriving-mid.png') }).catch(() => {})
    await page.waitForLoadState('load')
    const arrived = await page.evaluate(() => ({ arriving: window.__fitArriving, url: location.pathname }))
    note(`  arrived at ${arrived.url}, fit-arriving at DOMContentLoaded: ${arrived.arriving}`)
    if (!arrived.arriving) bad('html.fit-arriving was not set on the destination page')
    await page.waitForTimeout(1200)
    await page.screenshot({ path: join(OUT, '13-about.png') })
    const aboutTags = await page.evaluate(() => ({
      hero: !!document.querySelector('.fit-hero'),
      reveal: document.querySelectorAll('[data-fit-reveal]').length,
      gate: !!document.querySelector('#fit-build-gate'),
      arrivingLeft: document.documentElement.classList.contains('fit-arriving'),
    }))
    note('  ' + JSON.stringify(aboutTags))
    if (aboutTags.gate) bad('gate appeared on /about/ (must be homepage only)')
    if (aboutTags.arrivingLeft) bad('fit-arriving class never dropped')
  }
  report()
  await ctx.close()
}

/* ---------------- Mobile: gate skip + scroll ----------------------------- */
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  await blockAnalytics(ctx)
  const page = await ctx.newPage()
  const report = await watch(page, 'mobile /')
  note('\n[mobile] /')
  await page.goto(BASE + '/', { waitUntil: 'load' })
  await page.waitForTimeout(600)
  await page.screenshot({ path: join(OUT, '20-m-first.png') })
  // Phones get no gate by design (GATE_MIN_WIDTH in fit-home.js).
  const mGate = await page.evaluate(() => ({
    gate: !!document.querySelector('#fit-build-gate'),
    locked: document.documentElement.classList.contains('fit-gate-open'),
    minWidth: 768,
  }))
  if (mGate.gate || mGate.locked) bad('mobile: gate appeared under 768px (should be skipped by GATE_MIN_WIDTH)')
  else note('  no gate on a phone ✓')
  await page.screenshot({ path: join(OUT, '21-m-hero.png') })
  await page.evaluate(() => window.scrollTo(0, 2400))
  await page.waitForTimeout(900)
  await page.screenshot({ path: join(OUT, '22-m-scroll.png') })
  const m = await page.evaluate(() => {
    const d = document.documentElement
    const vw = d.clientWidth
    const wide = Array.from(document.querySelectorAll('body *'))
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.right > vw + 1 && r.width > 0)
      .slice(0, 6)
      .map(({ el, r }) => `${el.tagName.toLowerCase()}.${el.className.toString().split(' ').slice(0, 3).join('.')} right=${Math.round(r.right)}`)
    const withOurs = d.scrollWidth
    document.querySelectorAll('link[data-fit-motion]').forEach((l) => { l.disabled = true })
    const withoutOurs = d.scrollWidth
    document.querySelectorAll('link[data-fit-motion]').forEach((l) => { l.disabled = false })
    return {
      total: document.querySelectorAll('[data-fit-reveal]').length,
      tilted: Array.from(document.querySelectorAll('.fit-card')).filter((c) => c.style.transform).length,
      vw, scrollWidthWithOurs: withOurs, scrollWidthWithoutOurs: withoutOurs, wide,
    }
  })
  note('  ' + JSON.stringify(m))
  if (m.scrollWidthWithOurs > m.vw && m.scrollWidthWithOurs > m.scrollWidthWithoutOurs) bad(`mobile: horizontal overflow introduced by the motion layer (${m.scrollWidthWithoutOurs} → ${m.scrollWidthWithOurs})`)
  else if (m.scrollWidthWithOurs > m.vw) note(`  mobile overflow is pre-existing on the mirror (${m.scrollWidthWithoutOurs}px without our CSS) — not ours`)
  report()
  await ctx.close()
}

/* ---------------- Reduced motion: nothing at all ------------------------- */
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' })
  await blockAnalytics(ctx)
  const page = await ctx.newPage()
  const report = await watch(page, 'reduced-motion /')
  note('\n[reduced motion] /')
  await page.goto(BASE + '/', { waitUntil: 'load' })
  await page.waitForTimeout(500)
  const r = await page.evaluate(() => ({
    gate: !!document.querySelector('#fit-build-gate'),
    motion: document.documentElement.classList.contains('fit-motion'),
    hidden: Array.from(document.querySelectorAll('[data-fit-reveal]')).filter((el) => getComputedStyle(el).opacity === '0').length,
  }))
  note('  ' + JSON.stringify(r))
  if (r.gate) bad('reduced motion: gate still shown')
  if (r.motion) bad('reduced motion: html.fit-motion set')
  if (r.hidden) bad(`reduced motion: ${r.hidden} element(s) hidden`)
  await page.screenshot({ path: join(OUT, '30-reduced.png') })
  report()
  await ctx.close()
}

/* ---------------- Inner pages: a service page and a blog post ------------ */
for (const path of ['/roof-repair-texas/', '/blog/', '/contact/']) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await blockAnalytics(ctx)
  const page = await ctx.newPage()
  const report = await watch(page, path)
  await page.goto(BASE + path, { waitUntil: 'load' })
  await page.waitForTimeout(700)
  const t = await page.evaluate(() => ({
    hero: !!document.querySelector('.fit-hero'),
    reveal: document.querySelectorAll('[data-fit-reveal]').length,
    cards: document.querySelectorAll('.fit-card').length,
    gate: !!document.querySelector('#fit-build-gate'),
    formHidden: Array.from(document.querySelectorAll('form')).some((f) => getComputedStyle(f).opacity === '0' || f.closest('[data-fit-reveal]')),
  }))
  note(`\n[${path}] ${JSON.stringify(t)}`)
  if (t.gate) bad(`${path}: gate must not appear here`)
  if (t.formHidden) bad(`${path}: a form is inside a reveal target`)
  await page.screenshot({ path: join(OUT, `40${path.replace(/\W+/g, '-')}.png`) })
  report()
  await ctx.close()
}

await browser.close()
console.log(`\nScreenshots: ${OUT}`)
if (problems.length) {
  console.log(`\n${problems.length} problem(s):`)
  problems.forEach((p) => console.log(' - ' + p.split('\n')[0]))
  process.exit(1)
}
console.log('\nAll checks passed.')
