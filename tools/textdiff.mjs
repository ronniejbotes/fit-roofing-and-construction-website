/**
 * Line-by-line diff of the visible text of one page, live against the copy.
 *
 * compare.mjs reports *that* a page's wording differs and by how many words.
 * When that happens this says which lines, which is what you need to tell a
 * genuinely missing section apart from a carousel that happened to be on a
 * different slide when each screenshot was taken.
 *
 * Run it twice before believing it. Several pages reported missing content on
 * one pass of compare.mjs and matched exactly on the next: the site rotates
 * slides and reveals sections on scroll, so a single sample is not evidence.
 *
 *   node tools/textdiff.mjs /dallas/
 */
import { chromium } from 'playwright-core'
import { join } from 'node:path'
import { blockAnalytics } from './browser.mjs'

const EXEC = join(process.env.USERPROFILE, 'AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe')
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const route = process.argv[2] || '/'

const browser = await chromium.launch({ executablePath: EXEC })

async function look(base) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, userAgent: UA })
  await blockAnalytics(ctx)
  const page = await ctx.newPage()
  await page.goto(base + route, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.evaluate(async () => {
    const s = (ms) => new Promise((r) => setTimeout(r, ms))
    for (let y = 0; y < document.body.scrollHeight; y += 600) { window.scrollTo(0, y); await s(60) }
    window.scrollTo(0, 0); await s(300)
  })
  await page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {})
  await page.waitForTimeout(3000)
  const lines = await page.evaluate(() =>
    (document.body.innerText || '').split('\n').map((l) => l.trim()).filter(Boolean))
  await page.close(); await ctx.close()
  return lines
}

const live = await look('https://fitroofingco.com')
const mine = await look('http://localhost:4400')
await browser.close()

const setMine = new Map()
for (const l of mine) setMine.set(l, (setMine.get(l) || 0) + 1)
const setLive = new Map()
for (const l of live) setLive.set(l, (setLive.get(l) || 0) + 1)

console.log('route:', route)
console.log(`live lines: ${live.length}   mine lines: ${mine.length}\n`)
console.log('LINES ON LIVE BUT NOT ON THE COPY:')
for (const [l, n] of setLive) {
  const d = n - (setMine.get(l) || 0)
  if (d > 0) console.log(`  -${d}  ${JSON.stringify(l.slice(0, 150))}`)
}
console.log('\nLINES ON THE COPY BUT NOT ON LIVE:')
for (const [l, n] of setMine) {
  const d = n - (setLive.get(l) || 0)
  if (d > 0) console.log(`  +${d}  ${JSON.stringify(l.slice(0, 150))}`)
}
