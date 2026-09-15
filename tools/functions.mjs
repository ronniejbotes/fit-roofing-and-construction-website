/**
 * Does the copy still *do* what the original does?
 *
 * The pixel diff in compare.mjs proves the two sites look alike standing still.
 * It cannot tell you whether the dropdown opens, the carousel advances or the
 * mobile menu exists, because all of that is JavaScript — and JavaScript is
 * exactly what a static mirror is most likely to have dropped: one script that
 * failed to download and every interactive widget on the site goes quiet while
 * the page still screenshots perfectly.
 *
 * So this drives the real controls, on both sites, and reports any behaviour
 * that differs.
 *
 *   node tools/functions.mjs                # a representative set of routes
 *   node tools/functions.mjs / /shop/       # specific routes
 */
import { chromium } from 'playwright-core'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ORIGIN, UA } from './site.mjs'
import { blockAnalytics } from './browser.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const argVal = (f) => { const i = args.indexOf(f); return i === -1 ? null : args[i + 1] }
const LOCAL = argVal('--local') || 'http://localhost:4400'
const EXEC = process.env.CHROME || join(process.env.USERPROFILE || process.env.HOME || '',
  'AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe')

// One of each kind of page, rather than every route: the templates are shared, so a
// second blog post exercises nothing the first did not.
const DEFAULT_ROUTES = [
  '/', '/home-2/', '/about/', '/contact/', '/portfolio/', '/blog/', '/blog/page/2/',
  '/roofing-services-texas/', '/roof-repair-texas/', '/roofing-locations/', '/dallas/',
  '/hail-damage-roof-texas/', '/tag/maintenance/',
]
const routes = args.filter((a) => !a.startsWith('--') && a !== LOCAL)
const list = routes.length ? routes : DEFAULT_ROUTES

const browser = await chromium.launch({ executablePath: EXEC })

/**
 * Load a page, wait for the frameworks to come up, then probe the things that
 * only work if the JavaScript actually loaded and ran.
 */
async function probe(base, route) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, userAgent: UA })
  await blockAnalytics(ctx)
  const page = await ctx.newPage()
  const out = { errors: [] }
  page.on('pageerror', (e) => out.errors.push(String(e.message).slice(0, 120)))
  try {
    await page.goto(base + route, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.evaluate(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
      for (let y = 0; y < document.body.scrollHeight; y += 600) { window.scrollTo(0, y); await sleep(50) }
      window.scrollTo(0, 0); await sleep(200)
    }).catch(() => {})
    await page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {})
    await page.waitForTimeout(1500)

    Object.assign(out, await page.evaluate(() => {
      const q = (s) => document.querySelectorAll(s)
      const r = {}

      // The runtimes. If elementorFrontend is missing, every Elementor widget
      // on the page is inert no matter how correct the markup looks.
      r.elementorFrontend = typeof window.elementorFrontend === 'object'
      r.elementorInit = !!(window.elementorFrontend && window.elementorFrontend.isEditMode !== undefined)
      r.jQuery = typeof window.jQuery === 'function'
      r.swiperLoaded = typeof window.Swiper === 'function' ||
        !!document.querySelector('.swiper-initialized, .swiper-wrapper')

      // Elementor reveals animated widgets by removing .elementor-invisible once
      // its observer runs. Any left after a full scroll means content that is
      // present in the DOM but permanently invisible to a visitor — the exact
      // failure a screenshot of the top of the page would not catch.
      r.stillInvisible = q('.elementor-invisible').length

      // Widget inventory: what should be interactive on this page.
      r.navMenus = q('.elementor-nav-menu').length
      r.dropdownParents = q('.elementor-nav-menu li.menu-item-has-children').length
      r.mobileToggle = q('.elementor-menu-toggle').length
      r.accordions = q('.elementor-accordion, .e-n-accordion, .elementor-toggle').length
      r.tabs = q('.elementor-tabs, .e-n-tabs').length
      r.carousels = q('.swiper, .elementor-main-swiper').length
      r.forms = q('form.elementor-form').length
      r.addToCart = q('.single_add_to_cart_button, .add_to_cart_button').length
      r.lightboxLinks = q('[data-elementor-open-lightbox="yes"]').length
      r.videos = q('video').length
      r.lazyLeftover = q('[data-lazy-src]:not([src]), [data-src]:not([src])').length
      return r
    }))

    // Drive the controls that a visitor actually clicks.

    // 1. Nav dropdown: hover a parent item and see whether its submenu opens.
    out.dropdownOpens = await page.evaluate(async () => {
      const parent = document.querySelector('.elementor-nav-menu li.menu-item-has-children')
      if (!parent) return null
      const sub = parent.querySelector('ul.sub-menu')
      if (!sub) return null
      const before = getComputedStyle(sub).opacity
      parent.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }))
      parent.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
      await new Promise((r) => setTimeout(r, 700))
      const after = getComputedStyle(sub).opacity
      return { before, after, changed: before !== after }
    }).catch(() => null)

    // 2. Mobile menu toggle: switch to a phone viewport and click it.
    const toggle = page.locator('.elementor-menu-toggle').first()
    if (await toggle.count()) {
      await page.setViewportSize({ width: 390, height: 844 })
      await page.waitForTimeout(400)
      try {
        await toggle.click({ timeout: 5000 })
        await page.waitForTimeout(700)
        out.mobileMenuOpens = await page.evaluate(() => {
          const d = document.querySelector('.elementor-nav-menu--dropdown')
          if (!d) return false
          const s = getComputedStyle(d)
          return s.display !== 'none' && s.visibility !== 'hidden' && d.getBoundingClientRect().height > 20
        })
      } catch { out.mobileMenuOpens = 'click failed' }
      await page.setViewportSize({ width: 1440, height: 900 })
    } else out.mobileMenuOpens = null

    // 3. Accordion: click the first header and see whether a panel expands.
    out.accordionOpens = await page.evaluate(async () => {
      const h = document.querySelector(
        '.elementor-accordion .elementor-tab-title, .e-n-accordion summary, .elementor-toggle .elementor-tab-title')
      if (!h) return null
      const heightBefore = document.body.scrollHeight
      h.click()
      await new Promise((r) => setTimeout(r, 800))
      const open = !!document.querySelector(
        '.elementor-tab-title.elementor-active, .e-n-accordion details[open]')
      return { open, grew: document.body.scrollHeight > heightBefore }
    }).catch(() => null)

    // 4. Carousel: click next and see whether the active slide index moves.
    out.carouselAdvances = await page.evaluate(async () => {
      const el = document.querySelector('.swiper')
      if (!el) return null
      const idx = () => [...el.querySelectorAll('.swiper-slide')]
        .findIndex((s) => s.classList.contains('swiper-slide-active'))
      const before = idx()
      const next = el.querySelector('.elementor-swiper-button-next, .swiper-button-next')
      if (!next) return { before, note: 'no next button' }
      next.click()
      await new Promise((r) => setTimeout(r, 900))
      return { before, after: idx(), moved: idx() !== before }
    }).catch(() => null)
  } catch (e) {
    out.fatal = e.message.split('\n')[0]
  }
  await page.close()
  await ctx.close()
  return out
}

