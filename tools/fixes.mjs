/**
 * Corrections applied to the mirror after capture.
 *
 * The mirror is generated. Anything hand-edited into a page is lost the next
 * time `npm run mirror` runs, silently, and the site quietly regresses to the
 * broken state it was captured in. So every deliberate change to the captured
 * HTML lives here instead, as data, and is re-applied by
 * `tools/apply-fixes.mjs` as the last step of a rebuild.
 *
 * Rules for anything added to this list:
 *
 *   - It fixes something that is broken on the live site. This is not the place
 *     for redesign, copy changes or SEO edits.
 *   - `expect` is the number of files the change must touch. If the real count
 *     differs, apply-fixes stops rather than half-applying — a count that has
 *     moved means the capture changed underneath the fix and it needs re-reading
 *     before it is trusted.
 *   - `why` explains the decision, not the mechanics.
 */

export const FIXES = [
  // None. The capture is faithful, broken links included; corrections are added
  // here only on request, once the copy has been proved faithful.
]
