'use client'

import { useActionState } from 'react'
import type { ActionResult } from './action-result'

/**
 * Wraps a server action that returns { ok, message } and renders its result as
 * an inline banner. Form fields and the submit control are passed as children,
 * so data-fetching stays in the server component.
 */
export default function ActionForm({
  action,
  children,
  className,
}: {
  action: (prev: ActionResult | null, formData: FormData) => Promise<ActionResult>
  children: React.ReactNode
  className?: string
}) {
  const [state, formAction] = useActionState(action, null)
  return (
    <form action={formAction} className={className}>
      {children}
      {state && (
        <div
          className={`banner ${state.ok ? 'banner--ok' : 'banner--danger'}`}
          role="status"
          aria-live="polite"
        >
          <span>{state.message}</span>
          {state.detail ? <span className="banner-detail">{state.detail}</span> : null}
        </div>
      )}
    </form>
  )
}
