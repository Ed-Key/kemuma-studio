'use client'

import { useFormStatus } from 'react-dom'
import WorkingOrb, { type OrbState } from './WorkingOrb'
import MetalButton from './MetalButton'

type Variant = 'primary' | 'ghost' | 'default'

/**
 * Submit button that swaps in the working orb while its form is pending.
 * `pendingLabel` is the verb-specific status ("Writing listing...", etc.),
 * `orbState` picks the matching thinking-orbs animation, `children` is the
 * idle label. Active primary buttons are wrapped in MetalButton for the
 * animated liquid-silver ring, applied uniformly to every primary action.
 */
export default function PendingSubmit({
  children,
  pendingLabel,
  orbState = 'working',
  variant = 'default',
  disabled = false,
  block = false,
}: {
  children: React.ReactNode
  pendingLabel: string
  orbState?: OrbState
  variant?: Variant
  disabled?: boolean
  block?: boolean
}) {
  const { pending } = useFormStatus()

  if (pending) {
    // Shed the button chrome so the orb pill stands on its own.
    return (
      <button type="submit" className="btn-pending" disabled aria-busy="true">
        <WorkingOrb label={pendingLabel} state={orbState} />
      </button>
    )
  }

  const cls = [
    'btn',
    variant === 'primary' ? 'btn--primary' : '',
    variant === 'ghost' ? 'btn--ghost' : '',
    block ? 'btn--block' : '',
  ]
    .filter(Boolean)
    .join(' ')

  const button = (
    <button type="submit" className={cls} disabled={disabled}>
      {children}
    </button>
  )

  // Every active primary button gets the metal-fx silver ring. Disabled
  // primaries (e.g. an already-approved draft) stay a plain dark button.
  if (variant === 'primary' && !disabled) {
    return <MetalButton>{button}</MetalButton>
  }

  return button
}
