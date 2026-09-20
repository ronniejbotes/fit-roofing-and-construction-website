/**
 * Drive the rebuilt /portfolio/ page in Chromium and screenshot every state.
 * Needs `npm run serve` on :4400. Screenshots go to $OUT (default %TEMP%\fit-qa-portfolio).
 *
 *   npm run motion:qa:portfolio
 */
import { chromium } from 'playwright-core'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { CHROME, blockAnalytics, realPointer } from './browser.mjs'

const BASE = process.env.LOCAL || 'http://localhost:4400'
const OUT = process.env.OUT || join(process.env.TEMP || '.', 'fit-qa-portfolio')
await mkdir(OUT, { recursive: true })

const problems = []
const note = (s) => console.log(s)
const bad = (s) => { problems.push(s); console.log('  !! ' + s) }

function watch(page, label) {
  const errors = [], failed = []
  page.on('pageerror', (e) => errors.push(String(e.message || e)))
  page.on('console', (m) => {
    if (m.type() !== 'error') return
    const url = m.location()?.url || ''
    if (url && !url.startsWith(BASE)) return
    errors.push(m.text() + (url ? '  @ ' + url : ''))
  })
  page.on('requestfailed', (r) => {
    if (!r.url().startsWith(BASE)) return
    const why = r.failure()?.errorText || ''
    if (why === 'net::ERR_ABORTED') return
    failed.push(r.url() + ' ' + why)
  })
  page.on('response', (r) => { if (r.url().startsWith(BASE) && r.status() >= 400) failed.push(r.url() + ' HTTP ' + r.status()) })
  return () => {
    if (errors.length) bad(`${label}: ${errors.length} error(s):\n     ` + errors.slice(0, 6).join('\n     '))
    if (failed.length) bad(`${label}: ${failed.length} failed request(s):\n     ` + failed.slice(0, 6).join('\n     '))
    if (!errors.length && !failed.length) note(`  ${label}: 0 errors, 0 failed requests`)
  }
}

const browser = await chromium.launch({ executablePath: CHROME, headless: true })

/* The site's kit sets `html { scroll-behavior: smooth }`, so a plain
   window.scrollTo() ANIMATES — a screenshot taken 500ms later can land
   mid-scroll, and the compositor leaves a blank strip above the fixed header
   (seen as a "white band" that is not real layout). Every programmatic scroll
   here is instant. */
const JUMP = 'window.__jump = (y) => window.scrollTo({ top: y, left: 0, behavior: "instant" })'

