/*
 * Fit Roofing — /portfolio/ behaviour. See assets/fit-portfolio.css.
 *
 * Ports of the template's five components, dependency-free:
 *   FadeIn        [data-fp-fade]    whileInView once, per-element delay/x/y/duration
 *   Magnet        [data-fp-magnet]  pointer-following portrait, precise pointers only
 *   Marquee       [data-fp-row]     two rows driven by the page scroll position
 *   AnimatedText  [data-fp-chars]   character opacity 0.2 → 1 across a scroll range
 *   CardStack     .fp-stack         sticky cards that settle back in scale as they stack
 *
 * Content ships visible; html.fp-motion (added here, never by markup) is the
 * only thing that hides anything. Reduced motion: no class, no listeners.
 * Videos play only while on screen.
 */
(function () {
  'use strict'

  var html = document.documentElement
  var root = document.querySelector('main.fp')
  if (!root) return

  var REDUCED = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null
  var FINE = window.matchMedia ? window.matchMedia('(pointer: fine)') : null
  function reduced() { return !!(REDUCED && REDUCED.matches) }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v }

  /* ------------------------------------------------------------------------
   * Header height → --fp-header (the hero is the viewport minus it, and the
   * sticky cards sit beneath it). Re-measured on resize.
   * ---------------------------------------------------------------------- */
  function measureHeader() {
    var h = document.querySelector('.elementor-location-header, header')
    var px = h ? Math.round(h.getBoundingClientRect().height) : 100
    if (px > 0 && px < 400) root.style.setProperty('--fp-header', px + 'px')
  }

  /* ------------------------------------------------------------------------
   * In-page nav: smooth to the section, honouring reduced motion.
   * ---------------------------------------------------------------------- */
  function initNav() {
    var links = root.querySelectorAll('.fp-nav a[href^="#"]')
    for (var i = 0; i < links.length; i++) {
      links[i].addEventListener('click', function (e) {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
        var id = this.getAttribute('href').slice(1)
        var target = document.getElementById(id)
        if (!target) return
        e.preventDefault()
        target.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' })
        // Move focus with the view, or the next Tab resumes in the hero and
        // throws the reader back to the top of the page.
        if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1')
        try { target.focus({ preventScroll: true }) } catch (err) { target.focus() }
        try { history.replaceState(null, '', '#' + id) } catch (err) { }
      })
    }
  }

  /* ------------------------------------------------------------------------
   * FadeIn
   * ---------------------------------------------------------------------- */
  function initFade() {
    var els = root.querySelectorAll('[data-fp-fade]')
    if (!els.length || !('IntersectionObserver' in window)) return
    for (var i = 0; i < els.length; i++) {
      var el = els[i]
      var x = el.getAttribute('data-fp-x'), y = el.getAttribute('data-fp-y')
      var d = el.getAttribute('data-fp-delay'), dur = el.getAttribute('data-fp-duration')
      if (x) el.style.setProperty('--fp-x', x + 'px')
      if (y) el.style.setProperty('--fp-y', y + 'px')
      if (d) el.style.setProperty('--fp-delay', d + 's')
      if (dur) el.style.setProperty('--fp-dur', dur + 's')
    }
    html.classList.add('fp-motion')
    var io = new IntersectionObserver(function (entries) {
      for (var j = 0; j < entries.length; j++) {
        if (!entries[j].isIntersecting) continue
        entries[j].target.classList.add('is-in')
        io.unobserve(entries[j].target)
      }
    }, { rootMargin: '50px', threshold: 0 })
    for (var k = 0; k < els.length; k++) io.observe(els[k])

    // Tab can reach a link inside a block that has not been revealed yet:
    // show it at once, without the fade, so focus is never invisible.
    root.addEventListener('focusin', function (e) {
      var t = e.target && e.target.closest ? e.target.closest('[data-fp-fade]:not(.is-in)') : null
      if (!t) return
      t.style.setProperty('--fp-delay', '0s')
      t.style.setProperty('--fp-dur', '0s')
      t.classList.add('is-in')
      io.unobserve(t)
    })
  }

  /* ------------------------------------------------------------------------
   * Magnet — activates within `padding` px of the element's edge, moves the
   * element toward the pointer by 1/strength of the distance, and eases
   * back when the pointer leaves the zone.
   * ---------------------------------------------------------------------- */
  function initMagnet() {
    if (!FINE || !FINE.matches) return
    var els = root.querySelectorAll('[data-fp-magnet]')
    if (!els.length) return
    var items = []
    for (var i = 0; i < els.length; i++) {
      items.push({
        el: els[i],
        padding: parseFloat(els[i].getAttribute('data-fp-padding')) || 150,
        strength: parseFloat(els[i].getAttribute('data-fp-strength')) || 3,
        active: false,
      })
      els[i].style.transition = 'transform 0.6s ease-in-out'
    }
    var raf = null, px = 0, py = 0
    function tick() {
      raf = null
      for (var j = 0; j < items.length; j++) {
        var it = items[j]
        // Measure the untransformed parent: reading the element's own rect
        // would fold in the transform we just wrote, so the follow would
        // converge at 1/4 rather than 1/strength and the activation zone
        // would drift with it.
        var r = (it.el.parentElement || it.el).getBoundingClientRect()
        var cx = r.left + r.width / 2, cy = r.top + r.height / 2
        var inside = Math.abs(px - cx) < r.width / 2 + it.padding && Math.abs(py - cy) < r.height / 2 + it.padding
        if (inside) {
          if (!it.active) { it.active = true; it.el.style.transition = 'transform 0.3s ease-out' }
          it.el.style.transform = 'translate3d(' + ((px - cx) / it.strength).toFixed(1) + 'px, ' + ((py - cy) / it.strength).toFixed(1) + 'px, 0)'
        } else if (it.active) {
          it.active = false
          it.el.style.transition = 'transform 0.6s ease-in-out'
          it.el.style.transform = 'translate3d(0, 0, 0)'
        }
      }
    }
    window.addEventListener('pointermove', function (e) {
      px = e.clientX; py = e.clientY
      if (!raf) raf = window.requestAnimationFrame(tick)
    }, { passive: true })
  }

  /* ------------------------------------------------------------------------
   * Marquee, AnimatedText and CardStack all read the scroll position, so
   * they share one passive listener and one frame.
   * ---------------------------------------------------------------------- */
  var marquee = null, rows = []
  var textEl = null, chars = []
  var stack = null, cards = []

  function initMarquee() {
    marquee = root.querySelector('.fp-marquee')
    if (!marquee) return
    var r1 = marquee.querySelector('[data-fp-row="1"]'), r2 = marquee.querySelector('[data-fp-row="2"]')
    if (r1) rows.push({ el: r1, dir: 1 })
    if (r2) rows.push({ el: r2, dir: -1 })
  }

  function initChars() {
    textEl = root.querySelector('[data-fp-chars]')
    if (!textEl) return
    var text = textEl.textContent.replace(/\s+/g, ' ').trim()
    // Split by code point, not by UTF-16 unit, so a curly quote or any
    // astral character is never cut in half.
    var words = text.split(' ')
    var frag = document.createDocumentFragment()
    for (var w = 0; w < words.length; w++) {
      var word = document.createElement('span')
      word.className = 'fp-w'
      var letters = Array.from ? Array.from(words[w]) : words[w].split('')
      for (var c = 0; c < letters.length; c++) {
        var ch = document.createElement('span')
        ch.className = 'fp-c'
        ch.textContent = letters[c]
        ch.style.setProperty('--o', '0.2')
        word.appendChild(ch)
        chars.push(ch)
      }
      frag.appendChild(word)
      if (w < words.length - 1) frag.appendChild(document.createTextNode(' '))
    }
    textEl.textContent = ''
    // A real, readable copy for assistive technology. aria-label on a <p> is
    // not reliably announced, and the animated copy below is aria-hidden —
    // together they would hide the founder's words from a screen reader.
    var sr = document.createElement('span')
    sr.className = 'fp-sr'
    sr.textContent = text
    textEl.appendChild(sr)
    var wrap = document.createElement('span')
    wrap.setAttribute('aria-hidden', 'true')
    wrap.appendChild(frag)
    textEl.appendChild(wrap)
  }

  function initStack() {
    stack = root.querySelector('.fp-stack')
    if (!stack) return
    var list = stack.querySelectorAll('.fp-card')
    for (var i = 0; i < list.length; i++) {
      // The staircase offset is padding on the sticky slot, so the index has
      // to live there; the card keeps it too for anything scoped to the card.
      list[i].style.setProperty('--fp-i', String(i))
      if (list[i].parentElement) list[i].parentElement.style.setProperty('--fp-i', String(i))
      cards.push({ el: list[i], target: 1 - (list.length - 1 - i) * 0.03 })
    }
  }

  var ticking = false
  var stopped = false
  function update() {
    ticking = false
    if (stopped) return
    var vh = window.innerHeight || html.clientHeight
    var sy = window.pageYOffset || html.scrollTop || 0

    if (rows.length) {
      var top = marquee.getBoundingClientRect().top + sy
      var offset = (sy - top + vh) * 0.3
      for (var i = 0; i < rows.length; i++) {
        var v = rows[i].dir > 0 ? (offset - 200) : -(offset - 200)
        rows[i].el.style.transform = 'translate3d(' + v.toFixed(1) + 'px, 0, 0)'
      }
    }

    if (chars.length) {
      var r = textEl.getBoundingClientRect()
      // 0 when the top of the paragraph reaches 80% of the viewport, 1 when
      // its bottom reaches 20% — the template's ['start 0.8', 'end 0.2'].
      var p = clamp((vh * 0.8 - r.top) / (r.height + vh * 0.6), 0, 1)
      var n = chars.length
      // Each character lights over its own 1/n slice of the range; the
      // 1.05 lets the final letters finish a beat before the very end
      // instead of asymptotically on the last pixel of scroll.
      var lead = p * 1.05 * n
      for (var j = 0; j < n; j++) {
        var o = clamp(lead - j, 0, 1)
        chars[j].style.setProperty('--o', (0.2 + 0.8 * o).toFixed(3))
      }
    }

    if (cards.length) {
      var sr = stack.getBoundingClientRect()
      // 0 when the stack's top reaches the viewport top, 1 when its bottom
      // reaches the viewport bottom — the template's ['start start','end end'].
      var sp = clamp((-sr.top) / (sr.height - vh), 0, 1)
      var n2 = cards.length
      for (var k = 0; k < n2; k++) {
        var start = k / n2
        var t = clamp((sp - start) / (1 - start), 0, 1)
        var s = 1 - (1 - cards[k].target) * t
        cards[k].el.style.transform = 'scale(' + s.toFixed(4) + ')'
      }
    }
  }
  function onScroll() {
    if (ticking) return
    ticking = true
    window.requestAnimationFrame(update)
  }

  /* ------------------------------------------------------------------------
   * Videos: play while on screen, pause when not, never with sound.
   * ---------------------------------------------------------------------- */
  var videos = []
  var videoIO = null

  function initVideos() {
    var vids = root.querySelectorAll('video[data-fp-video]')
    if (!vids.length) return
    for (var i = 0; i < vids.length; i++) {
      var v = vids[i]
      videos.push(v)
      v.muted = true
      v.setAttribute('muted', '')

      /* WCAG 2.2.2: the clip loops for longer than five seconds, so it needs
         a way to stop. The button also states what it will do, not what the
         video is doing. */
      var btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'fp-vid-toggle'
      btn.setAttribute('data-for-video', '')
      ;(function (video, button) {
        function sync() {
          var paused = video.paused
          button.textContent = paused ? 'Play' : 'Pause'
          button.setAttribute('aria-label', (paused ? 'Play' : 'Pause') + ' the roof flyover')
        }
        button.addEventListener('click', function () {
          video.__fpManual = true
          if (video.paused) { var p = video.play(); if (p && p.catch) p.catch(function () { }) }
          else video.pause()
          sync()
        })
        video.addEventListener('play', sync)
        video.addEventListener('pause', sync)
        sync()
      })(v, btn)
      if (v.parentNode) v.parentNode.appendChild(btn)
    }

    if (reduced() || !('IntersectionObserver' in window)) return
    videoIO = new IntersectionObserver(function (entries) {
      for (var j = 0; j < entries.length; j++) {
        var vid = entries[j].target
        // Once somebody has pressed the button, the observer stops deciding.
        if (vid.__fpManual) continue
        if (entries[j].isIntersecting) {
          var p = vid.play()
          if (p && p.catch) p.catch(function () { })
        } else if (!vid.paused) {
          vid.pause()
        }
      }
    }, { threshold: 0.2 })
    for (var k = 0; k < videos.length; k++) videoIO.observe(videos[k])
  }

  /* ------------------------------------------------------------------------
   * Boot
   * ---------------------------------------------------------------------- */
  function boot() {
    measureHeader()
    initNav()
    initVideos()
    initStack()
    if (reduced()) return

    initFade()
    initMagnet()
    initMarquee()
    initChars()

    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', function () { measureHeader(); onScroll() }, { passive: true })
    update()

    if (REDUCED) {
      var onChange = function (e) {
        if (!e.matches) return
        stopped = true
        html.classList.remove('fp-motion')
        window.removeEventListener('scroll', onScroll)
        for (var i = 0; i < rows.length; i++) rows[i].el.style.transform = ''
        for (var j = 0; j < chars.length; j++) chars[j].style.setProperty('--o', '1')
        for (var k = 0; k < cards.length; k++) cards[k].el.style.transform = ''
        // The flyover must stop too, and stay stopped.
        if (videoIO) { videoIO.disconnect(); videoIO = null }
        for (var m = 0; m < videos.length; m++) { try { videos[m].pause() } catch (err) { } }
      }
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
