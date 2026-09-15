# fitroofingco.com — static mirror

A 1:1 static HTML copy of the live WordPress site at **https://fitroofingco.com/**, captured
**15 September 2026**.

Source stack that was mirrored: WordPress + Elementor 4.2.4 / Elementor Pro 4.1.2 +
`hello-elementor` 3.4.9 theme + Yoast SEO 28.4 (Premium 27.9) + Site Kit by Google 1.186.0 +
Trustindex "Widgets for Google Reviews", on a LiteSpeed server. Third parties loaded by the
pages: Google Tag Manager (`GTM-KKF99FGV`) and Google Analytics (`G-TQN34BCYN7`), the
Trustindex CDN, the FastBots chat widget and a Google Maps embed.

Nothing has been redesigned, rewritten, cleaned up or "improved". Copy first, optimise later.
Where the live site is wrong, it is wrong here too, in the same way — see
[Carried over from the live site](#carried-over-from-the-live-site).

The capture toolkit in `tools/` was ported from `water-automation-website`, where it was built
and proven against the same WordPress + Elementor stack.

---

## URL and file mapping

Every live URL keeps its exact path, so **the migration itself needs no redirects and no
backlink changes target**.

| Live URL | File in this repo |
|---|---|
| `https://fitroofingco.com/` | `index.html` |
| `https://fitroofingco.com/roof-repair-texas/` | `roof-repair-texas/index.html` |
| `https://fitroofingco.com/blog/page/2/` | `blog/page/2/index.html` |
| `https://fitroofingco.com/tag/maintenance/` | `tag/maintenance/index.html` |
| `https://fitroofingco.com/wp-content/uploads/…` | `wp-content/uploads/…` (identical path) |
| `https://fitroofingco.com/sitemap_index.xml` | `sitemap_index.xml` |
| `https://fitroofingco.com/llms.txt` | `llms.txt` |
| 404 template | `404.html` |

Asset paths (`/wp-content/…`, `/wp-includes/…`) were left unchanged, so every image URL
Google has already indexed still resolves.

---

## What is in here

**45 HTML pages**, plus the 404 template:

| Type | Count | Notes |
|---|---|---|
| Pages in the sitemap | 18 | Home, about, contact, portfolio, 8 service pages, 5 location pages, services hub |
| Blog posts | 19 | |
| Blog index and its page 2 | 2 | `/blog/page/2/` is `noindex` |
| `/home-2/` | 1 | A second copy of the homepage; canonical points to `/` |
| Tag archives | 4 | `noindex` |
| `/uncategorized/` | 1 | Empty default category, `noindex` |

Seven of those are in no sitemap. They were found through the WordPress REST API inventory and
by crawling every link on every page, and all return HTTP 200 on the live site.

**323 files / 115 MB** including 118 PNG, 57 JPEG, 3 WebP, one MP4 and one MOV (drone
footage), 53 stylesheets, 28 scripts, the Yoast sitemaps and their XSL stylesheet, `robots.txt`
and `llms.txt`.

---

## The only two deliberate changes to the HTML

1. **Internal asset and link references were made root-relative.**
   `https://fitroofingco.com/wp-content/x.png` → `/wp-content/x.png`. This is what lets the site
   be previewed from any origin without a rebuild.

   **Left absolute, byte-for-byte as WordPress emitted them:** `<link rel="canonical">`, every
   `og:*` / `twitter:*` / `article:*` meta tag, the Yoast `application/ld+json` schema graph,
   `rel="alternate"` and `shortlink`, and every `<loc>` in the sitemaps. Rewriting the schema
   would strip the `@id` values that tie its entities together, and rewriting canonicals would
   tell a crawler every page is the homepage. `robots.txt`, the sitemaps and `llms.txt` are
   written verbatim, because both sitemap and robots specifications require absolute URLs.

2. **A bare-origin link becomes `/`.** `href="https://fitroofingco.com"` with nothing after the
   host would otherwise become `href=""`, which a browser resolves as the current page.

That is the complete list. `_raw/` holds the untouched capture of every page (gitignored), which
is what makes this checkable rather than asserted. `tools/fixes.mjs`, where post-capture
corrections would live, is empty.

---

## Verification

All reproducible from this repo. Figures below are from 15 September 2026.

| Check | What it proves | Result |
|---|---|---|
| `npm test` | Extractor and redirect-matcher edge cases | 23 / 23 pass |
| `npm run verify` | Every route present; every same-origin reference in every HTML and CSS file resolves; no live-origin URL where anything would load from it | 48 / 48 routes, 0 unresolved, 0 leaks |
| `npm run linkcheck` | Every internal link answered by the server, every `#anchor` exists | 67 links, 0 broken, 0 missing anchors |
| `npm run redirects` | Every `_redirects` rule, every page's feed URL and eight near-miss 404s ask live and copy the same question | 100 / 100 identical status and destination |
| `npm run audit` | Every page loaded in Chromium with real input; every same-origin request that fails | 0 failed requests, 0 JavaScript errors across 45 pages |
| `npm run parity:binary` | Every document and every one of the site's own files fetched from live again and compared byte for byte, after the same origin rewrite | **51 / 51 documents, 263 / 263 files identical** |
| `npm run interactions` and `:mobile` | Clicks: accordions, the reviews arrows and "Read more", video playback, anchor jumps, phone and email links, form validation (never submitted) | **45 / 45 pages identical** at 1440 and at 390 wide |
| `npm run compare` | Full-page pixel, visible text, element counts, broken images vs live | see below |
| `npm run functions` | Elementor and jQuery load; menus, dropdowns, accordions, forms counted and driven | 11 of 13 identical; see note |
| `npm run scroll` | Page-by-page scroll-through, desktop and mobile — see below | see below |

**`functions` note.** The two differing pages are `/` and `/home-2/`, and the only difference is
how many animated widgets were still hidden after the tool's very fast script scroll (24 vs 25,
21 vs 25). The scroll-through review exists to settle exactly this kind of question with real
wheel input and a person-paced scroll.

