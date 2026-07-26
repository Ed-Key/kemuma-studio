'use client'

import { useActionState, useEffect, useState } from 'react'
import { confirmCapturedAction } from './confirm'
import WorkingOrb from '../components/WorkingOrb'

const POLL_MS = 2500

type Pending = {
  intake_id: number
  photos: number
  colorway: string | null
  measured: boolean
  decision: 'existing' | 'new' | 'abstain' | null
  design_id: number | null
  design_name: string | null
}

type Design = { design_id: number; name: string; family: string }

function Row({ item, designs, onDone }: { item: Pending; designs: Design[]; onDone: () => void }) {
  const [state, action, pending] = useActionState(confirmCapturedAction, null)
  const [manual, setManual] = useState(false)

  useEffect(() => {
    if (state?.ok) onDone()
  }, [state, onDone])

  // The matcher runs behind the capture response, so a freshly saved object has
  // no verdict yet. Saying so is better than showing an empty choice.
  if (item.decision === null) {
    return (
      <div className="pending-row">
        <WorkingOrb label={`Matching ${item.photos} photos...`} state="searching" />
      </div>
    )
  }

  const proposed = item.decision === 'existing' && item.design_name

  return (
    <form action={action} className="pending-row">
      <input type="hidden" name="intake_id" value={item.intake_id} />
      <p className="pending-what">
        {item.colorway ? <span>{item.colorway}</span> : null}
        {!item.measured && <span className="pending-warn">not measured</span>}
      </p>

      {proposed && !manual ? (
        <>
          <p className="pending-ask">
            Another <strong>{item.design_name}</strong>?
          </p>
          <button type="submit" name="choice" value="existing" className="capture-next" disabled={pending}>
            {pending ? <WorkingOrb label="Cataloguing..." state="working" /> : 'Yes, same design'}
          </button>
          <button type="button" className="pending-alt" onClick={() => setManual(true)}>
            No, something else
          </button>
        </>
      ) : (
        <>
          <p className="pending-ask">
            {item.decision === 'new' ? 'Looks like a new design.' : 'Not sure what this is.'}
          </p>
          <label className="capture-field">
            <span>Name it</span>
            <input name="new_name" placeholder="Leaping Gazelle" autoComplete="off" />
          </label>
          <label className="capture-field">
            <span>Family</span>
            <input name="new_family" list="families" placeholder="trinket dish" autoComplete="off" />
          </label>
          <datalist id="families">
            {[...new Set(designs.map((d) => d.family))].map((f) => (
              <option key={f} value={f} />
            ))}
          </datalist>
          <button type="submit" name="choice" value="new" className="capture-next" disabled={pending}>
            {pending ? <WorkingOrb label="Cataloguing..." state="working" /> : 'Add as new design'}
          </button>
          {designs.length > 0 && (
            <select name="design_id" className="capture-existing" defaultValue="">
              <option value="" disabled>
                or attach to an existing design
              </option>
              {designs.map((d) => (
                <option key={d.design_id} value={d.design_id}>
                  {d.name}
                </option>
              ))}
            </select>
          )}
          <button type="submit" name="choice" value="existing" className="pending-alt" disabled={pending}>
            Attach to the design above
          </button>
        </>
      )}

      {state && !state.ok && <p className="capture-said capture-said--bad">{state.detail ?? state.message}</p>}
      {state?.ok && <p className="capture-said capture-said--ok">{state.message}<span>{state.detail}</span></p>}
    </form>
  )
}

export default function PendingObjects({ nudge }: { nudge: number }) {
  const [pending, setPending] = useState<Pending[]>([])
  const [designs, setDesigns] = useState<Design[]>([])

  useEffect(() => {
    let alive = true
    const read = async () => {
      try {
        const res = await fetch('/api/captures', { cache: 'no-store' })
        if (!res.ok) return
        const body = (await res.json()) as { pending: Pending[]; designs: Design[] }
        if (!alive) return
        setPending(body.pending)
        setDesigns(body.designs)
      } catch {
        // A dropped poll in a garage is expected; the next one covers it.
      }
    }
    void read()
    const timer = setInterval(read, POLL_MS)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [nudge])

  if (pending.length === 0) return null

  return (
    <section className="pending">
      <h2>Waiting on you</h2>
      {pending.map((item) => (
        <Row key={item.intake_id} item={item} designs={designs} onDone={() => setPending((p) => p.filter((x) => x.intake_id !== item.intake_id))} />
      ))}
    </section>
  )
}
