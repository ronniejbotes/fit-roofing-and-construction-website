/**
 * Keyboard and focus behaviour of the gate.
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

const where = () => page.evaluate(() => {
  const a = document.activeElement
  if (!a) return 'null'
  const inGate = !!a.closest('#fit-build-gate')
  return `${a.tagName.toLowerCase()}${a.id ? '#' + a.id : ''}${a.className ? '.' + String(a.className).split(' ')[0] : ''} inGate=${inGate}`
})

note('[focus] / — gate up')
await page.goto(BASE + '/', { waitUntil: 'load' })
await page.waitForTimeout(500)
if (!(await page.$('#fit-build-gate'))) bad('gate not present')

const inertCount = await page.evaluate(() => document.querySelectorAll('body > [inert]').length)
note(`  inert body children: ${inertCount}`)
if (!inertCount) bad('nothing was made inert behind the gate')

note('  initial focus: ' + await where())
const seq = []
for (let i = 0; i < 6; i++) {
  await page.keyboard.press('Tab')
  seq.push(await where())
}
note('  after 6× Tab: ' + seq.join(' → '))
if (seq.some((s) => s.includes('inGate=false'))) bad('Tab escaped the gate')

await page.keyboard.press('Shift+Tab')
note('  after Shift+Tab: ' + await where())

// Space on the focused Skip/button must work (scroll keys are blocked elsewhere).
await page.focus('.fit-gate-btn')
await page.keyboard.press('Space')
await page.waitForTimeout(400)
const playing = await page.evaluate(() => document.querySelector('#fit-build-gate')?.getAttribute('data-state'))
note(`  Space on the button → state=${playing}`)
if (playing !== 'playing') bad('Space on the gate button did not start playback')
note('  focus while playing: ' + await where())
const btnTab = await page.evaluate(() => document.querySelector('.fit-gate-btn')?.tabIndex)
if (btnTab !== -1) bad('faded gate button still in the tab order')

await page.keyboard.press('Escape')
await page.waitForTimeout(300)
const after = await page.evaluate(() => ({
  state: document.querySelector('#fit-build-gate')?.getAttribute('data-state') || 'removed',
  locked: document.documentElement.classList.contains('fit-gate-open'),
  inertLeft: document.querySelectorAll('[inert]').length,
  focus: (document.activeElement && document.activeElement.tagName.toLowerCase()) || 'none',
  focusText: (document.activeElement && document.activeElement.textContent || '').trim().slice(0, 40),
  underGate: document.querySelectorAll('[data-fit-under-gate]').length,
}))
note('  after Escape: ' + JSON.stringify(after))
if (after.locked) bad('scroll still locked after Escape')
if (after.inertLeft) bad(`${after.inertLeft} element(s) still inert after Escape`)
if (after.focus !== 'h1') bad('focus was not handed to the headline after the gate')
if (after.underGate) bad('data-fit-under-gate marks left behind')

// Scroll must work now.
await page.mouse.move(700, 450)
await page.mouse.wheel(0, 600)
await page.waitForTimeout(300)
const y = await page.evaluate(() => window.scrollY)
note(`  wheel after gate → scrollY=${y}`)
if (y === 0) bad('page does not scroll after the gate closed (blockers left attached?)')

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