/* ---------------- Desktop ------------------------------------------------ */
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await blockAnalytics(ctx)
  const page = await ctx.newPage()
  const report = watch(page, 'desktop /portfolio/')
  await page.goto(BASE + '/portfolio/', { waitUntil: 'load' })
  await page.evaluate(JUMP)
  await page.waitForTimeout(1400)

  note('\n[desktop] hero')
  const hero = await page.evaluate(() => {
    const m = document.querySelector('main.fp')
    const cs = m ? getComputedStyle(m) : null
    const h1 = document.querySelector('.fp-hero__title')
    const img = document.querySelector('.fp-hero__portrait img')
    const r = img ? img.getBoundingClientRect() : null
    return {
      main: !!m,
      motion: document.documentElement.classList.contains('fp-motion'),
      font: h1 ? getComputedStyle(h1).fontFamily.split(',')[0] : null,
      h1px: h1 ? Math.round(parseFloat(getComputedStyle(h1).fontSize)) : null,
      headerVar: m ? cs.getPropertyValue('--fp-header').trim() : null,
      heroHeight: Math.round(document.querySelector('.fp-hero').getBoundingClientRect().height),
      portrait: r ? { w: Math.round(r.width), h: Math.round(r.height), bottom: Math.round(r.bottom) } : null,
      fadedIn: document.querySelectorAll('.fp-hero [data-fp-fade].is-in').length,
      fadeTotal: document.querySelectorAll('.fp-hero [data-fp-fade]').length,
      old: !!document.querySelector('.elementor-404 .elementor-element'),
      skipTarget: !!document.getElementById('content'),
    }
  })
  note('  ' + JSON.stringify(hero))
  if (!hero.main) bad('main.fp missing')
  if (!hero.motion) bad('html.fp-motion not set')
  if (!/Kanit/i.test(hero.font || '')) bad('headline is not in Kanit: ' + hero.font)
  if (hero.fadedIn < hero.fadeTotal) bad(`hero: ${hero.fadeTotal - hero.fadedIn} fade target(s) not in`)
  if (hero.old) bad('old Elementor page body still present')
  await page.screenshot({ path: join(OUT, '01-hero.png') })

  note('[desktop] magnet')
  const img = await page.$('.fp-hero__portrait img')
  const box = await img.boundingBox()
  await realPointer(page, 300, 300)
  await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.3, { steps: 10 })
  await page.waitForTimeout(450)
  const mag = await page.evaluate(() => document.querySelector('.fp-magnet').style.transform)
  note('  magnet transform near portrait: ' + (mag || '(none)'))
  if (!/translate3d\((-?\d)/.test(mag) || /translate3d\(0px, 0px/.test(mag)) bad('magnet did not move toward the pointer')
  await page.screenshot({ path: join(OUT, '02-magnet.png') })
  await page.mouse.move(20, 20, { steps: 6 })
  await page.waitForTimeout(800)
  const magBack = await page.evaluate(() => document.querySelector('.fp-magnet').style.transform)
  note('  magnet after leaving: ' + magBack)

  note('[desktop] marquee')
  const mq = await page.$('.fp-marquee')
  await mq.scrollIntoViewIfNeeded()
  await page.waitForTimeout(400)
  const m1 = await page.evaluate(() => [1, 2].map((i) => document.querySelector(`[data-fp-row="${i}"]`).style.transform))
  await page.mouse.wheel(0, 500)
  await page.waitForTimeout(400)
  const m2 = await page.evaluate(() => [1, 2].map((i) => document.querySelector(`[data-fp-row="${i}"]`).style.transform))
  note('  rows before/after 500px scroll: ' + JSON.stringify([m1, m2]))
  const x = (t) => parseFloat((t.match(/translate3d\((-?[\d.]+)px/) || [0, 0])[1])
  if (!(x(m2[0]) > x(m1[0]) && x(m2[1]) < x(m1[1]))) bad('marquee rows did not move in opposite directions with scroll')
  await page.screenshot({ path: join(OUT, '03-marquee.png') })

  note('[desktop] about — character reveal')
  const about = await page.$('#fp-about')
  await about.scrollIntoViewIfNeeded()
  await page.waitForTimeout(600)
  const chars = await page.evaluate(() => {
    const cs = Array.from(document.querySelectorAll('.fp-about__text .fp-c'))
    const o = cs.map((c) => parseFloat(getComputedStyle(c).opacity))
    return { n: cs.length, first: o[0], mid: o[Math.floor(o.length / 2)], last: o[o.length - 1], deco: document.querySelectorAll('.fp-about__deco [data-fp-fade].is-in').length }
  })
  note('  ' + JSON.stringify(chars))
  if (!chars.n) bad('paragraph was not split into characters')
  await page.screenshot({ path: join(OUT, '04-about-mid.png') })
  // End of the range: the paragraph's bottom at 20% of the viewport.
  await page.evaluate(() => { const r = document.querySelector('.fp-about__text').getBoundingClientRect(); window.scrollTo({ top: scrollY + r.bottom - innerHeight * 0.2, behavior: 'instant' }) })
  await page.waitForTimeout(900)
  const charsEnd = await page.evaluate(() => Array.from(document.querySelectorAll('.fp-about__text .fp-c')).map((c) => parseFloat(getComputedStyle(c).opacity)))
  const litFrac = charsEnd.filter((v) => v > 0.99).length / charsEnd.length
  note(`  characters lit at end of range: ${Math.round(litFrac * 100)}%`)
  if (litFrac < 0.98) bad('character reveal did not complete (' + Math.round(litFrac * 100) + '% lit)')
  await page.screenshot({ path: join(OUT, '05-about-end.png') })

  note('[desktop] services')
  const sv = await page.$('#fp-services')
  await sv.scrollIntoViewIfNeeded()
  await page.waitForTimeout(900)
  const svc = await page.evaluate(() => ({
    items: document.querySelectorAll('.fp-service').length,
    inView: document.querySelectorAll('.fp-service.is-in').length,
    links: Array.from(document.querySelectorAll('.fp-service__name a')).map((a) => a.getAttribute('href')),
  }))
  note('  ' + JSON.stringify(svc))
  if (svc.items !== 8) bad('expected 8 services, got ' + svc.items)
  await page.screenshot({ path: join(OUT, '06-services.png') })
  // every service link must answer 200
  for (const href of svc.links) {
    const res = await ctx.request.get(BASE + href)
    if (res.status() !== 200) bad(`service link ${href} answered ${res.status()}`)
  }

  note('[desktop] projects — stacking')
  const pj = await page.$('#fp-projects')
  await pj.scrollIntoViewIfNeeded()
  await page.waitForTimeout(700)
  await page.screenshot({ path: join(OUT, '07-projects-top.png') })
  const stackTop = await page.evaluate(() => document.querySelector('.fp-stack').getBoundingClientRect().top + scrollY)
  const vh = 900
  const samples = []
  for (const f of [0.15, 0.4, 0.62, 0.85]) {
    await page.evaluate((y) => window.__jump(y), Math.round(stackTop + f * (await page.evaluate(() => document.querySelector('.fp-stack').getBoundingClientRect().height - innerHeight))))
    await page.waitForTimeout(450)
    const s = await page.evaluate(() => Array.from(document.querySelectorAll('.fp-card')).map((c) => ({
      scale: (c.style.transform.match(/scale\(([\d.]+)\)/) || [0, '1'])[1],
      top: Math.round(c.getBoundingClientRect().top),
      h: Math.round(c.getBoundingClientRect().height),
    })))
    samples.push(s)
    await page.screenshot({ path: join(OUT, `08-stack-${Math.round(f * 100)}.png`) })
  }
  note('  card samples: ' + JSON.stringify(samples))
  const lastScales = samples[samples.length - 1].map((c) => parseFloat(c.scale))
  if (!(lastScales[0] < lastScales[1] && lastScales[1] < lastScales[2])) bad('cards did not settle into a scale stack (0 < 1 < 2): ' + lastScales.join(', '))
  const tallest = Math.max(...samples.flat().map((c) => c.h))
  note(`  tallest card ${tallest}px in a ${vh}px viewport`)
  if (tallest > vh - 100) bad(`card too tall for the viewport (${tallest}px)`)
  const vid = await page.evaluate(() => { const v = document.querySelector('video[data-fp-video]'); return v ? { paused: v.paused, t: +v.currentTime.toFixed(1), src: v.currentSrc.split('/').pop(), w: v.videoWidth, h: v.videoHeight } : null })
  note('  card video: ' + JSON.stringify(vid))
  if (!vid || vid.paused) bad('card video not playing while on screen')
  if (vid && vid.h > vid.w) bad(`card video is portrait (${vid.w}x${vid.h}) — rotation metadata mishandled in the encode`)

  await page.evaluate(() => window.__jump(document.body.scrollHeight))
  await page.waitForTimeout(700)
  await page.screenshot({ path: join(OUT, '09-bottom.png') })
  const hov = await page.$('.fp-btn--ghost')
  if (hov) {
    await hov.scrollIntoViewIfNeeded()
    const b = await hov.boundingBox()
    if (b) { await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 5 }); await page.waitForTimeout(350) }
  }
  report()
  await ctx.close()
}

