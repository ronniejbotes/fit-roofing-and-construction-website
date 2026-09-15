/**
 * Apply the corrections in tools/fixes.mjs to the captured HTML.
 *
 * Run after every capture — `npm run mirror` writes the live site's markup
 * verbatim, broken links included, so without this step a rebuild silently
 * undoes every fix.
 *
 * Idempotent: running it twice is a no-op, because a fix that is already applied
 * matches nothing. That is also why it checks counts. A fix whose `expect` no
 * longer matches means the live site changed under it, so it stops instead of
 * applying a stale correction to a page that may no longer need it.
 *
 *   node tools/apply-fixes.mjs
 *   node tools/apply-fixes.mjs --dry     # report what would change
 */
import { readFile, writeFile, readdir } from 'node:fs/promises'
import { join, resolve, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FIXES } from './fixes.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DIR = join(ROOT, process.env.MIRROR_DIR || '.')
const DRY = process.argv.includes('--dry')

// _raw is the untouched capture and is deliberately never fixed: it is the
// reference that makes "what did we change?" answerable.
const SKIP_DIRS = new Set(['.git', 'node_modules', '_raw', 'tools', 'shots', '.probe'])

async function walk(dir, out = []) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue
    const p = join(dir, e.name)
    if (e.isDirectory()) await walk(p, out)
    else if (e.name.endsWith('.html')) out.push(p)
  }
  return out
}

const files = await walk(DIR)
console.log(`Applying ${FIXES.length} fix(es) across ${files.length} HTML files${DRY ? ' (dry run)' : ''}\n`)

const edits = new Map()      // file -> new content
const perFix = new Map()     // fix id -> [files]
let alreadyApplied = 0

for (const f of files) {
  let html = edits.get(f) ?? await readFile(f, 'utf8')
  let touched = false
  for (const fix of FIXES) {
    if (!html.includes(fix.from)) continue
    html = html.split(fix.from).join(fix.to)
    touched = true
    if (!perFix.has(fix.id)) perFix.set(fix.id, [])
    perFix.get(fix.id).push('/' + relative(DIR, f).split('\\').join('/'))
  }
  if (touched) edits.set(f, html)
}

let failed = false
for (const fix of FIXES) {
  const hit = perFix.get(fix.id) || []

  // The meaningful check is that the broken form is gone — not that the correct
  // form is present. Both of these fixes point at a URL the header nav already
  // links on every page, so "does the page contain the target?" is true on all
  // 183 files whether the fix ran or not, and would mask a fix that silently
  // stopped matching.
  let remaining = 0
  for (const f of files) {
    const html = edits.get(f) ?? await readFile(f, 'utf8')
    if (html.includes(fix.from)) remaining++
  }

  const changedAsExpected = hit.length === fix.expect
  const wasAlreadyApplied = hit.length === 0 && remaining === 0
  const ok = remaining === 0 && (changedAsExpected || wasAlreadyApplied)
  if (wasAlreadyApplied) alreadyApplied++

  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${fix.id}`)
  console.log(`        ${fix.from}  ->  ${fix.to}`)
  console.log(`        changed ${hit.length} file(s), expected ${fix.expect}` +
    `${wasAlreadyApplied ? ' (already applied)' : ''}; ${remaining} still broken`)
  if (!ok) {
    failed = true
    console.log(hit.length && !changedAsExpected
      ? `        Count moved: the live site changed under this fix. Re-read it before trusting it.`
      : `        ${remaining} file(s) still carry the broken link.`)
  }
}

if (!DRY && !failed) {
  for (const [f, html] of edits) await writeFile(f, html)
}

console.log(`\n--- ${DRY ? 'dry run' : failed ? 'aborted, nothing written' : 'fixes applied'} ---`)
console.log(`files rewritten: ${DRY || failed ? 0 : edits.size}`)
if (alreadyApplied) console.log(`fixes already in place: ${alreadyApplied}`)
process.exit(failed ? 1 : 0)
