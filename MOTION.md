# The motion layer

Scroll reveals, hover polish, a roofline page transition, a parallax hero and — on the
homepage — a click-to-enter gate that shows a roof being built. Added 20 September 2026 on
top of the mirror, as four files and one tag-injection script. Nothing in the mirrored
markup was rewritten; the layer finds its targets at runtime.

The signature is the roofline. F.I.T. stands for Foundation, Integrity, Trust, and the logo
draws those letters as a bronze gable — so the gable is what moves between pages, bronze
is what draws under every section title, and the palette is the Elementor kit's own
(`#826749` primary, `#A1805A` accent, `#1A1A1A` secondary). Nothing bounces.

## Files

| File | Loaded on | What it does |
|---|---|---|
| `assets/fit-motion.css` / `.js` | every page | Reveals, the roofline transition, the hero layer, header polish, the reading-progress hairline, hover, card tilt |
| `assets/fit-home.css` / `.js` | `/` only | The gate, the owner-portrait glow, the headline rule, the scroll cue |
| `assets/gate/build-gate.mp4`, `.webm`, `build-gate-poster.jpg` | `/` only, fetched after `load` | The 5-second clip and its first frame |
| `tools/inject-motion.mjs` | — | Puts the tags into every page, or takes them out |
| `tools/motion-qa.mjs`, `tools/motion-a11y.mjs` | — | Drive it all in Chromium: gate, scroll, hover, transition, mobile, reduced motion, keyboard |

```bash
npm run motion          # inject into all 46 pages (idempotent)
npm run motion:dry      # report what would change
npm run motion:remove   # strip every tag — pages return byte for byte to the capture
npm run motion:qa       # browser checks + screenshots (needs npm run serve)
npm run motion:qa:keys  # keyboard, focus trap, focus hand-off, bfcache-safe unlock
```

Each page gets three things in `<head>` — a two-line inline guard, `fit-motion.css`, and
on `/` `fit-home.css` — and the deferred scripts before `</body>`. Every tag carries
`data-fit-motion`, which is what `--remove` keys on.

## How it behaves

**Content ships visible.** The only thing that ever hides an element is `html.fit-motion`,
which the script adds after confirming it can animate and the visitor has not asked for
reduced motion. No JavaScript, a script error, or `prefers-reduced-motion` gives exactly the
mirror. Only `opacity`, `transform` and `clip-path` are animated.

**Elementor's own entrance animations are left alone.** Widgets carrying
`.elementor-invisible` are never tagged; their section titles still get the bronze rule,
keyed off Elementor's `.animated` class instead of ours.

**Nothing is keyed to an Elementor element id.** Those regenerate whenever a page is
re-saved in the editor, so cards, tiles, headings and the hero are found by widget type and
structure — a container holding image + heading + button is a card; icon + heading is a
tile; the first page container with a cover photograph is the hero.

### The gate (`/`)

Modelled on the In The Light Roofing gate. You arrive on frame 0 of the clip (the house
stripped to bare sheathing, bundles stacked at the ridge), read the three words from the
logo, click **Build it the F.I.T. way**, watch the shingles go on, and are let through. The
clip was generated *between* two stills — a clean start frame and the homepage hero
photograph itself — so the poster carries no lettering and the crossfade lands on the
picture the video just ended on. Scroll is locked while it is up (`overflow`, plus wheel/touch/key blocking for
iOS). Every failure path lets the visitor in: reduced motion, a refused `play()`, a missing
file, a stalled download, Escape, **Skip**, and a failsafe timer sized from the clip's real
duration. The chat launcher (`z-index: 2147483647`, which nothing can out-stack) is hidden
while the gate is up so it cannot sit on Skip. The video is not fetched until the page has
finished loading.

**Who gets the door.** ITLR shows it on every load and notes that is worth weighing on a
site whose job is to move people toward a quote. This homepage is the page that ranks and
it sells emergency storm work, so here the door is a first-arrival moment, not a toll:
once per tab (`GATE_ONCE_PER_SESSION = true`); never when arriving by the site's own
roofline transition — the logo, the Home link — because that visitor is already inside;
and **not on phones** (`GATE_MIN_WIDTH = 768`), because a full-screen dialog between a
search result and the phone number is exactly what Google's intrusive-interstitial
guidance warns about, and a 16:9 clip shows a phone only its middle quarter anyway. Both
are one-line changes in `fit-home.js`. The gate's ground is the kit's ink, not white, so a
slow connection never opens the dark site on a blank white screen.

### The roofline transition

