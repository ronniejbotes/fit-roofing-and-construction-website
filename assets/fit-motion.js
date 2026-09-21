/*
 * Fit Roofing — motion layer (every page).
 *
 * Tags reveal targets in the mirrored Elementor markup, reveals them with one
 * IntersectionObserver, runs the roofline page transition, lifts the hero
 * photograph onto its own parallax layer, drives the reading-progress
 * hairline, and adds a pointer-tilt to the service cards.
 * See assets/fit-motion.css for the rules.
 *
 * Classic script, no build step, ES5-ish on purpose: the same file can be
 * pasted into an Elementor footer snippet if this ever goes back to WordPress.
 *
 * Nothing here is keyed to an Elementor element id (elementor-element-xxxxxxx).
 * Those regenerate whenever a page is re-saved in the editor, so targets are
 * found by widget type and structure instead.
 */
(function () {
  'use strict'

  var html = document.documentElement
  var REDUCED = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null
  var FINE = window.matchMedia ? window.matchMedia('(pointer: fine)') : null
  var NAV_KEY = 'fit-nav'

  function reduced() { return !!(REDUCED && REDUCED.matches) }

  /* Elementor's own entrance animations. A widget carrying one is already
     hidden by .elementor-invisible until Elementor's scroll handler fires it;
     hiding it a second time would leave the two fighting over opacity. */
  function elementorAnimated(el) {
    if (el.classList.contains('elementor-invisible')) return true
    var s = el.getAttribute('data-settings') || ''
    return s.indexOf('animation') !== -1
  }

  /* Never hide the site chrome, a form, or anything already handled. */
  function offLimits(el) {
    return !!el.closest(
      'header, footer, .elementor-location-header, .elementor-location-footer, ' +
      '.elementor-widget-form, form, .elementor-widget-nav-menu, ' +
      '.elementor-widget-theme-site-logo, [data-fit-reveal], .fit-card, .fit-tile, #fit-build-gate'
    )
  }

  /* Anything inside a container Elementor animates is Elementor's: it already
     fades in with its parent, and fading it a second time on its own is the
     double-animation the visual review caught on 37 of 60 targets. */
  var ELEMENTOR_ANIMATED = '.elementor-invisible, [data-settings*="animation"]'
  function insideElementorAnimation(el) {
    var p = el.parentElement
    return !!(p && p.closest(ELEMENTOR_ANIMATED))
  }

  function directWidgets(con) {
    var out = []
    for (var i = 0; i < con.children.length; i++) {
      if (con.children[i].classList.contains('elementor-widget')) out.push(con.children[i])
    }
    return out
  }

  function hasType(list, type) {
    for (var i = 0; i < list.length; i++) {
      if (list[i].classList.contains('elementor-widget-' + type)) return true
    }
    return false
  }

  function isCentred(el) {
    return window.getComputedStyle(el).textAlign === 'center'
  }

  /* Is this computed colour (or gradient string) one of the kit's bronzes?
     Used to draw a heading rule in white where a bronze one would vanish. */
  var BRONZE = [[130, 103, 73], [161, 128, 90]]
  function isBronze(value) {
    var re = /rgba?\((\d+),\s*(\d+),\s*(\d+)/g
    var m
    while ((m = re.exec(value || ''))) {
      for (var i = 0; i < BRONZE.length; i++) {
        var d = Math.abs(m[1] - BRONZE[i][0]) + Math.abs(m[2] - BRONZE[i][1]) + Math.abs(m[3] - BRONZE[i][2])
        if (d < 60) return true
      }
    }
    return false
  }

  /* Elementor hides whole containers per breakpoint (elementor-hidden-mobile
     and friends). An element with no box can never intersect, so it must not
     be tagged — it would sit hidden for ever if the breakpoint changed. */
  function hasBox(el) {
    return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length)
  }

  /* ------------------------------------------------------------------------
   * 1. Tag the targets.
   * ---------------------------------------------------------------------- */
  var WIDGET_TYPES = [
    'heading', 'text-editor', 'divider', 'counter', 'icon', 'icon-list',
    'icon-box', 'image', 'button', 'html', 'social-icons', 'video',
    'image-box', 'testimonial', 'post-info', 'loop-grid'
  ]

  function tagTargets() {
    var cards = []

    // Containers: Elementor flex containers (.e-con) — this site uses them
    // everywhere — plus legacy columns for any page that still has them.
    var cons = document.querySelectorAll('.e-con.e-child, .elementor-column')
    for (var i = 0; i < cons.length; i++) {
      var con = cons[i]
      if (offLimits(con) || elementorAnimated(con) || !hasBox(con)) continue
      var w = directWidgets(con)
      if (w.length < 2) continue
      // Hover polish (the class) is always welcome; our own reveal is not
      // when Elementor already fades the container's parent in.
      var nested = insideElementorAnimation(con)

      // A service card: a picture, a title and a call to action, together.
      if (hasType(w, 'image') && hasType(w, 'button') && hasType(w, 'heading')) {
        if (!nested) con.setAttribute('data-fit-reveal', 'zoom')
        con.classList.add('fit-card')
        cards.push(con)
        continue
      }
      // A value / process tile: an icon with a title under it.
      if (hasType(w, 'icon') && hasType(w, 'heading')) {
        if (!nested) con.setAttribute('data-fit-reveal', '')
        con.classList.add('fit-tile')
        continue
      }
    }

    // Everything else, widget by widget.
    var sel = WIDGET_TYPES.map(function (t) { return '.elementor-widget-' + t }).join(',')
    var widgets = document.querySelectorAll(sel)
    for (var j = 0; j < widgets.length; j++) {
      var el = widgets[j]
      if (offLimits(el) || elementorAnimated(el) || insideElementorAnimation(el) || !hasBox(el)) continue
      el.setAttribute('data-fit-reveal', el.classList.contains('elementor-widget-image') ? 'zoom' : '')
    }

    // Every section title gets a drawn rule — including the ones Elementor
    // animates itself (the rule then keys off Elementor's .animated class in
    // the CSS, so the two never fight). Skipped: headings Elementor already
    // follows with a divider widget, and anything inside a card or tile.
    var heads = document.querySelectorAll('.elementor-widget-heading h2')
    for (var h = 0; h < heads.length; h++) {
      var widget = heads[h].closest('.elementor-widget')
      if (!widget || !hasBox(widget)) continue
      if (widget.closest('header, footer, .elementor-location-header, .elementor-location-footer, ' +
                         '.fit-card, .fit-tile, form, .elementor-widget-form, #fit-build-gate')) continue
      var next = widget.nextElementSibling
      if (next && next.classList.contains('elementor-widget-divider')) continue
      heads[h].classList.add('fit-h2')
      if (isCentred(heads[h])) heads[h].classList.add('fit-h2--center')
      var band = widget.closest('.e-con.e-parent, .elementor-top-section')
      if (band) {
        var bcs = window.getComputedStyle(band)
        if (isBronze(bcs.backgroundColor) || isBronze(bcs.backgroundImage)) heads[h].classList.add('fit-h2--light')
      }
    }

    // Stagger siblings: any parent holding two or more revealed children.
    var revealed = document.querySelectorAll('[data-fit-reveal]')
    var seen = []
    for (var k = 0; k < revealed.length; k++) {
      var p = revealed[k].parentNode
      if (!p || seen.indexOf(p) !== -1) continue
      seen.push(p)
      var kids = []
      for (var c = 0; c < p.children.length; c++) {
        if (p.children[c].hasAttribute('data-fit-reveal')) kids.push(p.children[c])
      }
      if (kids.length < 2) continue
      for (var d = 0; d < kids.length; d++) {
        kids[d].style.setProperty('--fit-delay', Math.min(d, 7) * 75 + 'ms')
      }
    }

    return { cards: cards }
  }

  /* ------------------------------------------------------------------------
   * 2. Reveal on scroll. Anything already on screen at load reveals at once;
   *    above-the-fold content is never gated behind a scroll.
   * ---------------------------------------------------------------------- */
  var io = null

  /* delayMs: when arriving under the roofline curtain, everything is hidden
     at once (the curtain covers it) but the first screen is marked in-view
     only after the delay, so it rises as the curtain lifts. */
  function initReveal(delayMs) {
    if (!('IntersectionObserver' in window)) return

    // Set before the early return: a page with no reveal targets of ours
    // (the rebuilt /portfolio/) still wants the reading-progress hairline,
    // which this class is what shows.
    html.classList.add('fit-motion')

    var targets = document.querySelectorAll('[data-fit-reveal]')
    if (!targets.length) return

    io = new IntersectionObserver(function (entries) {
      for (var i = 0; i < entries.length; i++) {
        if (!entries[i].isIntersecting) continue
        entries[i].target.classList.add('fit-in')
        io.unobserve(entries[i].target)
      }
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.06 })

    // Anything intersecting the viewport at all counts as on screen — a
    // target whose top strip is showing must never be left hidden until the
    // visitor scrolls.
    var vh = window.innerHeight || html.clientHeight
    var onScreen = []
    for (var j = 0; j < targets.length; j++) {
      var box = targets[j].getBoundingClientRect()
      if (box.top < vh && box.bottom > 0) onScreen.push(targets[j])
      else io.observe(targets[j])
    }
    function mark() {
      for (var m = 0; m < onScreen.length; m++) onScreen[m].classList.add('fit-in')
    }
    if (delayMs) setTimeout(mark, delayMs)
    else mark()

    // A keyboard user can Tab onto a link inside a target that has not
    // scrolled into view yet; reveal it at once, without the fade, so focus
    // never sits on something invisible.
    document.addEventListener('focusin', function (e) {
      var t = e.target && e.target.closest ? e.target.closest('[data-fit-reveal]:not(.fit-in)') : null
      if (!t) return
      t.style.setProperty('--fit-delay', '0ms')
      t.classList.add('fit-in-now')
      t.classList.add('fit-in')
      /* Resolve the revealed style while transitions are still switched off,
         then drop the class in the same tick. It cannot be deferred to a rAF:
         those run before style recalc, so the fade would come back and focus
         would sit on something mid-animation after all. Left on, the class's
         `transition: none !important` is unconditional and would kill this
         element's hover lift and tilt spring-back for the life of the page. */
      void t.offsetWidth
      t.classList.remove('fit-in-now')
      if (io) io.unobserve(t)
    })
  }

  /* ------------------------------------------------------------------------
   * 3. The hero photograph on its own layer.
   *
   * The first page container carrying a cover photograph (not a pattern
   * tile) is the hero. Its background is moved onto a child layer that the
   * stylesheet drifts and this script parallaxes; the container's own
   * background is switched off with a rule keyed to Elementor's generated
   * class, discovered at runtime, so the swap survives Elementor re-applying
   * inline styles after load.
   * ---------------------------------------------------------------------- */
  var hero = null
  var heroLayer = null

  function initHero() {
    var page = document.querySelector('[data-elementor-type="wp-page"], [data-elementor-type="single-page"], .elementor-location-single, main')
    if (!page) return
    var cands = page.querySelectorAll('.e-con.e-parent, .elementor-top-section')
    for (var i = 0; i < cands.length; i++) {
      var el = cands[i]
      var cs = window.getComputedStyle(el)
      var bg = cs.backgroundImage || ''
      if (bg === 'none' || bg.indexOf('url(') === -1) continue
      if (/pattern/i.test(bg)) continue
      if (cs.backgroundSize !== 'cover') continue

      // No generated class to key the background-off rule to: this candidate
      // is unusable, but the next one may not be.
      var id = (el.className || '').toString().match(/elementor-element-[0-9a-z]+/)
      if (!id) continue

      var st = document.createElement('style')
      st.setAttribute('data-fit-hero', id[0])
      st.textContent = '.' + id[0] + '{background-image:none!important}'
      document.head.appendChild(st)

      var layer = document.createElement('div')
      layer.className = 'fit-hero-bg'
      layer.setAttribute('aria-hidden', 'true')
      var mover = document.createElement('div')
      mover.className = 'fit-hero-bg__move'
      var img = document.createElement('div')
      img.className = 'fit-hero-bg__img'
      img.style.backgroundImage = bg
      img.style.backgroundPosition = cs.backgroundPosition || 'center'
      mover.appendChild(img)
      layer.appendChild(mover)
      el.insertBefore(layer, el.firstChild)
      el.classList.add('fit-hero')

      // Pause the drift while the hero is off screen.
      if ('IntersectionObserver' in window) {
        new IntersectionObserver(function (en) {
          el.classList.toggle('fit-hero--idle', !en[0].isIntersecting)
        }, { threshold: 0 }).observe(el)
      }

      hero = el
      heroLayer = layer
      return
    }
  }

  /* ------------------------------------------------------------------------
   * 4. Scroll: reading progress, hero parallax, scroll-cue state. One
   *    rAF-throttled listener writes a handful of custom properties.
   * ---------------------------------------------------------------------- */
  function initScroll() {
    if (!document.querySelector('.fit-progress')) {
      var bar = document.createElement('div')
      bar.className = 'fit-progress'
      bar.setAttribute('aria-hidden', 'true')
      document.body.appendChild(bar)
    }

    var ticking = false
    function update() {
      ticking = false
      var se = document.scrollingElement || html
      var y = se.scrollTop || window.pageYOffset || 0
      var max = (se.scrollHeight - se.clientHeight) || 1
      // Every layout read happens before the first write. --fit-scroll is an
      // inherited property on the root, so writing it dirties style for the
      // whole tree; reading the hero's height afterwards would force a
      // synchronous recalc on every single scroll frame.
      var h = (hero && heroLayer) ? (hero.offsetHeight || 1) : 0

      html.style.setProperty('--fit-scroll', Math.min(1, Math.max(0, y / max)).toFixed(4))
      html.classList.toggle('fit-scrolled', y > 40)

      if (h && y < h * 1.25) {
        // The photograph trails the page at a fraction of its speed. The cap
        // is the slack the 4% scale in the CSS provides above the box (half
        // of 4%), so an edge can never show.
        var py = Math.min(y * 0.22, h * 0.02)
        heroLayer.style.setProperty('--fit-hero-y', py.toFixed(1) + 'px')
        html.style.setProperty('--fit-owner-y', (y * 0.08).toFixed(1) + 'px')
      }
    }
    function onScroll() {
      if (ticking) return
      ticking = true
      window.requestAnimationFrame(update)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll, { passive: true })
    update()
  }

  /* ------------------------------------------------------------------------
   * 5. Pointer tilt on the service cards. Precise pointers only, ±5°, rect
   *    cached on enter, springs back on leave.
   * ---------------------------------------------------------------------- */
  var tilted = []

  function bindTilt(card) {
    var rect = null, raf = null, rx = 0, ry = 0, over = false

    function apply() {
      raf = null
      if (!over) { card.style.transform = ''; return }
      card.style.transform =
        'perspective(900px) rotateX(' + rx.toFixed(2) + 'deg) rotateY(' + ry.toFixed(2) + 'deg) translateY(-6px)'
    }

    function onEnter() {
      over = true
      rect = card.getBoundingClientRect()
    }
    function onMove(e) {
      if (!rect || !rect.width || !rect.height) return
      var px = Math.max(-1, Math.min(1, ((e.clientX - rect.left) / rect.width) * 2 - 1))
      var py = Math.max(-1, Math.min(1, ((e.clientY - rect.top) / rect.height) * 2 - 1))
      ry = px * 5
      rx = -py * 5
      if (!raf) raf = window.requestAnimationFrame(apply)
    }
    function onLeave() {
      over = false
      rect = null
      rx = ry = 0
      if (!raf) raf = window.requestAnimationFrame(apply)
    }

    card.addEventListener('pointerenter', onEnter)
    card.addEventListener('pointermove', onMove, { passive: true })
    card.addEventListener('pointerleave', onLeave)

    // Named rather than inline so teardown can take them off again.
    tilted.push({
      el: card,
      unbind: function () {
        if (raf) { window.cancelAnimationFrame(raf); raf = null }
        card.removeEventListener('pointerenter', onEnter)
        card.removeEventListener('pointermove', onMove)
        card.removeEventListener('pointerleave', onLeave)
      },
    })
  }

  function initTilt(cards) {
    if (!FINE || !FINE.matches) return
    for (var i = 0; i < cards.length; i++) bindTilt(cards[i])
  }

  /* ------------------------------------------------------------------------
   * 6. Page transitions.
   *
   * Leaving: an ordinary same-origin link click plays the roofline curtain
   * and then navigates. Everything that is not an ordinary page navigation is
   * left alone — modifier clicks, new tabs, downloads, tel:/mailto:, in-page
   * anchors, files, the gate, and anything a form does.
   *
   * Arriving: the inline guard in <head> has already put html.fit-arriving on
   * from the sessionStorage flag (and cleared the flag). The CSS animation
   * lifts the curtain by itself; this only drops the class afterwards.
   * ---------------------------------------------------------------------- */
  var arriving = html.classList.contains('fit-arriving')

  function initTransitions() {
    if (arriving) {
      var dropped = false
      function drop() {
        if (dropped) return
        dropped = true
        html.classList.remove('fit-arriving')
      }
      html.addEventListener('animationend', function (e) {
        if (e.animationName === 'fitCurtainLift') drop()
      })
      setTimeout(drop, 1300) // belt and braces
    }

    if (reduced()) return

    document.addEventListener('click', function (e) {
      if (reduced()) return
      if (e.defaultPrevented || e.button !== 0) return
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      var a = e.target && e.target.closest ? e.target.closest('a[href]') : null
      if (!a) return
      if (a.target && a.target !== '_self') return
      if (a.hasAttribute('download') || a.hasAttribute('data-no-transition')) return
      if (a.closest('#fit-build-gate')) return
      // SmartMenus (Elementor's nav) opens a submenu on the first tap of a
      // parent item and on its arrow; those taps must never navigate. The
      // listener is in the bubble phase so e.defaultPrevented above reflects
      // what SmartMenus decided.
      if (e.target && e.target.closest && e.target.closest('.sub-arrow')) return
      // A parent item whose sub-menu is not open: that tap is for the menu.
      var li = a.parentElement
      if (li && li.classList.contains('menu-item-has-children')) {
        var sub = li.querySelector('ul')
        if (sub && !sub.offsetHeight) return
      }
      var href = a.getAttribute('href') || ''
      if (!href || href.charAt(0) === '#') return
      if (/^(tel|mailto|sms|javascript|whatsapp):/i.test(href)) return
      var url
      try { url = new URL(a.href, location.href) } catch (err) { return }
      if (url.origin !== location.origin) return
      if (url.hash && url.pathname === location.pathname && url.search === location.search) return
      if (/\.(pdf|zip|jpe?g|png|webp|gif|svg|mp4|webm|mov|xml|txt|ics)$/i.test(url.pathname)) return

      e.preventDefault()
      try { sessionStorage.setItem(NAV_KEY, '1') } catch (err) { }
      html.classList.add('fit-leaving')
      setTimeout(function () { window.location.href = url.href }, 420)
      /* Belt and braces, the same as the arriving side has. The curtain is
         opaque and deliberately swallows clicks, and only a new document
         takes it away. A navigation that never lands — Esc, the Stop button,
         a dropped connection, a 204, a download we did not filter — replaces
         nothing and fires no pageshow, so without this the visitor is left
         staring at a bronze wall with no way back but a manual reload. */
      setTimeout(function () { html.classList.remove('fit-leaving') }, 3000)
    })
  }

  /* bfcache: a page restored from the back/forward cache is frozen exactly as
     it was left — possibly mid-curtain. Snap it clean. */
  window.addEventListener('pageshow', function (e) {
    if (!e.persisted) return
    html.classList.remove('fit-leaving')
    html.classList.remove('fit-arriving')
  })

  /* ------------------------------------------------------------------------
   * 6b. Seams between stacked pattern bands.
   *
   * Adjacent sections painting the same pattern on the same ground are meant
   * to look like one band. Two things break that, and both are Elementor's
   * defaults rather than anything we added: each section carries its own
   * background-overlay opacity, and each restarts the tiling from its own
   * box. The result is a tonal step straight across the page and a lattice
   * that jumps at the join.
   *
   * Only sections that share a ground are joined. A dark band meeting the
   * white counters band is a deliberate change of surface and is left alone.
   * ---------------------------------------------------------------------- */
  function patternSections() {
    var out = []
    var cands = document.querySelectorAll('.e-con, .elementor-top-section, section.elementor-section')
    for (var i = 0; i < cands.length; i++) {
      var el = cands[i]
      var cs = window.getComputedStyle(el)
      if ((cs.backgroundImage || '').indexOf('Pattern') === -1) continue
      // outermost only, so a nested container is not counted twice
      if (el.parentElement && el.parentElement.closest('[data-fit-pattern="1"]')) continue
      el.setAttribute('data-fit-pattern', '1')
      var r = el.getBoundingClientRect()
      out.push({
        el: el, cs: cs, before: window.getComputedStyle(el, '::before'),
        top: r.top + (window.pageYOffset || 0), h: r.height, w: r.width,
      })
    }
    return out
  }

  /* The artwork is square, so one tile is as tall as it is wide. */
  function tileHeight(s) {
    var size = (s.cs.backgroundSize || '').split(' ')[0]
    if (size.indexOf('%') > -1) return (parseFloat(size) / 100) * s.w
    var px = parseFloat(size)
    return isFinite(px) && px > 0 ? px : 0
  }

  /* Where this section's own tiling starts, measured from its top edge. */
  function tileOrigin(s, tile) {
    var posY = (s.cs.backgroundPosition || '50% 50%').split(' ')[1] || '50%'
    if (posY.indexOf('%') > -1) return (s.h - tile) * (parseFloat(posY) / 100)
    var px = parseFloat(posY)
    return isFinite(px) ? px : 0
  }

  /* Undo the previous pass before measuring again.

     This is load-bearing rather than tidiness: tileOrigin reads the computed
     background-position of whichever section starts a run, and if a band that
     was joined at the old width becomes a run start at the new one, the stale
     inline pixel value would be read back as though it were the stylesheet's
     own origin — a worse offset than doing nothing. */
  function clearSeams() {
    var done = document.querySelectorAll('[data-fit-pattern="1"]')
    for (var i = 0; i < done.length; i++) {
      done[i].removeAttribute('data-fit-pattern')
      done[i].classList.remove('fit-seam')
      done[i].style.removeProperty('--fit-seam-op')
      done[i].style.backgroundPositionY = ''
    }
  }

  function initSeams() {
    clearSeams()
    var pat = patternSections()
    var runOrigin = null, runOpacity = null, runId = 0
    for (var i = 0; i < pat.length; i++) {
      var cur = pat[i]
      var prev = i > 0 ? pat[i - 1] : null
      var tile = tileHeight(cur)
      var joins = !!prev && tile > 0 &&
        Math.abs(cur.top - (prev.top + prev.h)) <= 4 &&
        prev.cs.backgroundColor === cur.cs.backgroundColor &&
        prev.before.backgroundColor === cur.before.backgroundColor

      if (!joins) {
        // A new run starts here. The id is what lets the hover effect treat
        // a merged pair as one surface rather than two.
        runId++
        cur.el.setAttribute('data-fit-run', 'r' + runId)
        runOrigin = tile > 0 ? tileOrigin(cur, tile) : 0
        runOpacity = cur.before.opacity
        continue
      }
      cur.el.setAttribute('data-fit-run', 'r' + runId)

      // Carry the previous section's tiling across the join.
      var origin = runOrigin - prev.h
      origin = ((origin % tile) + tile) % tile
      if (origin > 0) origin -= tile
      cur.el.style.backgroundPositionY = origin.toFixed(2) + 'px'

      // And match the overlay, which is what actually shows as a step.
      cur.el.classList.add('fit-seam')
      cur.el.style.setProperty('--fit-seam-op', runOpacity)

      runOrigin = origin
    }

    /* The hover layer draws a magnified copy of the pattern, and the copy has
       to sit on the same grid as the real one underneath it or the two double
       into a blur rather than reading as depth. Its position is a snapshot,
       so it is refreshed at the end of every pass rather than only where it
       is first written: bands are measured at DOMContentLoaded, before images
       and the font swap settle their heights, so the offsets applied above
       are frequently not the ones the lattice captured — measured half a tile
       out on four of the five bands of /about/. */
    var lat = document.querySelectorAll('[data-fit-lattice="1"]')
    for (var n = 0; n < lat.length; n++) {
      lat[n].style.setProperty('--fit-lat-pos', window.getComputedStyle(lat[n]).backgroundPosition)
    }
  }

  /* ------------------------------------------------------------------------
   * 7. The lattice dimple.
   *
   * The bronze diamond pattern backs ~42 sections across the site. Under the
   * pointer the surface presses in; a click lands like a hailstone. All the
   * drawing is in fit-motion.css — this only finds the sections, hands the
   * stylesheet the pattern it is already painting, and feeds it coordinates.
   *
   * Precise pointers only: on a touch screen there is no hover to follow,
   * and a dimple that appears under a tap and stays is just a smudge.
   * ---------------------------------------------------------------------- */
  var lattices = []
  var runs = []

  /* One run of merged bands is one hover surface.
   *
   * Each layer is clipped to its own section, so a glow driven only by the
   * section under the pointer stopped dead at an internal boundary and the
   * circle came out sliced in half — which is exactly what a merged pair
   * must not do. Every layer in the run is now given the same point on the
   * page, expressed relative to its own box, and shows whatever part of the
   * circle falls inside it. The pieces line up into one circle across the
   * join. Coordinates are kept in viewport space for that reason. */
  function bindLattice(run) {
    var raf = null, vx = 0, vy = 0, lit = false

    function write() {
      raf = null
      for (var i = 0; i < run.length; i++) {
        // Read the rect here rather than caching it on enter: the page can
        // scroll between one pointer frame and the next, so a cached rect
        // would already be stale by that distance on the very next move.
        var r = run[i].el.getBoundingClientRect()
        run[i].layer.style.setProperty('--fit-mx', (vx - r.left) + 'px')
        run[i].layer.style.setProperty('--fit-my', (vy - r.top) + 'px')
      }
    }

    function setLit(on) {
      lit = on
      for (var i = 0; i < run.length; i++) {
        run[i].el.classList[on ? 'add' : 'remove']('is-dimpled')
      }
    }

    /* The pointer holds still and the page moves instead. Chrome dispatches
       no pointermove for a wheel scroll, so without this the coordinates
       freeze while the band slides out from under the cursor, and the glow
       is left behind by exactly how far you scrolled — while the band is
       still lit. That is the most ordinary interaction on the site: reading
       a page with the pointer resting on it. The coordinates are already in
       viewport space, so re-running write against the fresh rects is the
       whole fix. An unlit run costs one predicate per scroll event. */
    function onView() {
      if (!lit || raf) return
      raf = window.requestAnimationFrame(write)
    }

    function inRun(node) {
      if (!node) return false
      for (var i = 0; i < run.length; i++) {
        if (run[i].el === node || run[i].el.contains(node)) return true
      }
      return false
    }

    window.addEventListener('scroll', onView, { passive: true })
    window.addEventListener('resize', onView, { passive: true })

    for (var m = 0; m < run.length; m++) {
      (function (member) {
        function onEnter(e) {
          if (e.pointerType === 'touch') return
          vx = e.clientX
          vy = e.clientY
          write()
          setLit(true)
        }

        function onMove(e) {
          if (e.pointerType === 'touch') return
          vx = e.clientX
          vy = e.clientY
          if (!raf) raf = window.requestAnimationFrame(write)
        }

        function onLeave(e) {
          // Crossing into another band of the same run is not leaving it.
          if (inRun(e.relatedTarget)) return
          setLit(false)
        }

        /* The hailstone lands in the band that was actually clicked.
           Anything that is a control keeps its click to itself. */
        function onDown(e) {
          if (e.pointerType === 'touch' || e.button !== 0) return
          if (e.target && e.target.closest &&
              e.target.closest('a, button, input, textarea, select, label, [role="button"]')) return
          var r = member.el.getBoundingClientRect()
          var ring = document.createElement('span')
          ring.className = 'fit-strike'
          ring.setAttribute('aria-hidden', 'true')
          ring.style.setProperty('--fit-sx', (e.clientX - r.left) + 'px')
          ring.style.setProperty('--fit-sy', (e.clientY - r.top) + 'px')
          ring.addEventListener('animationend', function () {
            if (ring.parentNode) ring.parentNode.removeChild(ring)
          })
          member.layer.appendChild(ring)
        }

        member.el.addEventListener('pointerenter', onEnter)
        member.el.addEventListener('pointermove', onMove, { passive: true })
        member.el.addEventListener('pointerleave', onLeave)
        member.el.addEventListener('pointerdown', onDown)

        /* teardown has to be able to undo this. Nothing of it is visible once
           the layers are gone, but a live pointerdown keeps appending strike
           rings to a layer that is no longer in the document — where they
           never animate, so animationend never fires and nothing ever removes
           them. One leaked node per click, for the rest of the session. */
        member.unbind = function () {
          member.el.removeEventListener('pointerenter', onEnter)
          member.el.removeEventListener('pointermove', onMove)
          member.el.removeEventListener('pointerleave', onLeave)
          member.el.removeEventListener('pointerdown', onDown)
        }

        lattices.push(member)
      })(run[m])
    }

    // One entry per run, not per member: the view listeners and the pending
    // frame belong to the whole surface.
    runs.push({
      unbind: function () {
        lit = false
        if (raf) { window.cancelAnimationFrame(raf); raf = null }
        window.removeEventListener('scroll', onView)
        window.removeEventListener('resize', onView)
      },
    })
  }

  function initLattice() {
    if (!FINE || !FINE.matches) return
    var built = []
    var cands = document.querySelectorAll('.e-con, .elementor-top-section, section.elementor-section')
    for (var i = 0; i < cands.length; i++) {
      var el = cands[i]
      if (el.getAttribute('data-fit-lattice') === '1') continue
      var cs = window.getComputedStyle(el)
      var bg = cs.backgroundImage || ''
      if (bg.indexOf('Pattern') === -1) continue
      // Only the outermost section of a nest gets it: a dimple inside a
      // dimple would double every shadow.
      if (el.parentElement && el.parentElement.closest('[data-fit-lattice="1"]')) continue

      /* Dark bands only. The white counters band was tried five ways — a
         shadow-and-rim hollow, brightness, contrast, and registering the
         copy exactly — and every one of them read as a smudge rather than a
         deliberate light. The lattice there is dark bronze on near-white:
         there is no headroom to lift it, so each attempt only dirtied the
         paper. Where the pattern is pale on near-black, which is almost
         every band on this site, the same treatment reads like lit metal.
         So it runs there and leaves the light bands alone. */
      var rgb = (cs.backgroundColor || '').match(/\d+/g)
      var lum = rgb && rgb.length >= 3
        ? (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255
        : 0
      if (lum > 0.5) continue

      el.setAttribute('data-fit-lattice', '1')
      el.classList.add('fit-lattice')
      // Recorded so teardown puts back only what this script changed.
      var posFix = cs.position === 'static'
      if (posFix) el.style.position = 'relative'

      // The lines are the only light on a dark band, so they are turned up
      // until the pattern reads like lit metal.
      el.style.setProperty('--fit-lat-lit', 'rgba(226, 186, 130, .14)')
      el.style.setProperty('--fit-lat-filter', 'brightness(2.5) saturate(1.3)')
      // Hand the stylesheet the pattern this section is already painting,
      // at the size and offset it is already painting it, so the magnified
      // copy lines up with the real one underneath.
      el.style.setProperty('--fit-lat-img', bg)
      el.style.setProperty('--fit-lat-size', cs.backgroundSize)
      el.style.setProperty('--fit-lat-pos', cs.backgroundPosition)

      var layer = document.createElement('div')
      layer.className = 'fit-lattice-dimple'
      layer.setAttribute('aria-hidden', 'true')
      el.insertBefore(layer, el.firstChild)

      /* The layer sits at z-index 0 so it clears Elementor's overlay. Its
         siblings are in-flow, which would paint them *below* a positioned
         layer, so they are lifted into the positioned layer too — being
         later in the DOM, they land above it. Nothing moves: position
         relative with no offsets changes no geometry. */
      var lifted = []
      for (var c = 0; c < el.children.length; c++) {
        var kid = el.children[c]
        if (kid === layer) continue
        if (window.getComputedStyle(kid).position === 'static') {
          kid.style.position = 'relative'
          lifted.push(kid)
        }
      }

      built.push({
        el: el, layer: layer, posFix: posFix, lifted: lifted,
        run: el.getAttribute('data-fit-run') || ('solo' + i),
      })
    }

    // Group the layers by the run initSeams worked out, then bind one hover
    // surface per run. A band that was never merged is a run of one, so this
    // is the same code path either way.
    var byRun = {}
    for (var g = 0; g < built.length; g++) {
      var key = built[g].run
      if (!byRun[key]) byRun[key] = []
      byRun[key].push(built[g])
    }
    for (var runKey in byRun) {
      if (Object.prototype.hasOwnProperty.call(byRun, runKey)) bindLattice(byRun[runKey])
    }
  }

  /* ------------------------------------------------------------------------
   * 8. Teardown: the visitor turned reduced motion on mid-session.
   * ---------------------------------------------------------------------- */
  var LAT_PROPS = ['--fit-lat-lit', '--fit-lat-filter', '--fit-lat-img', '--fit-lat-size', '--fit-lat-pos']

  function teardown() {
    html.classList.remove('fit-motion')
    if (io) { io.disconnect(); io = null }

    for (var i = 0; i < tilted.length; i++) {
      tilted[i].unbind()
      tilted[i].el.style.transform = ''
    }
    tilted = []

    for (var r = 0; r < runs.length; r++) runs[r].unbind()
    runs = []

    // Put the section back the way it was found: the listeners off, the
    // classes and custom properties gone, and position restored only on the
    // elements this script actually moved off static.
    for (var j = 0; j < lattices.length; j++) {
      var m = lattices[j]
      if (m.unbind) m.unbind()
      m.el.classList.remove('is-dimpled')
      m.el.classList.remove('fit-lattice')
      m.el.removeAttribute('data-fit-lattice')
      for (var p = 0; p < LAT_PROPS.length; p++) m.el.style.removeProperty(LAT_PROPS[p])
      if (m.posFix) m.el.style.position = ''
      for (var k = 0; k < m.lifted.length; k++) m.lifted[k].style.position = ''
      if (m.layer.parentNode) m.layer.parentNode.removeChild(m.layer)
    }
    lattices = []
  }

  /* ------------------------------------------------------------------------
   * Boot
   * ---------------------------------------------------------------------- */
  function boot() {
    initTransitions()
    /* Not motion: a seam is wrong whether or not the visitor wants movement,
       so this and its listeners sit before the reduced-motion return.

       Both inputs to the offset are viewport-dependent — the tile is 20% of
       the section's width, and the carry is the previous band's measured
       height — so a pixel value is only correct at the width it was measured
       at. Without this, a window drag, a zoom step or a phone rotation
       reinstates the exact tile break initSeams exists to remove, and it
       stays broken until the next navigation. `load` covers the other half:
       bands are measured at DOMContentLoaded, before late images and the
       font swap have settled their heights.

       Known limit, deliberately left: initSeams re-assigns data-fit-run, but
       bindLattice captured its groups at boot, so a run that newly forms or
       breaks at a different width keeps its old hover grouping until reload.
       That is a glow stopping at one join, not a visible break in the page. */
    initSeams()
    var seamT = null
    function reseam() {
      clearTimeout(seamT)
      seamT = setTimeout(initSeams, 150)
    }
    window.addEventListener('resize', reseam, { passive: true })
    window.addEventListener('orientationchange', reseam)
    window.addEventListener('load', reseam)

    if (reduced()) return

    var found = tagTargets()
    initHero()
    initScroll()
    initTilt(found.cards)
    initLattice()

    // Arriving under the curtain: hide now (the curtain covers it) and mark
    // the first screen a beat later, so it rises as the roofline lifts.
    initReveal(arriving ? 340 : 0)

    if (REDUCED) {
      var onChange = function (e) { if (e.matches) teardown() }
      if (REDUCED.addEventListener) REDUCED.addEventListener('change', onChange)
      else if (REDUCED.addListener) REDUCED.addListener(onChange)
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true })
  } else {
    boot()
  }
})()
