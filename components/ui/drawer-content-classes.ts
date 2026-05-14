import { cn } from '@/lib/utils'

/**
 * Override className for <DialogContent> that transforms a centered modal into
 * a bottom-up fullscreen drawer. Used by the 2 drawers of the repo
 * (PlanningDrawer + SavingsDistributionDrawer) since Sprint Zod-Rollout v8.
 *
 * If a 3rd drawer surfaces OR if a drag-to-dismiss signalement comes up,
 * consider migrating to `vaul` + a new `components/ui/drawer.tsx` shadcn
 * wrapper — vaul provides native drag handle + snap points.
 */
export const DRAWER_CONTENT_CLASSES = cn(
  // Override default centered modal sizing → fullscreen drawer
  'inset-0 left-0 top-0 h-screen max-h-screen w-screen max-w-none translate-x-0 translate-y-0',
  'sm:inset-0 sm:left-0 sm:max-w-none sm:translate-x-0',
  // Drop centered-modal chrome
  'rounded-none border-0 p-0 shadow-none sm:rounded-none',
  // Drawer body
  'flex flex-col gap-0 bg-white',
  // Override animations: slide from bottom
  'data-[state=open]:slide-in-from-bottom data-[state=closed]:slide-out-to-bottom',
  'data-[state=open]:zoom-in-100 data-[state=closed]:zoom-out-100',
  'duration-300',
)
