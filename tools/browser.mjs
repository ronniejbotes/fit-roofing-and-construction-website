/**
 * Browser plumbing shared by every tool that opens pages in Chromium.
 */
import { join } from 'node:path'

export const CHROME = process.env.CHROME || join(process.env.USERPROFILE || process.env.HOME || '',
  'AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe')

/**
 * Measurement beacons, aborted in every context these tools open.
 *
 * Every comparison is a real page view: the live site and the copy both load
 * Google Tag Manager with the client's GA4 property, and the tools use an
 * ordinary Chrome user agent that Analytics has no reason to filter. The first
 * full round of checks on this mirror (15 September 2026) ran without this and
 * put several hundred automated page views into the client's analytics, from
 * both fitroofingco.com and localhost.
 *
 * Only the beacons are blocked. The tag scripts themselves still load and run,
 * so anything GTM does to a page still happens on both sides and is still
 * compared; what is lost is only the hit being recorded.
 */
const BEACONS = [
  /^https:\/\/([a-z0-9-]+\.)*google-analytics\.com\/(g\/)?collect/,
  /^https:\/\/analytics\.google\.com\/g\/collect/,
  /^https:\/\/stats\.g\.doubleclick\.net\//,
  /^https:\/\/googleads\.g\.doubleclick\.net\//,
  /^https:\/\/www\.google\.com\/(pagead|ccm)\//,
  /^https:\/\/www\.googletagmanager\.com\/(td|a)\?/,
  /^https:\/\/(www\.)?facebook\.com\/tr/,
  /^https:\/\/([a-z0-9-]+\.)*clarity\.ms\/collect/,
]

export async function blockAnalytics(ctx) {
  await ctx.route((url) => BEACONS.some((re) => re.test(url.href)), (route) => route.abort())
}

/**
 * Convince the page the pointer is a mouse.
 *
 * Elementor's nav menu is SmartMenus, which treats the pointer as touch until it
 * has seen two consecutive mousemove events within 4px of each other inside
 * 300ms. Until then it ignores hover entirely. A Playwright hover() is a single
 * jump, so the menu never opens for automation — on live or on the copy — and a
 * first dropdown check compared two closed menus on all 45 pages and called it a
 * match.
 */
export async function realPointer(page, x = 300, y = 300) {
  await page.mouse.move(x, y)
  for (let i = 1; i <= 4; i++) {
    await page.mouse.move(x + i, y + i)
    await page.waitForTimeout(20)
  }
}

/** Move onto an element in steps, as a hand does, and settle with a tiny wiggle. */
export async function hoverLikeAPerson(page, box) {
  const vp = page.viewportSize() || { width: 1440, height: 900 }
  const x = Math.round(Math.min(vp.width - 2, Math.max(1, box.x + box.width / 2)))
  const top = Math.max(box.y, 0)
  const bottom = Math.min(box.y + box.height, vp.height)
  const y = Math.round(Math.min(vp.height - 2, Math.max(1, (top + bottom) / 2)))
  await page.mouse.move(x, y, { steps: 12 })
  for (let i = 0; i < 3; i++) {
    await page.mouse.move(x + (i % 2), y + ((i + 1) % 2))
    await page.waitForTimeout(40)
  }
}