### `npm run compare` — all 45 pages, desktop (1440×900)

| Measure | Result |
|---|---|
| Pixel-identical (0.00%) | **34 of 45** |
| Within 0.10% | 42 of 45 |
| Within 1.00% | **45 of 45** (worst 0.51%, mean 0.036%) |
| Full-page height differs from live | **0 pages** |
| `<title>` differs from live | **0 pages** |
| Broken images on the copy | **0** |
| Reviews widget built, on the pages that carry it | live 2 / 2, copy 2 / 2 |

The tool flagged 4 pages. None is a defect, and each was checked rather than assumed:

- **`/tag/planning/` and `/uncategorized/`** — one `net::ERR_ABORTED` on
  `Stamp_1760808394080-LCHykHC-.png`. That is Chromium cancelling its own request, not a
  missing file: the image is present, served with HTTP 200 at 28,300 bytes on both sides, used
  on all 45 pages, and a runtime audit of `/tag/planning/` on its own reports no failures.
- **`/home-2/`** — three words differ: live read `9 / 484 / 970`, the copy `8 / 404 / 808`.
  Those are the stat counters caught part-way through counting up, at different moments on each
  side. Neither had reached its final `10+ / 500+ / 1000+`.
- **`/`** — the copy had decoded 82 of 96 images when measured, live 78. Lazy-loading timing;
  broken images are 0 on both.

### `npm run compare:mobile` — all 45 pages, 390×844

| Measure | Result |
|---|---|
| Pixel-identical (0.00%) | **40 of 45** |
| Within 1.00% | 43 of 45 |
| Full-page height, `<title>`, missing text, broken images | **0 differences** |
| Reviews widget built, on the pages that carry it | live 2 / 2, copy 2 / 2 |

