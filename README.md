# fit-roofing-and-construction-website

A complete static HTML copy of **https://fitroofingco.com/** — Fit Roofing & Construction —
captured 15 September 2026 from the live WordPress + Elementor Pro site.

The point of the copy is control: the same pages, at the same URLs, as plain HTML we own, so
titles, headings, internal linking, schema and page structure can be changed directly instead
of through a page builder.

**Nothing has been redesigned or rewritten.** The capture is faithful, including the things
that are wrong on the live site. The lead forms render and validate but do not submit anywhere
yet — that is deliberate and deferred, see below.

## Start here

- **[MIRROR.md](MIRROR.md)** — what was captured, the only changes made to it, how it was
  verified (including the page-by-page scroll-through review), what the new host needs
  configuring, and the honest list of what a static copy cannot do.
- **[_redirects](_redirects)** — the redirects the live site already answers, carried across
  so every URL that works today keeps working.
- **[routes.txt](routes.txt)** — the 48 URLs that make up the site (45 pages and 3 sitemaps).

## Working on it

```bash
npm install
npm run serve     # http://localhost:4400 — serves this repo the way production will
```

`tools/serve.mjs` behaves like a static host: directory indexes, `404.html` with a real 404
status, byte ranges for the videos, and a replay of `_redirects`.

## Checking it

```bash
npm test               # extractor and redirect-matcher edge cases
npm run verify         # every route present, every reference resolves, no origin leaks
npm run parity         # every page and site file byte-identical to what live serves now
npm run parity:binary  #   …including every image, font and video
npm run linkcheck      # requests every internal link, checks every #anchor exists
npm run redirects      # every redirect answers the same status and destination as live
npm run audit          # loads every page, logs every same-origin 404 and JS error
npm run compare        # full-page pixel + text + element diff against live
npm run compare:mobile
npm run scroll -- --all          # scroll-through: animations, sticky header, counters,
npm run scroll:tablet -- --all   #   dropdowns, every :hover rule, the mobile menu
npm run scroll:mobile -- --all
npm run interactions   # clicks: accordions, reviews controls, video, anchors, form validation
npm run interactions:mobile
npm run functions      # older, faster check of menus, carousels and accordions
npm run forms          # inventory of every form: fields, required flags, pages
```

Everything except `test`, `verify`, `parity` and `forms` needs `npm run serve` running in
another terminal. **On Windows, run the page tools from PowerShell** — Git Bash rewrites a
route argument like `/` into `C:/Program Files/Git/`.

Every browser tool aborts analytics beacons on both sides (`tools/browser.mjs`), so checks do
not count as visits in the client's Google Analytics. To compare timing-sensitive behaviour
with a realistic network, serve a second copy with latency and point a tool at it:
`DELAY_MS=700 PORT=4402 npm run serve`, then `--local http://localhost:4402`.

Run any visual comparison twice before acting on it. The homepage reviews carousel rotates, so
a single sample is not evidence.

## Rebuilding from live

```bash
npm run discover   # crawl live, rewrite routes.txt and .probe.json
npm run mirror     # browser capture of every route (--resume continues)
npm run assets     # backfill srcset variants, fonts and files a browser never requests
npm run fix        # re-apply tools/fixes.mjs (currently empty)
```

## Before cutover

1. **The three lead forms submit to nothing.** They post to WordPress's `admin-ajax.php`,
   which no static host runs. Parked on request; they must be wired to an endpoint before the
   domain moves, or enquiries are lost silently.
2. **Configure the host** as listed in MIRROR.md: `_redirects`, `404.html`, trailing-slash
   directory indexes, range requests for video.
