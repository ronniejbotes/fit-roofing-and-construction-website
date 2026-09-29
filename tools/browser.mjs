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
 *
 * The first version of this list missed https://www.google.com/g/collect,
 * which is where this site's GA4 hits actually go. Every run that called
 * blockAnalytics() therefore still sent its page views, and on 17 September
 * 2026 the form tests' form_start, form_submit and generate_lead events, into
 * both GA4 properties (G-TQN34BCYN7 in the HTML, G-WQQB7G3QBE injected by the
 * GTM container). Google moves collection between google-analytics.com,
 * analytics.google.com, region1.* hosts and www.google.com, so the patterns
 * key on the collection path on any Google host, not on a list of hosts.
 */
const GOOGLE = String.raw`([a-z0-9-]+\.)*(google-analytics\.com|googleadservices\.com|doubleclick\.net|google(\.com?)?(\.[a-z]{2})?)`
const BEACONS = [
  // GA4 /g/collect; Universal Analytics /collect, /j/collect and /r/collect;
  // the Measurement Protocol's /mp/collect. On any Google host.
  new RegExp(String.raw`^https?:\/\/${GOOGLE}\/((g|j|r|mp)\/)?collect([/?#]|$)`),
  // Ads, remarketing and conversion pings that GA4 and GTM send alongside.
  new RegExp(String.raw`^https?:\/\/${GOOGLE}\/(pagead|ccm|rmkt|measurement|ads\/ga-audiences)([/?#]|$)`),
  /^https?:\/\/([a-z0-9-]+\.)*doubleclick\.net\//,
  // Tag Manager's own pings. gtm.js and gtag/js are scripts, not hits: they load.
  /^https?:\/\/www\.googletagmanager\.com\/(td|a)\?/,
  /^https?:\/\/(www\.)?facebook\.com\/tr/,
  /^https?:\/\/([a-z0-9-]+\.)*clarity\.ms\/collect/,
]

/** True for a URL whose request would record a hit in someone's analytics. */
export function isBeacon(href) {
  return BEACONS.some((re) => re.test(href))
}

export async function blockAnalytics(ctx) {
  await ctx.route((url) => isBeacon(url.href), (route) => route.abort())
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