/* ---------------- Mobile ------------------------------------------------- */
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })
  await blockAnalytics(ctx)
  const page = await ctx.newPage()
  const report = watch(page, 'mobile /portfolio/')
  await page.goto(BASE + '/portfolio/', { waitUntil: 'load' })
  await page.evaluate(JUMP)
  await page.waitForTimeout(1200)
  const m = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    h1px: Math.round(parseFloat(getComputedStyle(document.querySelector('.fp-hero__title')).fontSize)),
    h1w: Math.round(document.querySelector('.fp-hero__title').getBoundingClientRect().width),
    portrait: Math.round(document.querySelector('.fp-hero__portrait img').getBoundingClientRect().width),
    heroH: Math.round(document.querySelector('.fp-hero').getBoundingClientRect().height),
  }))
  note('\n[mobile] ' + JSON.stringify(m))
  if (m.overflow > 0) {
    const wide = await page.evaluate(() => Array.from(document.querySelectorAll('main.fp *')).filter((el) => el.getBoundingClientRect().right > innerWidth + 1 && getComputedStyle(el).position !== 'fixed').slice(0, 5).map((el) => el.className.toString().slice(0, 40) + ' right=' + Math.round(el.getBoundingClientRect().right)))
    note('  wide elements: ' + JSON.stringify(wide))
    const ours = wide.filter((w) => /^fp-/.test(w) && !/marquee/.test(w))
    if (ours.length) bad('mobile: our layout overflows: ' + ours.join(' | '))
    else note('  (overflow is the marquee rows / pre-existing widget — expected)')
  }
  await page.screenshot({ path: join(OUT, '20-m-hero.png') })
  for (const [id, name] of [['fp-about', '21-m-about'], ['fp-services', '22-m-services'], ['fp-projects', '23-m-projects']]) {
    await page.evaluate((i) => document.getElementById(i).scrollIntoView({ behavior: 'instant', block: 'start' }), id)
    await page.waitForTimeout(800)
    await page.screenshot({ path: join(OUT, name + '.png') })
  }
  await page.evaluate(() => { const s = document.querySelector('.fp-stack'); window.__jump(s.getBoundingClientRect().top + scrollY + s.getBoundingClientRect().height * 0.55) })
  await page.waitForTimeout(600)
  await page.screenshot({ path: join(OUT, '24-m-stack.png') })
  report()
  await ctx.close()
}

/* ---------------- Reduced motion ---------------------------------------- */
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' })
  await blockAnalytics(ctx)
  const page = await ctx.newPage()
  const report = watch(page, 'reduced /portfolio/')
  await page.goto(BASE + '/portfolio/', { waitUntil: 'load' })
  await page.waitForTimeout(600)
  const r = await page.evaluate(() => ({
    motion: document.documentElement.classList.contains('fp-motion'),
    hidden: Array.from(document.querySelectorAll('[data-fp-fade]')).filter((el) => getComputedStyle(el).opacity === '0').length,
    chars: document.querySelectorAll('.fp-c').length,
    rowsMoved: [1, 2].some((i) => !!document.querySelector(`[data-fp-row="${i}"]`).style.transform),
  }))
  note('\n[reduced] ' + JSON.stringify(r))
  if (r.motion) bad('reduced: fp-motion set')
  if (r.hidden) bad(`reduced: ${r.hidden} element(s) hidden`)
  if (r.chars) bad('reduced: paragraph was split for animation')
  if (r.rowsMoved) bad('reduced: marquee moved')
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
console.log('\nAll portfolio checks passed.')
