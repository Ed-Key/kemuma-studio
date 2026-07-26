'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import { captureObjectAction } from './actions'
import WorkingOrb from '../components/WorkingOrb'

const FIELDS = [
  { name: 'height_in', label: 'Height', unit: 'in' },
  { name: 'width_in', label: 'Width', unit: 'in' },
  { name: 'depth_in', label: 'Depth', unit: 'in' },
  { name: 'weight_lb', label: 'Weight', unit: 'lb' },
] as const

export default function CaptureForm({ designNames }: { designNames: string[] }) {
  const [state, formAction, pending] = useActionState(captureObjectAction, null)
  const form = useRef<HTMLFormElement>(null)
  const [count, setCount] = useState(0)
  const [saved, setSaved] = useState(0)

  // A successful save clears the form so the next object starts empty. The
  // measurements must not carry over: two pieces of the same design still have
  // their own weight, and a stale number is worse than a blank one.
  useEffect(() => {
    if (state?.ok) {
      form.current?.reset()
      setCount(0)
      setSaved((n) => n + 1)
    }
  }, [state])

  return (
    <form ref={form} action={formAction} className="capture">
      <label className="capture-shoot">
        <input
          type="file"
          name="media"
          accept="image/*,video/*"
          capture="environment"
          multiple
          onChange={(e) => setCount(e.currentTarget.files?.length ?? 0)}
        />
        <span className="capture-shoot-label">
          {count > 0 ? `${count} captured` : 'Photograph this object'}
        </span>
        <span className="capture-shoot-hint">Stills and short clips. Several angles.</span>
      </label>

      <div className="capture-grid">
        {FIELDS.map((f) => (
          <label key={f.name} className="capture-field">
            <span>
              {f.label} <em>{f.unit}</em>
            </span>
            <input name={f.name} type="text" inputMode="decimal" placeholder="0.0" autoComplete="off" />
          </label>
        ))}
      </div>

      <label className="capture-field">
        <span>Colorway</span>
        <input name="colorway" type="text" list="colorways" placeholder="maroon" autoComplete="off" />
      </label>
      <datalist id="colorways">
        {designNames.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>

      <label className="capture-field">
        <span>Note</span>
        <input name="note" type="text" placeholder="chipped rim, sold as a pair" autoComplete="off" />
      </label>

      <button type="submit" className="capture-next" disabled={pending}>
        {pending ? <WorkingOrb label="Saving..." state="working" /> : 'Save and next object'}
      </button>

      {state && (
        <p className={`capture-said capture-said--${state.ok ? 'ok' : 'bad'}`}>
          {state.message}
          {state.detail ? <span>{state.detail}</span> : null}
        </p>
      )}
      {saved > 0 && (
        <p className="capture-tally">
          {saved} object{saved === 1 ? '' : 's'} captured this session. Review them on the laptop.
        </p>
      )}
    </form>
  )
}
