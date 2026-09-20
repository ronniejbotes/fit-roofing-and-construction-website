/*
 * Fit Roofing — homepage bundle: the "Build it the F.I.T. way" gate, and the
 * hero's owner portrait, glow and scroll cue. Loaded on / only, with `defer`,
 * right before </body> — the body is parsed but not yet painted, which is the
 * last moment the gate can appear without the page flashing behind it.
 *
 * Ported from the In The Light Roofing gate (overrides/overrides.js there).
 * Every failure path lets the visitor in: reduced motion, a refused play(),
 * a missing file, a stalled download, Escape, Skip, and a failsafe timer set
 * from the clip's real duration.
 *
 * All copy on the gate is the company's own: "Foundation. Integrity. Trust."
 * is what F.I.T. stands for and is written into the logo; "built the F.I.T.
 * way" is the homepage's own line. Nothing was invented.
 */
(function () {
  'use strict'

  var GATE_VIDEO = '/assets/gate/build-gate'           // .webm and .mp4 appended
  var GATE_POSTER = '/assets/gate/build-gate-poster.jpg'
  var GATE_FAILSAFE_MS = 7600                           // replaced from loadedmetadata
  var GATE_KEY = 'fit-gate-seen'

  /* Who gets the door.
     ITLR shows it on every load and notes that is worth weighing on a site
     whose job is to move people toward a quote. This site's homepage is the
     page that ranks, and it sells emergency storm work, so the door is a
     first-arrival moment rather than a toll:
       - once per tab (a visitor who has been through is not asked again),
       - never when arriving by the site's own roofline transition (the logo,
         the Home link) — that visitor is already inside,
       - not on phones by default: a full-screen dialog between a search
         result and the phone number is exactly what Google's intrusive-
         interstitial guidance warns about, and a 16:9 clip shows a phone
         only its middle quarter anyway. Set GATE_MIN_WIDTH to 0 for every
         width. */
  var GATE_ONCE_PER_SESSION = true
  var GATE_MIN_WIDTH = 768

  var KICKER = 'Foundation. Integrity. Trust.'
  var BTN_TEXT = 'Build it the F.I.T. way'

  var gateBuilt = false

  function isLandingPage() {
    var p = (location.pathname || '/').replace(/\/+$/, '')
    return p === '' || p === '/index.html'
  }

  function reducedMotion() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  }

  function gateAlreadySeen() {
    if (!GATE_ONCE_PER_SESSION) return false
    try { return sessionStorage.getItem(GATE_KEY) === '1' } catch (e) { return false }
  }

  /* ------------------------------------------------------------------------
   * Replay the hero's entrance once the gate lets the visitor through.
   * Elementor fires its fadeIn animations at load, behind the gate, so by the
   * time anyone sees the page they have long finished. Re-running them — and
   * our own reveals and headline rule — makes the page arrive on the beat the
   * crossfade lands.
   * ---------------------------------------------------------------------- */
  function replayHeroEntrance() {
    var hero = document.querySelector('.fit-hero')
    if (!hero) return

    var animated = hero.querySelectorAll('.animated')
    for (var i = 0; i < animated.length; i++) {
      var el = animated[i]
      var names = []
      for (var c = 0; c < el.classList.length; c++) {
        var n = el.classList[c]
        if (n === 'animated' || /^(fade|slide|zoom|bounce|flip|light|roll|rotate)/i.test(n)) names.push(n)
      }
      if (!names.length) continue
      ;(function (node, list) {
        for (var k = 0; k < list.length; k++) node.classList.remove(list[k])
        void node.offsetWidth
        for (var m = 0; m < list.length; m++) node.classList.add(list[m])
      })(el, names)
    }

    var revealed = hero.querySelectorAll('[data-fit-reveal].fit-in')
    for (var r = 0; r < revealed.length; r++) revealed[r].classList.remove('fit-in')
    var rule = hero.querySelector('.fit-h1')
    if (rule) { rule.classList.remove('fit-h1'); void rule.offsetWidth }
    window.requestAnimationFrame(function () {
      window.requestAnimationFrame(function () {
        for (var r2 = 0; r2 < revealed.length; r2++) revealed[r2].classList.add('fit-in')
        if (rule) rule.classList.add('fit-h1')
      })
    })
  }

  function buildGate() {
    if (gateBuilt) return false
    gateBuilt = true

    if (!isLandingPage()) return false
    if (reducedMotion()) return false
    if (gateAlreadySeen()) return false
    if (document.documentElement.classList.contains('fit-arriving')) return false
    if (GATE_MIN_WIDTH && (window.innerWidth || 0) < GATE_MIN_WIDTH) return false
    if (!document.body) return false

    var gate = document.createElement('div')
    gate.id = 'fit-build-gate'
    gate.setAttribute('data-state', 'closed')
    gate.setAttribute('role', 'dialog')
    gate.setAttribute('aria-modal', 'true')
    gate.setAttribute('aria-label', BTN_TEXT)
    gate.setAttribute('tabindex', '-1')

    // Frame 0 of the clip itself, so the cut into motion is invisible.
    var poster = document.createElement('img')
    poster.className = 'fit-gate-media fit-gate-poster'
    poster.src = GATE_POSTER
    poster.alt = ''
    poster.setAttribute('aria-hidden', 'true')
    poster.setAttribute('decoding', 'async')
    gate.appendChild(poster)

    var v = document.createElement('video')
    v.className = 'fit-gate-media fit-gate-video'
    v.muted = true
    v.playsInline = true
    v.setAttribute('muted', '')
    v.setAttribute('playsinline', '')
    v.setAttribute('preload', 'none')
    v.setAttribute('poster', GATE_POSTER)
    v.setAttribute('aria-hidden', 'true')
    v.setAttribute('tabindex', '-1')
    gate.appendChild(v)

    var ui = document.createElement('div')
    ui.className = 'fit-gate-ui'
    var kicker = document.createElement('p')
    kicker.className = 'fit-gate-kicker'
    kicker.textContent = KICKER
    ui.appendChild(kicker)
    var btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'fit-gate-btn'
    btn.textContent = BTN_TEXT
    ui.appendChild(btn)
    gate.appendChild(ui)

    var skip = document.createElement('button')
    skip.type = 'button'
    skip.className = 'fit-gate-skip'
    skip.textContent = 'Skip'
    gate.appendChild(skip)

    document.body.appendChild(gate)

    // Every arrival starts at the top, behind the gate.
    try { window.scrollTo({ top: 0, left: 0, behavior: 'instant' }) }
    catch (e) { window.scrollTo(0, 0) }

    document.documentElement.classList.add('fit-gate-open')

    /* Anything position:fixed that appears while the gate is up (the chat
       launcher loads on its own timer) is marked so the stylesheet can keep it
       under the gate. Our own elements are skipped. */
    var mo = null
    if ('MutationObserver' in window) {
      mo = new MutationObserver(function (records) {
        for (var i = 0; i < records.length; i++) {
          var added = records[i].addedNodes
          for (var j = 0; j < added.length; j++) {
            var n = added[j]
            if (n.nodeType !== 1 || n === gate || gate.contains(n)) continue
            if (n.classList && (n.classList.contains('fit-progress') || n.classList.contains('fit-scroll-cue'))) continue
            var pos = window.getComputedStyle(n).position
            if (pos === 'fixed') n.setAttribute('data-fit-under-gate', '1')
          }
        }
      })
      mo.observe(document.body, { childList: true })
    }

    /* Belt and braces on the scroll lock — see fit-home.css. Non-passive, or
       preventDefault is ignored. Scroll keys are never blocked while a button
       has focus: Space on a focused button is how a keyboard user presses it. */
    var SCROLL_KEYS = {
      ' ': 1, 'Spacebar': 1, 'PageDown': 1, 'PageUp': 1,
      'End': 1, 'Home': 1, 'ArrowDown': 1, 'ArrowUp': 1
    }
    function blockScroll(e) { e.preventDefault() }
    function blockScrollKeys(e) {
      var t = e.target
      if (t && (t.tagName === 'BUTTON' || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return
      if (SCROLL_KEYS[e.key]) e.preventDefault()
    }
    document.addEventListener('wheel', blockScroll, { passive: false })
    document.addEventListener('touchmove', blockScroll, { passive: false })
    document.addEventListener('keydown', blockScrollKeys, { passive: false })

    /* The dialog is modal, so the page behind it must be neither reachable
       by Tab nor read by a screen reader: every other child of <body> is
       made inert for the duration. Browsers without `inert` fall back to the
       Tab wrap below, which keeps focus on the two buttons. */
    var inerted = []
    for (var bi = 0; bi < document.body.children.length; bi++) {
      var kid = document.body.children[bi]
      if (kid === gate || kid.hasAttribute('inert')) continue
      kid.setAttribute('inert', '')
      inerted.push(kid)
    }
    function trapTab(e) {
      if (e.key !== 'Tab') return
      var stops = [btn, skip].filter(function (el) { return el.tabIndex >= 0 && !el.disabled })
      if (!stops.length) { e.preventDefault(); return }
      var first = stops[0], last = stops[stops.length - 1]
      var at = document.activeElement
      if (e.shiftKey && (at === first || at === gate)) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && (at === last || at === gate && stops.length === 1)) { e.preventDefault(); first.focus() }
    }
    gate.addEventListener('keydown', trapTab)

    var failsafe = null
    var done = false

    function onKey(e) {
      if (e.key === 'Escape' || e.keyCode === 27) finish()
    }

    /* Everything the gate attached outside itself comes off here, and only
       here — finish() and the bfcache handler both route through it, so a
       page restored mid-gate can never keep the scroll blockers. */
    function teardown() {
      if (failsafe) clearTimeout(failsafe)
      failsafe = null
      if (mo) mo.disconnect()
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('wheel', blockScroll, { passive: false })
      document.removeEventListener('touchmove', blockScroll, { passive: false })
      document.removeEventListener('keydown', blockScrollKeys, { passive: false })
      gate.removeEventListener('keydown', trapTab)
      for (var i = 0; i < inerted.length; i++) inerted[i].removeAttribute('inert')
      inerted = []
      document.documentElement.classList.remove('fit-gate-open')
      var marked = document.querySelectorAll('[data-fit-under-gate]')
      for (var m = 0; m < marked.length; m++) marked[m].removeAttribute('data-fit-under-gate')
      window.removeEventListener('load', arm)
      try { v.pause() } catch (e) { }
    }

    function finish() {
      if (done) return
      done = true
      teardown()
      gate.setAttribute('data-state', 'done')
      try { sessionStorage.setItem(GATE_KEY, '1') } catch (e) { }
      replayHeroEntrance()
      // Hand focus to the page: the headline, without painting a ring.
      var target = document.querySelector('.fit-hero h1, main h1, h1')
      if (target) {
        if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1')
        target.classList.add('fit-focus-target')
        try { target.focus({ preventScroll: true }) } catch (e) { }
      }
      // Let the crossfade finish, then take it out of the tree entirely so it
      // cannot swallow clicks or hold a decoded video frame in memory.
      setTimeout(function () {
        if (gate.parentNode) gate.parentNode.removeChild(gate)
      }, 800)
    }
    gate.__fitFinish = finish

    function start() {
      if (gate.getAttribute('data-state') !== 'closed') return
      gate.setAttribute('data-state', 'playing')
      // The button fades out; it must not keep focus while invisible.
      btn.tabIndex = -1
      btn.setAttribute('aria-hidden', 'true')
      try { gate.focus({ preventScroll: true }) } catch (e) { }
      // A click before window load is the strongest possible signal to
      // fetch: play() on a source-less video would hang, then be rejected
      // the moment sources arrived, and that rejection would close the gate.
      arm()
      var p = v.play()
      if (p && p.catch) {
        // Playback refused, or the file never arrived. Never strand somebody
        // behind a video that is not going to play.
        p.catch(finish)
      }
      failsafe = setTimeout(finish, GATE_FAILSAFE_MS)
    }

    btn.addEventListener('click', start)
    skip.addEventListener('click', finish)
    v.addEventListener('ended', finish)
    v.addEventListener('error', finish)
    // Size the failsafe from the real clip rather than a number in this file.
    v.addEventListener('loadedmetadata', function () {
      if (isFinite(v.duration) && v.duration > 0) {
        GATE_FAILSAFE_MS = Math.round(v.duration * 1000) + 2500
      }
    })
    document.addEventListener('keydown', onKey)

    /* Focus the dialog, not the button, per the ARIA modal pattern — and so
       Chrome does not paint a keyboard focus ring on a programmatic focus. */
    try { gate.focus({ preventScroll: true }) } catch (e) { }

    // Only now go and fetch it. The homepage has first claim on the connection
    // and there is nothing to see here until somebody clicks.
    function arm() {
      if (done) return // skipped or finished: the clip is never fetched
      if (v.getElementsByTagName('source').length) return
      v.innerHTML = '<source src="' + GATE_VIDEO + '.webm" type="video/webm">'
        + '<source src="' + GATE_VIDEO + '.mp4" type="video/mp4">'
      v.setAttribute('preload', 'auto')
      v.load()
    }
    if (document.readyState === 'complete') arm()
    else window.addEventListener('load', arm)

    return true
  }

  /* ------------------------------------------------------------------------
   * The hero: owner glow, headline rule, scroll cue. Runs after fit-motion.js
   * has tagged .fit-hero (it is included first and both are deferred, so
   * order is guaranteed), but degrades to nothing if it has not.
   * ---------------------------------------------------------------------- */
  function initHero() {
    var hero = document.querySelector('.fit-hero')
    if (!hero) return

    // The owner's portrait: the cut-out image inside the hero. Found by the
    // filename first, then by the first image widget, never by element id.
    var img = hero.querySelector('.elementor-widget-image img[src*="owner" i]') ||
              hero.querySelector('.elementor-widget-image img')
    if (img) {
      var widget = img.closest('.elementor-widget-image')
      // Elementor already fades this in with its container, and the parallax
      // below needs the transform for itself — so it is never a reveal target.
      if (widget) { widget.removeAttribute('data-fit-reveal'); widget.classList.remove('fit-in') }
      var con = widget && widget.parentNode
      if (con && !con.querySelector('.fit-owner-glow')) {
        con.classList.add('fit-owner')
        var glow = document.createElement('div')
        glow.className = 'fit-owner-glow'
        glow.setAttribute('aria-hidden', 'true')
        con.insertBefore(glow, con.firstChild)
      }
    }

    var h1 = hero.querySelector('h1')
    if (h1) {
      h1.classList.add('fit-h1')
      if (window.getComputedStyle(h1).textAlign === 'center') h1.classList.add('fit-h1--center')
    }

    if (!hero.querySelector('.fit-scroll-cue')) {
      var cue = document.createElement('a')
      cue.className = 'fit-scroll-cue'
      cue.href = '#'
      cue.setAttribute('aria-label', 'Scroll to the next section')
      cue.setAttribute('data-no-transition', '')
      cue.addEventListener('click', function (e) {
        e.preventDefault()
        var next = hero.nextElementSibling
        if (next && next.scrollIntoView) {
          next.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' })
        }
      })
      hero.appendChild(cue)
    }
  }

  // bfcache: coming back to a page frozen mid-gate must never leave the
  // visitor scroll-locked behind a hidden overlay.
  window.addEventListener('pageshow', function (e) {
    if (!e.persisted) return
    var g = document.getElementById('fit-build-gate')
    if (g) {
      // Through the real finish, so the scroll blockers, the inert marks and
      // the observer all come off — not just the node.
      if (typeof g.__fitFinish === 'function') g.__fitFinish()
      if (g.parentNode) g.parentNode.removeChild(g)
    }
    document.documentElement.classList.remove('fit-gate-open')
  })

  buildGate()

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initHero, { once: true })
  } else {
    initHero()
  }
})()
