'use client'

import { createContext, useActionState, useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ActionResult } from './action-result'

/**
 * Whether this form's action is in flight.
 *
 * useFormStatus cannot answer that here: it reports on submissions the form
 * makes itself, and every form in this app dispatches through useActionState,
 * whose pending flag is the third value it returns. Discarding that value left
 * every submit button inert while its action ran, so a two minute staging batch
 * looked like a click that did nothing. PendingSubmit reads this first and
 * falls back to useFormStatus for plain forms that are not wrapped here.
 */
export const FormPendingContext = createContext(false)

/** A clean result has said its piece by the time it is read. Anything carrying
 *  a warning or a failure stays until dismissed, because those name a specific
 *  listing or image that still needs doing. */
const CLEAN_DISMISS_MS = 6000

function Toast({ state, onClose }: { state: ActionResult; onClose: () => void }) {
  const failed = !state.ok
  const warned = state.ok && (state.warnings?.length ?? 0) > 0
  const sticky = failed || warned

  useEffect(() => {
    if (sticky) return
    const timer = setTimeout(onClose, CLEAN_DISMISS_MS)
    return () => clearTimeout(timer)
  }, [sticky, onClose])

  return (
    <div
      className={`toast ${failed ? 'toast--danger' : warned ? 'toast--warn' : 'toast--ok'}`}
      role="status"
      aria-live="polite"
    >
      <div className="toast-body">
        <span>{state.message}</span>
        {state.detail ? <span className="toast-detail">{state.detail}</span> : null}
        {state.warnings?.map((w, i) => (
          <span key={i} className="toast-detail">
            {w}
          </span>
        ))}
      </div>
      <button type="button" className="toast-close" onClick={onClose} aria-label="Dismiss">
        &times;
      </button>
    </div>
  )
}

/**
 * Wraps a server action that returns { ok, message } and shows its result as a
 * toast. Form fields and the submit control are passed as children, so
 * data-fetching stays in the server component.
 *
 * The result used to render inline, which meant a two-line sync report shoved
 * the row of tools it sat in sideways and reflowed the page under the pointer.
 * A toast leaves the layout alone.
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
  const [state, formAction, isPending] = useActionState(action, null)
  const [dismissed, setDismissed] = useState<ActionResult | null>(null)
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  // Compared by identity, not contents: every submission returns a fresh object,
  // so repeating an action shows its toast again instead of looking like a dead
  // button because the message happened to match the last one.
  const showing = state && state !== dismissed ? state : null
  const close = useCallback(() => setDismissed(showing), [showing])

  return (
    <form action={formAction} className={className}>
      <FormPendingContext.Provider value={isPending}>{children}</FormPendingContext.Provider>
      {mounted && showing
        ? createPortal(<Toast state={showing} onClose={close} />, document.body)
        : null}
    </form>
  )
}
