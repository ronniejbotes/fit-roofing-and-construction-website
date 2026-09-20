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

      var id = (el.className || '').toString().match(/elementor-element-[0-9a-z]+/)
      if (!id) return

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
      html.style.setProperty('--fit-scroll', Math.min(1, Math.max(0, y / max)).toFixed(4))
      html.classList.toggle('fit-scrolled', y > 40)

      if (hero && heroLayer) {
        var h = hero.offsetHeight || 1
        if (y < h * 1.25) {
          // The photograph trails the page at a fraction of its speed. The
          // cap is the slack the 4% scale in the CSS provides above the box
          // (half of 4%), so an edge can never show.
          var py = Math.min(y * 0.22, h * 0.02)
          heroLayer.style.setProperty('--fit-hero-y', py.toFixed(1) + 'px')
          html.style.setProperty('--fit-owner-y', (y * 0.08).toFixed(1) + 'px')
        }
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

    card.addEventListener('pointerenter', function () {
      over = true
      rect = card.getBoundingClientRect()
    })
    card.addEventListener('pointermove', function (e) {
      if (!rect || !rect.width || !rect.height) return
      var px = Math.max(-1, Math.min(1, ((e.clientX - rect.left) / rect.width) * 2 - 1))
      var py = Math.max(-1, Math.min(1, ((e.clientY - rect.top) / rect.height) * 2 - 1))
      ry = px * 5
      rx = -py * 5
      if (!raf) raf = window.requestAnimationFrame(apply)
    }, { passive: true })
    card.addEventListener('pointerleave', function () {
      over = false
      rect = null
      rx = ry = 0
      if (!raf) raf = window.requestAnimationFrame(apply)
    })
    tilted.push(card)
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
   * 7. Teardown: the visitor turned reduced motion on mid-session.
   * ---------------------------------------------------------------------- */
  function teardown() {
    html.classList.remove('fit-motion')
    if (io) { io.disconnect(); io = null }
    for (var i = 0; i < tilted.length; i++) tilted[i].style.transform = ''
  }

  /* ------------------------------------------------------------------------
   * Boot
   * ---------------------------------------------------------------------- */
  function boot() {
    initTransitions()
    if (reduced()) return

    var found = tagTargets()
    initHero()
    initScroll()
    initTilt(found.cards)

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
