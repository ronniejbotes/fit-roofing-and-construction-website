/**
 * Load every page in a real browser and record every same-origin request that
 * fails.
 *
 * This exists because of a bug the other checks could not see. Trustindex's
 * review widget names its stylesheet in a custom attribute —
 * `data-css-url="/wp-content/uploads/trustindex-amazon-widget.css"` — which its
 * loader script reads and injects at runtime. No static extractor knows that
 * attribute carries a URL, so verify.mjs called the page complete, fetch-assets
 * never downloaded the file, and the widget rendered unstyled: avatars at full
 * size, the card grid collapsed, several thousand pixels of broken layout on the
 * homepage.
 *
 * A browser does not need to be told which attributes hold URLs. It just asks
 * for things. So the reliable way to find assets a static pass cannot see is to
 * run the page and watch what 404s.
 *
 * Needs `npm run serve`.
 *
 *   node tools/runtime-audit.mjs                 # every route
 *   node tools/runtime-audit.mjs / /shop/        # specific routes
 *   node tools/runtime-audit.mjs --fetch         # also download what is missing
 */
import { chromium } from 'playwright-core'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, resolve, dirname, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ORIGIN, UA, rewrite, pathToFile } from './site.mjs'
import { blockAnalytics } from './browser.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const argVal = (f) => { const i = args.indexOf(f); return i === -1 ? null : args[i + 1] }
const LOCAL = argVal('--local') || 'http://localhost:4400'
const FETCH = args.includes('--fetch')
const TABS = Number(process.env.TABS || 4)
const EXEC = process.env.CHROME || join(process.env.USERPROFILE || process.env.HOME || '',
  'AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe')

const cli = args.filter((a) => !a.startsWith('--') && a !== LOCAL)
const routes = cli.length ? cli
  : (await readFile(join(ROOT, 'routes.txt'), 'utf8')).split('\n')
      .map((s) => s.trim()).filter((s) => s && !s.startsWith('#') && !s.endsWith('.xml'))

// Cloudflare injects these into the HTML at the edge; they are not site files
// and 404 off the copy by definition.
const IGNORE = [/^\/cdn-cgi\//]

const missing = new Map()    // path -> Set(routes)
const consoleErrors = new Map()

const browser = await chromium.launch({ executablePath: EXEC })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, userAgent: UA })
// Every page view here would otherwise be counted in the client's analytics.
await blockAnalytics(ctx)

async function visit(route) {
  const page = await ctx.newPage()
  page.on('response', (r) => {
    const u = r.url()
    if (!u.startsWith(LOCAL)) return          // third-party CDNs are not ours
    if (r.status() < 400) return
    const p = u.slice(LOCAL.length).split('#')[0]
    if (IGNORE.some((re) => re.test(p))) return
    if (!missing.has(p)) missing.set(p, new Set())
    missing.get(p).add(route)
  })
  page.on('requestfailed', (r) => {
    const u = r.url()
    if (!u.startsWith(LOCAL)) return
    const err = r.failure()?.errorText || ''
    // A media element aborting its own range request is normal browser
    // behaviour, not a missing file.
    if (err.includes('ERR_ABORTED')) return
    const p = `${err}  ${u.slice(LOCAL.length)}`
    if (!missing.has(p)) missing.set(p, new Set())
    missing.get(p).add(route)
  })
  page.on('pageerror', (e) => {
    const k = String(e.message).split('\n')[0].slice(0, 140)
    if (!consoleErrors.has(k)) consoleErrors.set(k, new Set())
    consoleErrors.get(k).add(route)
  })

  try {
    await page.goto(LOCAL + route, { waitUntil: 'load', timeout: 60000 })

    // Real pointer input, before anything else. WP Rocket holds delayed scripts
    // until a genuine user-input event; window.scrollTo() from a script is not
    // one. The first version of this tool scrolled only from script, so the one
    // delayed script on this site never ran, its stylesheet was never requested,
    // and the audit reported a clean pass on the very page whose reviews widget
    // was visibly broken. Without these four wheel ticks this tool is decorative.
    await page.mouse.move(200, 300, { steps: 6 }).catch(() => {})
    for (let i = 0; i < 4; i++) {
      await page.mouse.wheel(0, 500).catch(() => {})
      await page.waitForTimeout(150)
    }
    await page.mouse.move(700, 500, { steps: 6 }).catch(() => {})
    await page.waitForTimeout(800)

    // Then scroll the whole page: widgets that only initialise when they come
    // into view request their assets then.
    await page.evaluate(async () => {
      const s = (ms) => new Promise((r) => setTimeout(r, ms))
      const step = Math.max(200, Math.round(window.innerHeight * 0.6))
      let y = 0
      for (let i = 0; i < 400; i++) {
        if (y >= document.body.scrollHeight) break
        window.scrollTo(0, y); await s(80); y += step
      }
      window.scrollTo(0, 0); await s(200)
    }).catch(() => {})
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {})
    await page.waitForTimeout(2000)
  } catch { /* recorded by the listeners above */ }
  await page.close().catch(() => {})
}

console.log(`Runtime audit of ${routes.length} route(s) against ${LOCAL}\n`)
let i = 0
let done = 0
await Promise.all(Array.from({ length: TABS }, async () => {
  while (i < routes.length) {
    await visit(routes[i++])
    if (++done % 20 === 0) console.log(`  …${done}/${routes.length}`)
  }
}))
await browser.close()

const list = [...missing.entries()].sort((a, b) => b[1].size - a[1].size)
console.log(`\n=== Same-origin requests that fail on the copy: ${list.length} ===`)
for (const [p, on] of list) {
  console.log(`  ${String(on.size).padStart(4)} page(s)  ${p}`)
  if (on.size <= 3) for (const r of on) console.log(`               e.g. ${r}`)
}

const errs = [...consoleErrors.entries()].sort((a, b) => b[1].size - a[1].size)
console.log(`\n=== Distinct JavaScript errors: ${errs.length} ===`)
for (const [e, on] of errs.slice(0, 15)) console.log(`  ${String(on.size).padStart(4)} page(s)  ${e}`)

if (FETCH && list.length) {
  console.log('\nFetching the missing files from the live site…')
  let ok = 0, fail = 0
  for (const [p] of list) {
    const clean = p.split('  ').pop()               // strip any error prefix
    if (!extname(clean.split('?')[0])) { continue }
    const file = pathToFile(ROOT, clean)
    if (existsSync(file)) continue
    try {
      const res = await fetch(ORIGIN + clean, { headers: { 'User-Agent': UA }, redirect: 'follow' })
      if (!res.ok) { console.log(`  ${res.status}  ${clean}`); fail++; continue }
      const buf = Buffer.from(await res.arrayBuffer())
      await mkdir(dirname(file), { recursive: true })
      const ext = extname(clean.split('?')[0])
      await writeFile(file, ext === '.css' || ext === '.js' || ext === '.svg'
        ? rewrite(buf.toString('utf8'), false) : buf)
      console.log(`  ok   ${clean}  (${buf.length} bytes)`)
      ok++
    } catch (e) { console.log(`  ERR  ${clean} — ${e.message}`); fail++ }
  }
  console.log(`\nfetched ${ok}, failed ${fail}`)
}

console.log(`\n${list.length === 0 ? 'PASS — nothing on the copy 404s at runtime.' : `${list.length} missing resource(s).`}`)
process.exit(list.length ? 1 : 0)