A same-origin link click adds `html.fit-leaving`: a bronze gable — `html::after`,
`clip-path` peak — rises from the foot of the screen over 420 ms, then navigation happens
with a `sessionStorage` flag set. The next page's inline head guard reads and clears the
flag and puts `html.fit-arriving` on *before the body paints*, so the same gable is already
covering the page at first paint and lifts away by a pure CSS animation — it finishes even
if the script on that page never runs. Not intercepted: modifier clicks, `target=_blank`,
downloads, `tel:`/`mailto:`, in-page anchors, files, the gate, anything inside a form.
bfcache restores snap both classes off.

### The hero

The first cover photograph on a page is moved onto a child layer behind the content and
drifts (Ken Burns, 32 s alternate) while scrolling parallaxes it at 22% of page speed,
capped at 11% of the hero's height so the layer's bleed is never exhausted. Elementor's own
overlay `::before` still paints above it. On `/` the owner's portrait gets a breathing
bronze glow behind it and a float; the headline draws a rule; a cue at the foot bobs until
the first scroll.

## The /portfolio/ page

Rebuilt on 20 September 2026 from a template the client supplied (a dark "3D creator"
portfolio: React, Tailwind, Framer Motion, Kanit). The **design** was ported and the
**stack** was not — the same reasoning as In The Light Roofing's overrides: this repo has
no build step, and nothing React could be pasted into WordPress later. The page's Elementor
body was replaced by a hand-written `<main id="content" class="fp">`; the mirrored header
and footer around it are untouched, and so are the `<title>`, meta description, canonical
and schema.

| File | What it does |
|---|---|
| `assets/fit-portfolio.css` / `.js` | The five template components in plain CSS + a classic script: FadeIn (`[data-fp-fade]`), Magnet (`[data-fp-magnet]`), scroll-driven Marquee, character-by-character AnimatedText, and the sticky CardStack. One passive scroll listener, one frame. |
| `assets/portfolio/` | WebP derivatives (900 w and 1600 w) of the **six real drone photographs** plus `portfolio.jpeg`, eight stills from the two drone clips, and a 12-second centre-cropped flyover (`finished-flyover.mp4`, 719 KB). 4.2 MB in total. |
| `assets/fonts/kanit-*.woff2` | Kanit 300/500/700/900, Latin, self-hosted (19 KB each). The 900 is preloaded on this page. |
| `tools/motion-qa-portfolio.mjs` | `npm run motion:qa:portfolio` — desktop, mobile and reduced-motion probe with screenshots. |

