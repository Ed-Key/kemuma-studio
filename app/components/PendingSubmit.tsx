'use client'

import { useContext } from 'react'
import { useFormStatus } from 'react-dom'
import WorkingOrb, { type OrbState } from './WorkingOrb'
import { FormPendingContext } from './ActionForm'

type Variant = 'primary' | 'ghost' | 'default'

/**
 * Submit button that swaps in the working orb while its form is pending.
 * `pendingLabel` is the verb-specific status ("Writing listing...", etc.),
 * `orbState` picks the matching thinking-orbs animation, `children` is the
 * idle label.
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
  // ActionForm dispatches through useActionState, and useFormStatus does not
  // see those submissions, so its flag is the authority when there is one.
  // useFormStatus still covers plain forms that post a server action directly.
  const dispatched = useContext(FormPendingContext)
  const { pending: submitted } = useFormStatus()
  const pending = dispatched || submitted

  if (pending) {
    // Shed the button chrome so the orb pill stands on its own, but keep the
    // footprint: a full-width button that shrinks while it works makes the card
    // around it jump.
    return (
      <button
        type="submit"
        className={`btn-pending${block ? ' btn-pending--block' : ''}`}
        disabled
        aria-busy="true"
      >
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

  return (
    <button type="submit" className={cls} disabled={disabled}>
      {children}
    </button>
  )
}
