/**
 * Every redirect the copy answers, checked against what the live site answers
 * for the same URL.
 *
 * _redirects is written by hand from observation, and some of its rules are
 * patterns (/2026/*, /:slug/feed/). A pattern that is too broad sends a URL
 * the live site 404s somewhere it never went; one that is too narrow leaves a
 * working URL dead. Neither shows up by reading the file, so this asks both
 * servers the same question and compares status and Location:
 *
 *   - every exact rule, as written
 *   - every pattern rule, filled in with real sample values
 *   - the feed URL of every page in routes.txt, which the feed patterns claim
 *   - a set of URLs the live site 404s, which must not redirect here either
 *
 * Needs `npm run serve`.
 *
 *   node tools/redirects-check.mjs
 *   node tools/redirects-check.mjs --base http://localhost:4400
 */
import { readFile } from 'node:fs/promises'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ORIGIN, UA, parseRedirects } from './site.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const argVal = (f) => { const i = args.indexOf(f); return i === -1 ? null : args[i + 1] }
const BASE = argVal('--base') || 'http://localhost:4400'
const CONCURRENCY = Number(process.env.CONCURRENCY || 6)

const rules = parseRedirects(await readFile(join(ROOT, '_redirects'), 'utf8'))
const routes = (await readFile(join(ROOT, 'routes.txt'), 'utf8')).split('\n')
  .map((s) => s.trim()).filter((s) => s && !s.startsWith('#') && !s.endsWith('.xml'))

/** Real values to fill each placeholder with — pages and tags that exist. */
const SAMPLES = {
  slug: ['dallas', 'about', 'hail-damage-roof-texas'],
  tag: ['maintenance', 'planning'],
  splat: ['', '05/', '05/14/', '08/28/'],
}

const paths = new Set()
for (const r of rules) {
  const names = [...r.from.matchAll(/:([a-zA-Z_]\w*)|\*/g)].map((m) => m[1] || 'splat')
  if (!names.length) { paths.add(r.from); continue }
  let variants = [r.from]
  for (const n of names) {
    const next = []
    for (const v of variants) {
      for (const s of SAMPLES[n] || ['x']) next.push(n === 'splat' ? v.replace('*', s) : v.replace(':' + n, s))
    }
    variants = next
  }
  for (const v of variants) paths.add(v)
}
for (const r of routes) if (r !== '/') paths.add(r + 'feed/')

// The live site 404s these. Each is a near miss for one of the patterns, so a
// rule written too broadly would redirect it here.
const NEGATIVE = [
  '/services/', '/services/not-a-real-service/', '/2025/', '/2025/01/01/',
  '/author/', '/author/nobody-here/', '/tag/', '/this-path-does-not-exist/',
]
for (const p of NEGATIVE) paths.add(p)

async function probe(base, p) {
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(base + p, { redirect: 'manual', headers: { 'User-Agent': UA } })
      await res.arrayBuffer().catch(() => {})
      let loc = res.headers.get('location') || ''
      for (const pre of [ORIGIN, BASE]) if (loc.startsWith(pre)) loc = loc.slice(pre.length) || '/'
      const redirect = res.status >= 300 && res.status < 400
      return { status: res.status, loc: redirect ? loc : '' }
    } catch (e) {
      if (i === 2) return { status: 0, loc: e.message }
      await new Promise((r) => setTimeout(r, 600 * (i + 1)))
    }
  }
}

const list = [...paths]
const results = []
let i = 0
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  while (i < list.length) {
    const p = list[i++]
    const [live, mine] = await Promise.all([probe(ORIGIN, p), probe(BASE, p)])
    results.push({ p, live, mine, same: live.status === mine.status && live.loc === mine.loc })
  }
}))
results.sort((a, b) => a.p.localeCompare(b.p))

const fmt = (r) => `${r.status}${r.loc ? ' -> ' + r.loc : ''}`
const bad = results.filter((r) => !r.same)
console.log(`Checked ${results.length} URL(s) against live and ${BASE}\n`)
for (const r of results) {
  console.log(`${r.same ? '  ' : '! '}${r.p.padEnd(52)} live ${fmt(r.live).padEnd(40)} copy ${fmt(r.mine)}`)
}
console.log(`\n${bad.length === 0
  ? 'PASS — every URL answers the same status and destination as live.'
  : `${bad.length} URL(s) answer differently from live.`}`)
process.exitCode = bad.length ? 1 : 0
