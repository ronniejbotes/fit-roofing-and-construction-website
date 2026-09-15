/**
 * Backfill every asset the mirror references but does not contain.
 *
 * The browser capture only saves what the browser actually asked for, and a
 * browser at one viewport asks for a fraction of what the markup names: it
 * picks one candidate out of each srcset and ignores the rest, never requests
 * an image a carousel would have shown on slide 7, and loads only the font
 * weights the first paint needed. All of those are still referenced by the HTML
 * and CSS shipped here, so without this pass they are dead links on the copy
 * that resolve fine on the original.
 *
 * Scans every HTML and CSS file for same-origin references, downloads whatever
 * is absent, and repeats — because a stylesheet pulled in on this pass can name
 * fonts and images of its own.
 *
 *   node tools/fetch-assets.mjs
 *   node tools/fetch-assets.mjs --dry     # list what is missing, download nothing
 */
import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, resolve, dirname, extname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ORIGIN, UA, rewrite, pathToFile, assetsFromHtml, assetsFromCss, toLocalPath } from './site.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DIR = join(ROOT, process.env.MIRROR_DIR || '.')
const DRY = process.argv.includes('--dry')
const CONCURRENCY = Number(process.env.CONCURRENCY || 8)

const SKIP_DIRS = new Set(['.git', 'node_modules', '_raw', 'tools', '.probe', 'shots'])
const SKIP_REFS = [
  /^\/wp-admin/, /^\/wp-login/, /^\/wp-json/, /^\/xmlrpc/, /\.php(\?|$)/, /^\/cdn-cgi\//,
]

async function walk(dir, out = []) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue
    const p = join(dir, e.name)
    if (e.isDirectory()) await walk(p, out)
    else out.push(p)
  }
  return out
}

const stats = { fetched: 0, failed: [], scanned: 0 }
const tried = new Set()

async function fetchOne(urlPath) {
  const file = pathToFile(DIR, urlPath)
  if (existsSync(file)) return false
  if (DRY) { console.log(`   would fetch  ${urlPath}`); return false }
  try {
    const res = await fetch(ORIGIN + urlPath, { headers: { 'User-Agent': UA }, redirect: 'follow' })
    if (!res.ok) { stats.failed.push(`${res.status}  ${urlPath}`); return false }
    const buf = Buffer.from(await res.arrayBuffer())
    await mkdir(dirname(file), { recursive: true })
    const ext = extname(urlPath.split('?')[0])
    if (ext === '.css' || ext === '.js' || ext === '.svg') {
      await writeFile(file, rewrite(buf.toString('utf8'), false))
    } else {
      await writeFile(file, buf)
    }
    stats.fetched++
    return true
  } catch (e) {
    stats.failed.push(`${urlPath} — ${e.message}`)
    return false
  }
}

for (let pass = 1; pass <= 4; pass++) {
  const files = await walk(DIR)
  const wanted = new Set()
  for (const f of files) {
    const ext = extname(f)
    if (ext !== '.html' && ext !== '.css' && ext !== '.xml') continue
    const rel = '/' + relative(DIR, f).split('\\').join('/')
    const text = await readFile(f, 'utf8')
    // Sitemaps name their display stylesheet in an <?xml-stylesheet?> processing
    // instruction, which is not an element and so is invisible to the HTML
    // extractor. Yoast's main-sitemap.xsl is referenced by all five sitemaps and
    // by nothing else on the site, so without this it is the one file a rebuild
    // silently drops.
    const refs = ext === '.css' ? assetsFromCss(text, rel)
      : ext === '.xml' ? [...text.matchAll(/<\?xml-stylesheet[^?]*href=["']([^"']+)["']/gi)]
          .map((m) => toLocalPath(m[1])).filter(Boolean)
      : assetsFromHtml(text)
    for (const r of refs) {
      const bare = r.split('#')[0]
      // Only real files. Extension-less paths are routes, captured as pages.
      if (!extname(bare.split('?')[0])) continue
      if (SKIP_REFS.some((re) => re.test(bare))) continue
      if (tried.has(bare)) continue
      if (existsSync(pathToFile(DIR, bare))) continue
      wanted.add(bare)
    }
  }
  stats.scanned = files.length
  if (!wanted.size) { console.log(`Pass ${pass}: nothing missing.`); break }

  console.log(`Pass ${pass}: ${wanted.size} referenced file(s) not present — fetching…`)
  const list = [...wanted]
  for (const w of list) tried.add(w)
  let i = 0
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (i < list.length) await fetchOne(list[i++])
  }))
  if (DRY) break
}

console.log('\n--- asset backfill complete ---')
console.log(`fetched: ${stats.fetched}`)
console.log(`failed:  ${stats.failed.length}`)
for (const f of stats.failed.slice(0, 40)) console.log(`  ! ${f}`)
if (stats.failed.length > 40) console.log(`  …and ${stats.failed.length - 40} more`)
