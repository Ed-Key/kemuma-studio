'use client'

import { useActionState, useEffect, useState } from 'react'
import { captureObjectAction } from './actions'
import PendingObjects from './PendingObjects'
import WorkingOrb from '../components/WorkingOrb'

const FIELDS = [
  { name: 'height_in', label: 'Height', unit: 'in' },
  { name: 'width_in', label: 'Width', unit: 'in' },
  { name: 'depth_in', label: 'Depth', unit: 'in' },
  { name: 'weight_lb', label: 'Weight', unit: 'lb' },
] as const

type FieldName = (typeof FIELDS)[number]['name'] | 'colorway' | 'note'

const EMPTY: Record<FieldName, string> = {
  height_in: '', width_in: '', depth_in: '', weight_lb: '', colorway: '', note: '',
}

export default function CaptureForm({ designNames }: { designNames: string[] }) {
  const [state, dispatch, pending] = useActionState(captureObjectAction, null)
  const [shots, setShots] = useState<File[]>([])
  const [dimension, setDimension] = useState<File | null>(null)
  const [fields, setFields] = useState(EMPTY)
  const [saved, setSaved] = useState(0)

  useEffect(() => {
    if (!state?.ok) return
    setShots([])
    setDimension(null)
    setFields(EMPTY)
    setSaved((n) => n + 1)
  }, [state])

  // The camera hands back one photograph at a time and replaces the input's
  // file list on every use, so anything already taken has to be kept here or
  // only the last shot survives the submit. The input is cleared after each
  // pick so choosing the same file twice still fires a change event.
  const collect = (list: FileList | null) => {
    if (!list || list.length === 0) return
    setShots((prev) => [...prev, ...Array.from(list)])
  }

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData()
    for (const file of shots) data.append('media', file)
    if (dimension) data.append('dimension_media', dimension)
    for (const [key, value] of Object.entries(fields)) data.append(key, value)
    dispatch(data)
  }

  const set = (name: FieldName) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setFields((f) => ({ ...f, [name]: e.currentTarget.value }))

  return (
    <>
      {/* onSubmit rather than the action prop: React resets a form submitted
          through `action` even when the action failed, which threw away the
          photographs and every measurement on any mistake. */}
      <form onSubmit={submit} className="capture">
        <label className="capture-shoot">
          <input
            type="file"
            accept="image/*,video/*"
            capture="environment"
            multiple
            onChange={(e) => {
              collect(e.currentTarget.files)
              e.currentTarget.value = ''
            }}
          />
          <span className="capture-shoot-label">
            {shots.length > 0 ? `${shots.length} captured` : 'Photograph this object'}
          </span>
          <span className="capture-shoot-hint">
            {shots.length > 0 ? 'Tap again for another angle' : 'Stills and short clips. Several angles.'}
          </span>
        </label>

        {shots.length > 0 && (
          <ul className="capture-shots">
            {shots.map((file, i) => (
              <li key={`${file.name}-${i}`}>
                <span>{file.type.startsWith('video') ? 'clip' : `shot ${i + 1}`}</span>
                <button type="button" onClick={() => setShots((p) => p.filter((_, j) => j !== i))}>
                  remove
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="capture-grid">
          {FIELDS.map((f) => (
            <label key={f.name} className="capture-field">
              <span>
                {f.label} <em>{f.unit}</em>
              </span>
              <input
                type="text"
                inputMode="decimal"
                placeholder="0.0"
                autoComplete="off"
                value={fields[f.name]}
                onChange={set(f.name)}
              />
            </label>
          ))}
        </div>

        <label className="capture-field">
          <span>Colorway</span>
          <input
            type="text"
            list="colorways"
            placeholder="maroon"
            autoComplete="off"
            value={fields.colorway}
            onChange={set('colorway')}
          />
        </label>
        <datalist id="colorways">
          {designNames.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>

        <label className="capture-field">
          <span>Note</span>
          <input
            type="text"
            placeholder="chipped rim, sold as a pair"
            autoComplete="off"
            value={fields.note}
            onChange={set('note')}
          />
        </label>

        <label className="capture-dimension">
          <input
            type="file"
            accept="image/*"
            capture="environment"
            onChange={(e) => {
              setDimension(e.currentTarget.files?.[0] ?? null)
              e.currentTarget.value = ''
            }}
          />
          <span>{dimension ? 'Dimension shot taken' : 'Dimension card shot'}</span>
          <span className="capture-shoot-hint">Optional. The whole piece, flat on.</span>
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
            {saved} object{saved === 1 ? '' : 's'} captured this session.
          </p>
        )}
      </form>
      <PendingObjects nudge={saved} />
    </>
  )
}
