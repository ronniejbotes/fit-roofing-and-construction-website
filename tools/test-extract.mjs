/**
 * Cases the asset extractor has to keep getting right.
 *
 * Every one of these is a shape that actually appears in this site's markup and
 * that a naive matcher gets wrong. The entity-escaped case is the reason this
 * file exists: Elementor writes background-video paths as JSON inside an HTML
 * attribute, so the surrounding quotes arrive as &quot;, and a character class
 * that allows '&' runs the match past the filename and asks the server for
 * "…-1.mp4&quot;". That 404s, and the two homepage background videos go missing
 * without anything failing loudly.
 *
 *   node tools/test-extract.mjs
 */
import { assetsFromHtml, assetsFromCss, rewrite, toLocalPath, parseRedirects, matchRedirect } from './site.mjs'

let failures = 0
function check(name, got, want) {
  const g = JSON.stringify([...got].sort())
  const w = JSON.stringify([...want].sort())
  if (g === w) { console.log('ok    ' + name) }
  else { failures++; console.log(`FAIL  ${name}\n        got  ${g}\n        want ${w}`) }
}

check('elementor background video, entity-escaped JSON',
  assetsFromHtml(String.raw`data-settings="{&quot;background_video_link&quot;:&quot;\/wp-content\/uploads\/2026\/01\/v.mp4&quot;}"`),
  ['/wp-content/uploads/2026/01/v.mp4'])

check('elementor background image, slash-escaped absolute JSON',
  assetsFromHtml(String.raw`{"url":"https:\/\/fitroofingco.com\/wp-content\/uploads\/a.png"}`),
  ['/wp-content/uploads/a.png'])

check('srcset candidates are all collected',
  assetsFromHtml('<img src="/a.jpg" srcset="/a-300.jpg 300w, /a-600.jpg 600w">'),
  ['/a.jpg', '/a-300.jpg', '/a-600.jpg'])

check('video poster and nested source',
  assetsFromHtml('<video poster="/p.jpg"><source src="/v.mp4"></video>'),
  ['/p.jpg', '/v.mp4'])

check('lazy-load attributes',
  assetsFromHtml('<img data-lazy-src="/l.png" data-lazy-srcset="/l-2x.png 2x">'),
  ['/l.png', '/l-2x.png'])

// The Trustindex reviews widget names its 72 KB stylesheet in a custom
// attribute and injects it after load. Nothing here knew that attribute carried
// a URL, so the file was never downloaded and the widget rendered unstyled on
// all 11 pages that carry it — the homepage, both landers and every city page.
// The extractor now matches any attribute holding a same-origin file path.
check('stylesheet named in a custom attribute (data-css-url)',
  assetsFromHtml('<div data-template-id="t" data-css-url="/wp-content/uploads/trustindex-amazon-widget.css?178"></div>'),
  ['/wp-content/uploads/trustindex-amazon-widget.css?178'])

check('an invented attribute holding an asset path is still collected',
  assetsFromHtml('<div data-whatever-url="/wp-content/uploads/x.png" data-config-js="/wp-content/y.js"></div>'),
  ['/wp-content/uploads/x.png', '/wp-content/y.js'])

check('prose in an attribute is not mistaken for a path',
  assetsFromHtml('<meta name="description" content="Costs $9.99. Visit us. Ask about aquaHALT."><div title="v1.2 release">x</div>'),
  [])

check('css relative url() resolves against the stylesheet, not the root',
  assetsFromCss('@font-face{src:url(../fonts/x.woff2)}', '/wp-content/themes/t/css/main.css'),
  ['/wp-content/themes/t/fonts/x.woff2'])

check('css absolute and external url()',
  assetsFromCss('.a{background:url("/wp-content/b.jpg")}.c{background:url(https://cdn.example.com/c.png)}', '/x.css'),
  ['/wp-content/b.jpg'])

check('third-party hosts are left alone',
  assetsFromHtml('<script src="https://www.googletagmanager.com/gtm.js"></script><img src="https://cdn.trustindex.io/a.png">'),
  [])

// The bare origin is a homepage link. Stripping the host outright leaves
// href="", which resolves to the current document — a dead self-link on the
// header logo of every page.
check('bare-origin href becomes / and not the empty string',
  [rewrite('<a href="https://fitroofingco.com">x</a>')],
  ['<a href="/">x</a>'])

check('origin with a path becomes root-relative',
  [rewrite('<a href="https://fitroofingco.com/shop/">x</a>')],
  ['<a href="/shop/">x</a>'])

check('canonical is left absolute',
  [rewrite('<link rel="canonical" href="https://fitroofingco.com/shop/" />', true)],
  ['<link rel="canonical" href="https://fitroofingco.com/shop/" />'])

check('schema graph keeps its absolute @id values',
  [rewrite('<script type="application/ld+json">{"@id":"https:\\/\\/fitroofingco.com\\/#org"}</script>', true)],
  ['<script type="application/ld+json">{"@id":"https:\\/\\/fitroofingco.com\\/#org"}</script>'])

check('og:image is left absolute',
  [rewrite('<meta property="og:image" content="https://fitroofingco.com/a.png" />', true)],
  ['<meta property="og:image" content="https://fitroofingco.com/a.png" />'])

check('toLocalPath rejects other hosts',
  [String(toLocalPath('https://example.com/a.png')), String(toLocalPath('/a.png'))],
  ['null', '/a.png'])

// _redirects patterns. Order matters: /comments/feed/ must hit its own rule
// before /:slug/feed/ turns it into /comments/, which does not exist.
const RULES = parseRedirects(`
/services/attics/   /attics-texas/  301
/2026               /  301
/2026/*             /  301
/comments/feed/     /  301
/tag/:tag/feed/     /tag/:tag/  301
/:slug/feed/        /:slug/  301
/favicon.ico        /wp-content/uploads/x-32x32.png  302
`)
const hop = (p) => { const m = matchRedirect(RULES, p); return m ? `${m.code} ${m.to}` : 'none' }
check('redirect: exact rule, with and without trailing slash',
  [hop('/services/attics/'), hop('/services/attics')], ['301 /attics-texas/', '301 /attics-texas/'])
check('redirect: splat covers every date archive depth',
  [hop('/2026'), hop('/2026/'), hop('/2026/05/'), hop('/2026/05/14/')], ['301 /', '301 /', '301 /', '301 /'])
check('redirect: specific feed rule wins over the placeholder',
  [hop('/comments/feed/'), hop('/dallas/feed/'), hop('/dallas/feed')], ['301 /', '301 /dallas/', '301 /dallas/'])
check('redirect: placeholder matches one segment only',
  [hop('/tag/planning/feed/'), hop('/a/b/feed/')], ['301 /tag/planning/', 'none'])
check('redirect: real pages and near misses are not redirected',
  [hop('/about/'), hop('/2025/'), hop('/services/'), hop('/feedback/')], ['none', 'none', 'none', 'none'])
check('redirect: dots are literal and the status is kept',
  [hop('/favicon.ico'), hop('/faviconXico')], ['302 /wp-content/uploads/x-32x32.png', 'none'])

console.log(failures ? `\n${failures} failing case(s)` : '\nall cases pass')
process.exit(failures ? 1 : 0)
