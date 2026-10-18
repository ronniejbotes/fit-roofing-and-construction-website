/*
 * Fit Roofing — homepage bundle: the hero's owner portrait, glow, headline
 * rule and scroll cue. Loaded on / only, with `defer`, right before </body>.
 *
 * The "Build it the F.I.T. way" intro gate that used to live here (a
 * full-screen clip with Skip, shown before the homepage) was removed on
 * 18 October 2026 at the owner's request: the homepage now opens straight on
 * the hero. It is in git history (fit-home.js before that date) if it is ever
 * wanted back.
 */
(function () {
  'use strict'

  function reducedMotion() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
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

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initHero, { once: true })
  } else {
    initHero()
  }
})()