The two pages above 1% are `/` (6.73%) and `/home-2/` (6.02%), and the difference is where the
service-card photos sit, about 8,000 px down. Cropping the differing bands showed blank cards on
live and loaded photos on the copy: live had decoded 44–52 of 96 images when the full-page
screenshot was taken, the copy all 96. Re-run against the copy served with 700 ms added to
every response (`DELAY_MS=700 PORT=4402 npm run serve`), the gap reversed — the copy had
decoded 48 of 96, live all 96. The same photos arriving at network speed; the files themselves
are byte-identical (below). `/plano/` also logged one `ERR_ABORTED` on a gutter photo that is
present and identical.

### Byte parity with live

`tools/parity.mjs` answers the question every browser check sits on top of. A page is made of
its HTML, the site's own stylesheets and scripts, and third-party code from other hosts. Live
was fetched again on 15 September 2026 and compared with the repo, after putting live's copy
through the same origin rewrite the capture applied:

- **51 / 51 documents identical** — all 45 pages, the 3 sitemaps, `robots.txt`, `llms.txt` and
  the 404 template. 50 byte for byte; one differs only in a nonce WordPress regenerates on every
  render.
- **263 / 263 site files identical** — every stylesheet, script, image, font and video.

That settles, by construction, everything those bytes define, at every screen width and in
every browser: which elements animate and with what effect, duration, delay and easing; every
hover state; the tablet and narrow-phone layouts; the menu script. It also proves live had not
changed since the capture. What it cannot settle is load timing and third-party code, which is
what the browser checks below are for.

### Timing, not copying

Several differences recur in the browser checks. Each was chased to its cause rather than
waved through:

- **The Google reviews carousel is on a different card.** It autoplays from when the page
  loads. On localhost the copy ran one card *ahead* of live; served with 700 ms of latency it
  ran one card *behind*, with the same cards in the same order at the same pace. A phase offset,
  set by load time.
- **The FastBots chat bubble** fades in on its own timer and its launcher pulses for ever
  (`avatar-pulse 2s infinite`), which accounts for most of the 1–4% on mobile screenshots.
- **Logo edges.** Chrome picks between the logo's `srcset` sizes depending on what has already
  loaded, and localhost wins that race differently from the live server. Same files, slightly
  different downscaling.
- **Counters caught mid-count**, and **Google Maps tiles** arriving at their own pace.

### The scroll-through review

`compare.mjs` freezes animations before it screenshots, which is right for layout and content
and wrong for motion: an entrance animation that never fires, a counter that never counts and
a sticky header that never changes all screenshot identically once frozen.

`tools/scrollcompare.mjs` does the opposite. Live and copy are opened side by side and scrolled
together with real mouse-wheel input, in 75%-of-viewport steps. At every step both sides record
a viewport screenshot mid-animation and once settled, which Elementor entrance animations have
fired and with which effect, running CSS animations, counter values, carousel positions, the
header's position and sticky classes, and parallax transforms. After the bottom it scrolls back
up, hovers the animated buttons and the nav dropdown, and on mobile opens the menu.

It was checked for blindness before being trusted: on the homepage, 3 entrance animations fire
at the top and 27 by the bottom on both sides, the four counters reach 10 / 500 / 1000 / 2 on
both, the sticky header's state matches at every step, and all 9 Google reviews render on both.

<!-- SCROLL-REVIEW-RESULTS -->

---

## Needs configuring on the new host

1. **The redirects in `_redirects`** — all of them exist on the live site today; none is new.
   Old `/services/<slug>/` URLs, the retired `/home/` slug, author and date archives, every feed
   URL, `/sitemap.xml`, `/wp-sitemap.xml`, `/index.php` and `/favicon.ico`. Some are patterns
   (`/2026/*`, `/:slug/feed/`), in the format Netlify and Cloudflare Pages read as-is. Order
   matters: first match wins. For Apache or nginx they need translating.

2. **Slashless URLs redirect to the trailing-slash form.** The live site does this, and pages
   link `/contact` and `/home` without the slash on every page. Netlify, Cloudflare Pages,
   GitHub Pages, Apache and nginx all do it by default for directory indexes.

3. **`404.html` as the error document**, served with a real 404 status.

4. **HTTP range requests for the MP4 and MOV.** Every real static host does this; a server that
   answers `200` with the whole file makes Chromium abort and the video looks broken.

