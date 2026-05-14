import { cn } from '@/lib/utils'

interface ModalCloseXProps {
  onClose: () => void
  disabled?: boolean
  variant: 'circle' | 'ghost'
  className?: string
  svgClassName?: string
  ariaLabel?: string
}

/**
 * Close X button used inside Radix Dialog headers since Sprint Zod-Rollout v10.
 * Centralizes the SVG path + `aria-label="Fermer"` + `aria-hidden="true"` pattern
 * that was duplicated across 11 sites (10 files) post-v8 Radix migration.
 *
 * Two visual variants preserved from pre-v10 code :
 *
 * - `circle` : raw `<button>` with `h-8 w-8` + `rounded-full` + `bg-gray-100`.
 *   Used by 6 sites (Add/Edit Budget/Income, PlanningDrawer, SavingsDistribution×2).
 *   For SavingsDistributionDrawer drawer principal which uses `h-10 w-10`, pass
 *   `className="h-10 w-10"` + `svgClassName="h-5 w-5 text-gray-600"`.
 *
 * - `ghost` : raw `<button>` with `h-8 w-8` + `rounded-md` + `p-2` + `hover:bg-accent`.
 *   Used by 4 sites (Add/EditTransactionModal, GroupMembers, DeleteGroup).
 *   Mirrors shadcn `<Button variant="ghost" size="sm">` visual fidelity without
 *   pulling the shadcn dep into this minimal component. For DeleteGroupModal which
 *   uses `p-1`, pass `className="p-1"`.
 *
 * The click handler is `() => !disabled && onClose()` — uniform gating across
 * both variants. The native `disabled` attribute also prevents click events, but
 * the JS check is kept as defense-in-depth.
 *
 * Pattern : use inside a `<DialogContent>` header, paired with `<DialogTitle asChild>`.
 */
export function ModalCloseX({
  onClose,
  disabled = false,
  variant,
  className,
  svgClassName,
  ariaLabel = 'Fermer',
}: ModalCloseXProps) {
  const baseClasses =
    variant === 'circle'
      ? 'flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 transition-colors hover:bg-gray-200'
      : 'inline-flex h-8 w-8 items-center justify-center rounded-md p-2 transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'
  return (
    <button
      type="button"
      onClick={() => !disabled && onClose()}
      disabled={disabled}
      aria-label={ariaLabel}
      className={cn(baseClasses, 'disabled:cursor-not-allowed disabled:opacity-50', className)}
    >
      <CloseSvg svgClassName={svgClassName} />
    </button>
  )
}

function CloseSvg({ svgClassName }: { svgClassName?: string }) {
  return (
    <svg
      className={svgClassName ?? 'h-4 w-4 text-gray-600'}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
    </svg>
  )
}
