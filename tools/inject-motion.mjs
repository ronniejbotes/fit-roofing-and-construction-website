/**
 * Wire the motion layer into every page — or take it back out.
 *
 *   node tools/inject-motion.mjs           # add the tags to every page
 *   node tools/inject-motion.mjs --dry     # report only
 *   node tools/inject-motion.mjs --remove  # strip them again (mirror restored)
 *
 * Every page gets, in <head>, a two-line inline guard (it reads the
 * sessionStorage flag the previous page wrote and puts html.fit-arriving on
 * before the body paints — that is what makes the roofline curtain seamless)
 * and assets/fit-motion.css; and before </body>, assets/fit-motion.js. The
 * landing page (index.html at the root) also gets assets/fit-home.{css,js}:
 * the gate, the owner glow and the scroll cue.
 *
 * Idempotent: a page already carrying the tags is left alone, so it is safe
 * to re-run after a fresh mirror capture. Every tag carries data-fit-motion,
 * which is what --remove keys on.
 *
 * The mirror's other checks (`parity`, `compare`, `scroll`) compare against
 * the live site and will now report these pages as different — that is the
 * point. `--remove` puts every page back byte for byte so those checks can
 * still be used to re-verify a capture.
 */
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SKIP_DIRS = new Set(['node_modules', '_raw', 'shots', '.git', 'tools', 'assets', '_forms', 'wp-content', 'wp-includes'])

const DRY = process.argv.includes('--dry')
const REMOVE = process.argv.includes('--remove')

const MARK = 'data-fit-motion'
const GUARD =
  `<script ${MARK}>(function(){try{var s=sessionStorage,k='fit-nav',v=s.getItem(k);s.removeItem(k);` +
  `if(v==='1'&&!(matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches))` +
  `document.documentElement.classList.add('fit-arriving')}catch(e){}})()</script>`
const HEAD_CSS = `<link rel="stylesheet" href="/assets/fit-motion.css" ${MARK}>`
// The gate is desktop-only (GATE_MIN_WIDTH in fit-home.js), so the poster is
// preloaded only where it will be shown — a phone never pays for it.
const HEAD_HOME = [
  `<link rel="preload" as="image" href="/assets/gate/build-gate-poster.jpg" media="(min-width: 768px)" ${MARK}>`,
  `<link rel="stylesheet" href="/assets/fit-home.css" ${MARK}>`,
]
const BODY_JS = `<script src="/assets/fit-motion.js" defer ${MARK}></script>`
const BODY_HOME = `<script src="/assets/fit-home.js" defer ${MARK}></script>`
// /portfolio/ is a rebuilt page (its body is hand-written, see MOTION.md);
// it carries its own stylesheet and script, and preloads the display face
// its headline is set in.
const HEAD_PORTFOLIO = [
  `<link rel="preload" as="font" type="font/woff2" href="/assets/fonts/kanit-900-latin.woff2" crossorigin ${MARK}>`,
  `<link rel="stylesheet" href="/assets/fit-portfolio.css" ${MARK}>`,
]
const BODY_PORTFOLIO = `<script src="/assets/fit-portfolio.js" defer ${MARK}></script>`

async function walk(dir, out = []) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) await walk(p, out)
    } else if (e.name === 'index.html' || (dir === ROOT && e.name === '404.html')) {
      out.push(p)
    }
  }
  return out
}

function strip(html) {
  // Our tags, each with the line break that was added before it.
  return html.replace(
    new RegExp(`\\r?\\n?[ \\t]*(?:<link[^>]*${MARK}[^>]*>|<script[^>]*${MARK}[^>]*>[\\s\\S]*?</script>)`, 'g'),
    ''
  )
}

function inject(html, { home, portfolio }) {
  // Match the file's dominant line ending. 43 of the mirrored pages carry a
  // couple of dozen CRLFs from an earlier tool among thousands of LFs (git
  // normalises them on commit), so "contains any CRLF" is the wrong test.
  const crlf = (html.match(/\r\n/g) || []).length
  const lf = (html.match(/\n/g) || []).length - crlf
  const eol = crlf > lf ? '\r\n' : '\n'
  const head = [GUARD, HEAD_CSS].concat(home ? HEAD_HOME : [], portfolio ? HEAD_PORTFOLIO : []).join(eol)
  const body = [BODY_JS].concat(home ? [BODY_HOME] : [], portfolio ? [BODY_PORTFOLIO] : []).join(eol)
  let out = html
  const headAt = out.lastIndexOf('</head>')
  if (headAt === -1) throw new Error('no </head>')
  out = out.slice(0, headAt) + head + eol + out.slice(headAt)
  const bodyAt = out.lastIndexOf('</body>')
  if (bodyAt === -1) throw new Error('no </body>')
  out = out.slice(0, bodyAt) + body + eol + out.slice(bodyAt)
  return out
}

const files = await walk(ROOT)
let changed = 0, skipped = 0
for (const f of files) {
  const rel = relative(ROOT, f).replace(/\\/g, '/')
  const src = await readFile(f, 'utf8')
  const has = src.includes(MARK)
  let next = src
  if (REMOVE) {
    if (!has) { skipped++; continue }
    next = strip(src)
  } else {
    if (has) { skipped++; continue }
    next = inject(src, { home: rel === 'index.html', portfolio: rel === 'portfolio/index.html' })
  }
  if (next === src) { skipped++; continue }
  changed++
  const extra = REMOVE ? '' : rel === 'index.html' ? '  (+home)' : rel === 'portfolio/index.html' ? '  (+portfolio)' : ''
  console.log(`${DRY ? 'would ' : ''}${REMOVE ? 'strip ' : 'inject'}  ${rel}${extra}`)
  if (!DRY) await writeFile(f, next, 'utf8')
}
console.log(`\n${files.length} page(s) found, ${changed} ${DRY ? 'would change' : 'changed'}, ${skipped} untouched${DRY ? ' (dry run)' : ''}`)
