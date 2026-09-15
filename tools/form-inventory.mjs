/**
 * Inventory of every Elementor form in the mirror.
 *
 * The forms are the one part of this site that looks fine and does nothing: they
 * POST to admin-ajax.php, which no static host runs, and their "thank you"
 * message is client-side — so a dead form and a working form are visually
 * identical. Anyone rebuilding them needs to know exactly what each one collects
 * and where it appears, which is what this prints.
 *
 *   node tools/form-inventory.mjs
 *   node tools/form-inventory.mjs --json
 */
import { readFile, readdir } from 'node:fs/promises'
import { join, resolve, dirname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const JSON_OUT = process.argv.includes('--json')
const SKIP = new Set(['.git', 'node_modules', '_raw', 'tools', 'shots', '.probe'])

async function walk(dir, out = []) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue
    const p = join(dir, e.name)
    if (e.isDirectory()) await walk(p, out)
    else if (e.name === 'index.html') out.push(p)
  }
  return out
}

/** Split a document into one chunk per <form>, so fields land on the right form. */
function formChunks(html) {
  const out = []
  const re = /<form[^>]*class="[^"]*elementor-form[^"]*"[\s\S]*?<\/form>/gi
  for (const m of html.matchAll(re)) out.push(m[0])
  return out
}

const forms = new Map()

for (const file of await walk(ROOT)) {
  const rel = '/' + relative(ROOT, file).split('\\').join('/').replace(/index\.html$/, '')
  const html = await readFile(file, 'utf8')
  for (const chunk of formChunks(html)) {
    const idm = /name="form_id" value="([^"]+)"/.exec(chunk)
    if (!idm) continue
    const id = idm[1]
    if (!forms.has(id)) {
      forms.set(id, { id, pages: new Set(), fields: new Map(), button: null, name: null })
    }
    const f = forms.get(id)
    f.pages.add(rel)

    const nm = /name="form_name" value="([^"]*)"/.exec(chunk)
    if (nm && !f.name) f.name = nm[1]

    for (const m of chunk.matchAll(/<(input|textarea|select)\b([^>]*)>/gi)) {
      const attrs = m[2]
      const name = /name="form_fields\[([^\]]+)\]"/.exec(attrs)
      if (!name) continue
      const type = /type="([^"]+)"/.exec(attrs)?.[1] || m[1].toLowerCase()
      const required = /required/.test(attrs) || /aria-required="true"/.test(attrs)
      const placeholder = /placeholder="([^"]*)"/.exec(attrs)?.[1] || ''
      f.fields.set(name[1], { type, required, placeholder })
    }
    const btn = /<button[^>]*type="submit"[\s\S]*?<span class="elementor-button-text">([^<]*)</.exec(chunk)
    if (btn && !f.button) f.button = btn[1].trim()
  }
}

const list = [...forms.values()].sort((a, b) => b.pages.size - a.pages.size)

if (JSON_OUT) {
  console.log(JSON.stringify(list.map((f) => ({
    id: f.id, name: f.name, button: f.button,
    pages: [...f.pages].sort(),
    fields: [...f.fields].map(([k, v]) => ({ name: k, ...v })),
  })), null, 2))
} else {
  console.log(`${list.length} distinct form(s) across ${new Set(list.flatMap((f) => [...f.pages])).size} page(s)\n`)
  for (const f of list) {
    console.log(`form ${f.id}${f.name ? `  "${f.name}"` : ''}`)
    console.log(`   submit button: ${f.button || '(not found)'}`)
    console.log(`   on ${f.pages.size} page(s): ${[...f.pages].sort().slice(0, 4).join(', ')}${f.pages.size > 4 ? ', …' : ''}`)
    console.log(`   fields (${f.fields.size}):`)
    for (const [name, v] of f.fields) {
      console.log(`      ${name.padEnd(22)} ${v.type.padEnd(9)}${v.required ? 'required ' : '         '}${v.placeholder ? `"${v.placeholder}"` : ''}`)
    }
    console.log()
  }
  const allFieldTypes = new Set(list.flatMap((f) => [...f.fields.values()].map((v) => v.type)))
  console.log(`field types used across all forms: ${[...allFieldTypes].sort().join(', ')}`)
}
