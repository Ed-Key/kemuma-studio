'use client'

import { useFormStatus } from 'react-dom'
import { MetalFx } from 'metal-fx'
import WorkingOrb, { type OrbState } from './WorkingOrb'

type Variant = 'primary' | 'ghost' | 'default'

/**
 * Submit button that swaps in the working orb while its form is pending.
 * `pendingLabel` is the verb-specific status ("Writing listing...", etc.),
 * `orbState` picks the matching thinking-orbs animation, `children` is the
 * idle label. Primary buttons get metal-fx's WebGL sheen (restraint clause:
 * primary actions only).
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

  // Animated liquid metal on active primary buttons only, per Ed's playground
  // export (silver, strength 0.81, glow/shimmer on). overflow:hidden on the
  // wrapper clips any halo to the button bounds so it never smears below.
  // reflectionTargets is skipped: no primary button sits beside a meaningful
  // sibling in our action rows, so there is nothing natural to reflect onto.
  // The .btn--primary CSS sheen underneath is the fallback if WebGL is absent.
  if (variant === 'primary' && !disabled) {
    return (
      <MetalFx
        variant="button"
        preset="silver"
        theme="dark"
        strength={0.81}
        style={{ display: 'inline-flex', borderRadius: 'var(--radius)', overflow: 'hidden' }}
      >
        {button}
      </MetalFx>
    )
  }

  return button
}
