import { cn } from '@/lib/utils'

/**
 * Shared classes for Radix DialogContent in modal mode (centered, not drawer).
 * Mirror of DRAWER_CONTENT_CLASSES (drawer-content-classes.ts) but for centered
 * modals — applied across every modal of the repo to keep height + scroll
 * behavior uniform.
 *
 * Invariants :
 * - bottom-auto! releases Radix's default `inset-4` bottom constraint. Without
 *   this override the modal is FORCED to height ≈ 50vh on mobile (because
 *   top:50% AND bottom:16px both apply, making CSS solve height = vh/2 - 16).
 *   With bottom-auto, height is content-determined, capped by max-h-[85vh].
 *   The `!` postfix is the Tailwind v4 cascade winner (mirror of the
 *   tw-animate-css override pattern in drawer-content-classes.ts).
 * - max-h-[85vh] caps the modal at 85 % of the viewport (the user's stated
 *   max). Below the cap, the modal sizes to content.
 * - flex flex-col gap-0 overflow-hidden lets the modal split into stacked
 *   sections (header / body / footer). Body opts into `flex-auto min-h-0
 *   overflow-y-auto` — NOT `flex-1` which uses flex-basis: 0% and collapses
 *   the body to 0 in unconstrained parents.
 * - sm:max-w-md is the mobile-first single-column width. Override per modal
 *   via cn(MODAL_CONTENT_CLASSES, 'sm:max-w-2xl') for wider modals (only
 *   GroupMembersWithContributionsModal today).
 *
 * Expected internal structure (optional footer) :
 *   DialogContent className={MODAL_CONTENT_CLASSES}
 *     > shrink-0 header
 *     > flex-auto min-h-0 overflow-y-auto body
 *     > shrink-0 footer
 *
 * For modals wrapping body+footer in a <form> (sticky-footer pattern), the
 * form itself must be `flex flex-auto flex-col min-h-0 overflow-hidden` so
 * its flex-basis is auto (content-size) instead of 0%.
 */
export const MODAL_CONTENT_CLASSES = cn(
  'bottom-auto!',
  'flex max-h-[85vh] flex-col gap-0 overflow-hidden rounded-2xl border-0 p-0 shadow-xl',
  'sm:max-w-md sm:rounded-2xl',
)
