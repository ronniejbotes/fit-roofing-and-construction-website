/**
 * Keyboard and focus behaviour of the homepage on arrival. (Until 18 October
 * 2026 this checked the intro gate's focus trap; the gate has been removed.)
 * Needs `npm run serve` on :4400.
 *
 *   npm run motion:qa:keys
 */
import { chromium } from 'playwright-core'
import { CHROME, blockAnalytics } from './browser.mjs'

const BASE = process.env.LOCAL || 'http://localhost:4400'
const problems = []
const note = (s) => console.log(s)
const bad = (s) => { problems.push(s); console.log('  !! ' + s) }

const browser = await chromium.launch({ executablePath: CHROME, headless: true })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
await blockAnalytics(ctx)
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(String(e.message || e)))

note('[focus] / — opens on the page (the intro gate was removed 18 October 2026)')
await page.goto(BASE + '/', { waitUntil: 'load' })
await page.waitForTimeout(500)
const start = await page.evaluate(() => ({
  gate: !!document.querySelector('#fit-build-gate'),
  locked: document.documentElement.classList.contains('fit-gate-open'),
  inert: document.querySelectorAll('[inert]').length,
}))
note('  ' + JSON.stringify(start))
if (start.gate || start.locked) bad('intro gate is back on /')
if (start.inert) bad(`${start.inert} element(s) inert on arrival`)

// First Tab must reach the page itself (skip link or header), not a dialog.
await page.keyboard.press('Tab')
const first = await page.evaluate(() => {
  const a = document.activeElement
  return a ? `${a.tagName.toLowerCase()}${a.className ? '.' + String(a.className).split(' ')[0] : ''}` : 'none'
})
note('  first Tab → ' + first)
if (first === 'body' || first === 'none') bad('first Tab did not reach anything on the page')

// Scroll must work at once.
await page.mouse.move(700, 450)
await page.mouse.wheel(0, 600)
await page.waitForTimeout(300)
const y = await page.evaluate(() => window.scrollY)
note(`  wheel on arrival → scrollY=${y}`)
if (y === 0) bad('page does not scroll on arrival')

// Tab from the top must not land on an invisible reveal target.
await page.evaluate(() => window.scrollTo(0, 0))
await page.waitForTimeout(200)
let invisibleFocus = 0
for (let i = 0; i < 25; i++) {
  await page.keyboard.press('Tab')
  await page.waitForTimeout(40)
  const hidden = await page.evaluate(() => {
    const a = document.activeElement
    if (!a) return false
    const t = a.closest('[data-fit-reveal]')
    return !!t && getComputedStyle(t).opacity === '0'
  })
  if (hidden) invisibleFocus++
}
note(`  Tab ×25 from top: ${invisibleFocus} landing(s) on an invisible reveal target`)
if (invisibleFocus) bad('focus landed on a hidden reveal target')

if (errors.length) bad('page errors: ' + errors.join(' | '))
await browser.close()

if (problems.length) {
  console.log(`\n${problems.length} problem(s):`)
  problems.forEach((p) => console.log(' - ' + p))
  process.exit(1)
}
console.log('\nAll focus checks passed.')