**Content is the company's own.** The hero lede says only what the page shows — "Real
jobs, photographed from the air — from dry-in to finished roof" — because the original
sentence's "commercial" and "completed" are not in any of these photographs. The About block is the founder's homepage quote, verbatim (its typo, "believe",
is the live site's and is reproduced, not corrected — see below). Each of the eight
services carries the opening sentence of its own page and links to it. Each of the three
project cards is **one house**, titled by what its photographs show — *Dried in, ready for
shingles* (the two-storey job: the full frame and two detail crops of the same photograph),
*Tile roof, new courses going down*, *Finished roof, from above* (the flyover house: two
stills and the clip) — with no client names, addresses, dates or figures, and every alt text
describes the actual photograph. An agent review caught the first draft of this: three
cards that were collages of different houses under "Projects 01–03", and titles claiming
"clay", "re-laid" and "inspected" that no photograph could back. Fixed before it shipped. The template's "Live Project" button
became a link to the matching service page. `roofing-installation-in-dallas-texas.jpg`
was **not** used: it is a stock photograph of a European tile roof, not this company's work.

**Departures from the template, on purpose.** Warm off-white text (`#E9E2D8`) and a
bronze gradient headline instead of the template's cool blue-grey; a bronze gradient pill
instead of purple; a warm `#F5F0E8` services band; the corner "3D toys" are four small
real stills; the portrait is the same photographic cutout the homepage uses (there is also
an illustrated version of the founder, `primary-…-683x1024.png`, on the live About section —
a one-line swap if preferred, but next to real drone photography the photograph is the
honest choice). The in-page nav links use native smooth scrolling; no scroll-hijacking
library, which the 21st.dev reference material itself warns against for sticky layouts
and assistive tech.

**Two things found in the source material.** The second drone clip
(`Copy-of-dji_fly_…quickshot.mov`) is HEVC with a 90° rotation tag — Chrome cannot play
HEVC, so the live page's second video widget is a black box, and the footage is vertical.
It is now a landscape centre-crop (the roof sits mid-frame). And the page's original
paragraphs were, like the homepage's founder text, wrapped in pasted ChatGPT DOM
(`data-message-model-slug="gpt-5-3"`) — gone with the rebuild.

**What the review changed.** Five agent lenses went over the page and the confirmed
findings were fixed. The largest was structural: **the cards were not stacking at all.**
Each card was `position: sticky` inside its own 85vh slot, and a sticky element can only
stick for the height its containing block has left — so each card unstuck and scrolled away
*before* the next one arrived, which is the opposite of the effect. The slot is now what
sticks (`top: 0`, one viewport tall, with a staircase of `padding-top`), the card inside it
is static, and successive slots ride up and cover the ones before them. Three cards are now
on screen together at the end of the run, at 0.94 / 0.97 / 1.0 scale.

Also fixed: the founder's quote now ships a real, visually-hidden copy for screen
readers (an `aria-label` on a `<p>` whose only child is `aria-hidden` is skipped by NVDA and
JAWS — the quote was silently unreadable); the reveal transition moved off the hidden state
onto `.is-in`, so adding the motion class no longer fades the visible hero out and back on
load; the in-page nav moves focus to the section it scrolls to; the looping flyover has a
keyboard-reachable **Pause** control and, once pressed, the observer stops overriding it
(WCAG 2.2.2 — the clip runs longer than five seconds); the primary pill's gradient lost the
light copper stop that sat under the white label and dropped it below 4.5:1; the hero nav
and CTA wrap instead of clipping at 320px or with a large user font; Tab onto a not-yet-
revealed block shows it immediately; and the services `<ol>` carries `role="list"` so
WebKit keeps announcing it as one.

**Reversibility.** `npm run motion:remove` strips the tags but does **not** restore the
old page body; that is a content change and lives in git (`git checkout -- portfolio/index.html`).
The original body is also in the session scratchpad as `portfolio-original-body.html`.

**Decide before it ships.** The `<h1>` is now "Our Work" where it was "Portfolio" (the
`<title>` is unchanged). Neither is a search term anyone types; if this page is meant to
rank, a keyword-bearing subheading ("Roof replacement and repair projects across
Dallas–Fort Worth") under the display headline would do more than either word.

### What the reference sweep found

Five agents swept awwwards.com, motionsites.ai, 21st.dev, refs.gallery and dribbble.com
for work in this niche — 102 verified references. What the trustworthy contractor and
trades sites have in common: **restraint.** One photograph per idea, a plain headline that
names the trade and the region, a single warm accent rationed to the headline and the
primary CTA, and neutral chrome so the photography supplies the colour. Their motion is
small and scroll-linked — at most one pinned section, one-shot reveals, parallax under
about 10%, marquees as duplicated CSS tracks with masked edges. What they leave out is
the tell: no preloaders, no invented stats or logo walls, no 3D, no scroll hijacking, and
a phone number in the first viewport.

Closest to this brief, and worth opening before any further design work:

- **[Klindworth Roofing](https://www.awwwards.com/sites/klindworth-roofing)** — the only
  awarded roofing contractor on Awwwards, on a bronze-on-near-black palette almost
  identical to this kit's.
- **[METRIC Civil](https://www.metriccivil.ca/)** — a real trades site: darkened drone
  hero, oversized headline that resolves in, a corner video thumbnail rather than an
  autoplay background.
- **[DahPro roofing landing page](https://dribbble.com/shots/27595899-DahPro-Roofing-ontractor-landing-page)**
  — a one-page roofing site in hand-written HTML/CSS/vanilla JS; the nearest thing to what
  this repo is.
- **[CSS image stacking](https://21st.dev/@uilayout.contact/components/css-image-stacking)**
  — proves the sticky card stack needs no pinning library, which is why ours is 30 lines of CSS.
- **[motionsites.ai/sections](https://motionsites.ai/sections)** — holds the Services panel
  and Scroll Marquee previews the supplied template was built from.

Three of their recommendations are worth doing next and are **not** done here: a bronze
job-type tag pinned on each card photo (TEAR-OFF / RE-ROOF / TILE) so the three cards read
as one schema; a mask-wipe instead of a plain cut from the dark marquee into the light
services band; and a slim text ticker between the marquee rows built only from checkable
facts. Their other suggestions were declined on the house rules — trust chips, stat
counters, founding year, client logos, testimonials and geo pages all need numbers or
claims this business has not given us.

## Verified

`npm run motion:qa` and `npm run motion:qa:keys` drive it in Chromium (last run 20
September 2026, after a five-lens agent review — JS, CSS, accessibility, brand, visual —
whose confirmed findings are all fixed):

- Desktop `/`: gate present, scroll refused behind it, copy correct, clip plays, gate removes
  itself and unlocks; hero layer built with the mirror's exact framing and the container's
  own background switched off; owner glow, cue, headline rule; owner parallax moving
  (16 px at 200 px of scroll); 23 reveal targets of our own (everything inside a container
  Elementor already animates is left to Elementor), 8 cards, 3 tiles, 6 heading rules;
  **23/23 revealed** after a wheel-driven scroll-through; on hover a card tilts, its
  photograph zooms to 1.05 and a tile lifts 4 px; counters sit at rest after reveal; the
  sticky header activates; hero parallax capped at 15.6 px.
- Keyboard: focus starts on the dialog, Tab cycles only between the two buttons (31 body
  children made `inert`), Space on the button starts the clip, the faded button leaves the
  tab order, Escape unlocks and hands focus to the headline, the page scrolls afterwards,
  and 25 Tabs from the top never land on a hidden reveal target.
- `/` → `/about/` by link: `fit-leaving` on click, `fit-arriving` present at the
  destination's `DOMContentLoaded`, dropped after the lift; no gate on `/about/`.
- Mobile 390×844: no gate (by design, see above), reveals tag, no tilt. The 8 px horizontal
  overflow on `/` is **pre-existing** — measured 398 px with our stylesheets disabled too;
  it is the Trustindex reviews widget.
- Reduced motion: no gate, `html.fit-motion` never set, nothing hidden.
- `/roof-repair-texas/`, `/contact/`: hero layer and reveals, no gate, no form inside a
  reveal target. `/blog/`: no cover photograph, so no hero layer — correct.
- `/portfolio/` (`npm run motion:qa:portfolio`): Kanit loads; hero fades in; the magnet
  follows the pointer and springs back; the marquee rows move in opposite directions with
  scroll and never run out at 1024, 1920 or 2560 wide; the paragraph splits into 309
  characters and is 100% lit at the end of its range; 8 services, all 8 links answer 200;
  three cards settle into a 0.949 / 0.977 / 1.0 stack; the flyover plays while on screen and
  is landscape; mobile has no horizontal overflow; reduced motion shows everything, splits
  nothing, moves nothing. On a short laptop viewport (1024×576) the cards shrink so each
  stays shorter than its slot and fits under the header. 0 errors, 0 failed requests.
- 0 console errors and 0 failed same-origin requests on every run. The only aborted
  requests are the analytics beacons `tools/browser.mjs` blocks on purpose, and — on some
  runs — the logo PNG as `net::ERR_ABORTED`, which is Chromium cancelling its own request
  and is recorded in MIRROR.md on the untouched mirror too.
- `npm run verify`: 48/48 routes, 0 unresolved references, 0 origin leaks.
  `npm run audit`: 45 pages, 0 failed requests, 0 JavaScript errors.
- `npm run motion:remove` restores every page: `index.html` comes back byte-identical to
  HEAD, and the other 43 differ only by CR bytes that were already in the working copy
  before this work (an earlier tool wrote CRLF; `.gitattributes` normalises to LF on
  commit, so `git diff` is empty while `git status` lists them once they are rewritten).

**`npm run parity`, `compare` and `scroll` now report every page as different from live.**
That is the point of the change, not a regression. To re-verify a fresh capture against
live, `npm run motion:remove` first, then `npm run motion` again.

## For the client, before this ships

1. **The gate copy.** "Foundation. Integrity. Trust." is what F.I.T. stands for and is in
   the logo; "Build it the F.I.T. way" is the homepage's own phrase. Both are the company's
   words, but the client should approve them as a button.
2. **The clip is AI-generated** (Higgsfield; 21 credits across four attempts). The first
   three, prompted text-free, still printed garbled brand-like marks on the underlayment or
   the sheathing — one with a ® symbol, which is an implied endorsement of a product that
   does not exist. The shipped clip was driven from a generated **start frame** (bare,
   unprinted sheathing, no lettering anywhere) to the real hero photograph as the end frame,
   so its poster is clean and its last frame matches the page. It is illustration of the
   craft, not a record of a job: the house is the site's own (synthetic) hero house.
   **The owner should approve it as such, and it must never be captioned as work or reused
   in Portfolio** — that would be an invented case study.
3. **The hero's "Michael Cesar" paragraph on `/` is wrapped in pasted ChatGPT markup** (a
   `qMYqUG_convSearchResultHighlightRoot` div with `data-message-model-slug="gpt-5-5"` and
   dozens of Tailwind classes — `index.html` line 212). It is on the live site and renders
   fine, but it is junk in the source and worth cleaning in Elementor.
4. **The gate policy.** Shipped as once per tab, desktop only, never on internal
   navigation (see above). If the client wants it on phones too, or on every arrival, it is
   `GATE_MIN_WIDTH` / `GATE_ONCE_PER_SESSION` in `fit-home.js` — but the SEO trade-off on
   the ranking page should be a knowing decision.
5. **The founder's quote reads "one simple believe"** on the live homepage and now, large,
   on the portfolio page. It is the client's copy and was reproduced, not corrected. One
   word to change on their say-so ("belief"), in both places.
6. **The portfolio's second drone clip is unplayable in Chrome on the live site** (HEVC
   `.mov`). Worth replacing at source with an H.264 `.mp4`; the cropped 12-second version
   here can be handed over as-is.
