import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

interface InlineSpinnerProps {
  size?: 'sm' | 'md'
  className?: string
}

export function InlineSpinner({ size = 'sm', className }: InlineSpinnerProps) {
  return (
    <Loader2
      aria-hidden="true"
      className={cn('animate-spin', size === 'sm' ? 'h-4 w-4' : 'h-5 w-5', className)}
    />
  )
}