const KEYS_NUMERIC = ['stillInvisible', 'navMenus', 'dropdownParents', 'mobileToggle',
  'accordions', 'tabs', 'carousels', 'forms', 'addToCart', 'lightboxLinks', 'videos',
  'lazyLeftover']
const KEYS_BOOL = ['elementorFrontend', 'elementorInit', 'jQuery', 'swiperLoaded']

console.log(`Functional comparison of ${list.length} route(s)\n  live:  ${ORIGIN}\n  local: ${LOCAL}\n`)

const problems = []
for (const route of list) {
  const [live, mine] = await Promise.all([probe(ORIGIN, route), probe(LOCAL, route)])
  const diffs = []
  for (const k of KEYS_BOOL) if (live[k] !== mine[k]) diffs.push(`${k}: live=${live[k]} mine=${mine[k]}`)
  for (const k of KEYS_NUMERIC) if (live[k] !== mine[k]) diffs.push(`${k}: live=${live[k]} mine=${mine[k]}`)
  for (const k of ['dropdownOpens', 'mobileMenuOpens', 'accordionOpens', 'carouselAdvances']) {
    const a = JSON.stringify(live[k]), b = JSON.stringify(mine[k])
    if (a !== b) diffs.push(`${k}: live=${a} mine=${b}`)
  }
  if (mine.fatal) diffs.push(`fatal on copy: ${mine.fatal}`)

  const ok = diffs.length === 0
  console.log(`${ok ? ' ' : '!'} ${route}` +
    `  elementor=${mine.elementorFrontend ? 'yes' : 'NO'}` +
    `  jQuery=${mine.jQuery ? 'yes' : 'NO'}` +
    `  menus=${mine.navMenus} dropdowns=${mine.dropdownParents} carousels=${mine.carousels}` +
    ` accordions=${mine.accordions} forms=${mine.forms}` +
    (mine.stillInvisible ? `  INVISIBLE=${mine.stillInvisible}` : '') +
    (mine.lazyLeftover ? `  LAZY-LEFTOVER=${mine.lazyLeftover}` : ''))
  for (const d of diffs) console.log(`     ${d}`)
  if (!ok) problems.push([route, diffs])
}

await browser.close()
console.log(`\n--- functional comparison complete ---`)
console.log(`routes: ${list.length}   matching: ${list.length - problems.length}   differing: ${problems.length}`)