5. **`.nojekyll`** is present so GitHub Pages does not strip underscore-prefixed paths.

---

## What a static copy cannot do

| Feature | What it needs | Status in this copy |
|---|---|---|
| **3 Elementor lead forms** — `/`, `/home-2/`, `/contact/` | `admin-ajax.php` | Render and validate; **submissions go nowhere**. Deferred on request. |
| Site search (`/?s=`), advertised as a `SearchAction` in the schema | WordPress queries | A static host ignores the query and serves the homepage |
| `/wp-login.php`, `/wp-admin/`, `/wp-json/` | WordPress | Absent |
| WordPress's slug guessing | WordPress core | Live 301s any `/services/<prefix>/` to the first page whose slug starts with it (so `/services/roofing/` lands on `/roofing-locations/`). Only the real old service URLs are carried in `_redirects`. |
| Paginated copies of single pages (`/portfolio/page/2/`, `/page/2/`) | WordPress | Live answers 200 with a canonical to the unpaginated page; nothing links to them. They 404 here. |
| Google reviews refreshing | The Trustindex plugin | The 15-review template is a snapshot of 15 September; the CDN loader still renders it |

`npm run forms` prints each form's fields. All three collect name, phone, address (required)
and message; the contact form also asks for email (required).

**Analytics will record previews.** GTM and GA4 load from Google exactly as on live, so anyone
browsing a staging copy is counted in the live property until the host is the real domain.

**The checks themselves count as visits unless beacons are blocked.** Every browser tool here
now aborts analytics beacons on both sides (`tools/browser.mjs`). The first round of checks on
15 September 2026 ran before that existed, and put several hundred automated page views into
the client's GA4 property (`G-TQN34BCYN7`) from both `fitroofingco.com` and `localhost`. That
day's traffic figures are inflated and should be annotated or filtered.

---

## Carried over from the live site

Not introduced by the migration; left alone per the copy-exactly brief.

1. **The testimonial carousel on `/` and `/home-2/` uses stock portraits.** It is a hand-built
   HTML widget (not the Trustindex Google reviews), with 20 named reviewers shown twice for the
   scrolling loop. Six of them have photos loaded from `randomuser.me`, a service that generates
   placeholder portraits. Whether those names and quotes are real customers is a question for
   the client before this section is kept or marked up in any way.

2. **`/home-2/`** is a published, indexable duplicate of the homepage (canonical to `/`), and
   Yoast's `llms.txt` lists it as "Home Demo" linking to `/`. Probably a leftover worth
   unpublishing at source.

3. **Six `/services/<slug>/` links on `/blog/`** point at the old service URLs and reach their
   pages through a 301, as do the post-date links to `/2026/…/` day archives, which 301 to the
   homepage.

4. **Two public author slugs** (`p3akl3ads`, `seodev2`) are exposed through the REST API and the
   author redirects.

5. **The `og:image` on `/about/` uses `http://`**, not `https://`. It is identity metadata, so it
   was kept byte-for-byte; worth correcting at source, since some social platforms refuse
   insecure preview images.

6. **"Read more" in the Google reviews carousel does nothing.** On `/` and `/home-2/`, six
   review cards show a "Read more" link under clipped text. A real pointer click lands on it
   and changes nothing on the live site — no expanded text, no label change, not one DOM
   change in the card (checked 15 September 2026, `shots/_probe/ti-readmore.mjs`). The copy
   behaves identically. Worth raising with the client: it is a visible control that looks
   broken to anyone who tries it.

---

## Rebuilding the mirror

```bash
npm install
npm run discover   # crawl live, rewrite routes.txt and .probe.json
npm run mirror     # browser capture of every route (add --resume to continue)
npm run assets     # backfill srcset variants, fonts and files the browser skipped
npm run fix        # re-apply tools/fixes.mjs
npm test && npm run verify
npm run serve      # http://localhost:4400, then the live comparisons above
```

`_raw/` is gitignored — it duplicates every page — but it is the reference for "what did the
rewrite change?", and it is what `verify` compares page sizes against.
