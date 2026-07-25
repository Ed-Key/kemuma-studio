'use client'

import { useEffect, useRef } from 'react'
import { MODE_DRAWS, ThinkingOrb, resolvePreset } from 'thinking-orbs'
import { useReducedMotion } from './WorkingOrb'

export type JobStatus = 'queued' | 'running' | 'done' | 'failed' | 'interrupted'

/* The rail's mark size. The orb ships two designs rather than one drawing at
   any size; 20 is the small one, and CSS draws it 1.35 times larger than its
   layout box so it reads without widening the collapsed column. */
const SIZE = 20

/* The morph mode's own timing, read out of the package: it holds a shape for
   HOLD seconds, then crosses to the next over TRANSITION. Its cycle is
   circle, triangle, square, so shape index times SLOT is the instant that
   shape is pure. Freezing the component with `paused` lands on whatever frame
   the clock happened to be on, which is why this draws its own frames. */
const HOLD = 1.4
const TRANSITION = 0.9
const SLOT = HOLD + TRANSITION
const CIRCLE = 0
const TRIANGLE = 1
const SQUARE = 2

/** Where a finished job comes to rest. */
const RESTING_SHAPE: Record<string, number> = {
  done: SQUARE,
  failed: TRIANGLE,
  interrupted: CIRCLE,
}

/* Playing the settle straight through would sit on the triangle for HOLD
   seconds on the way to the square, showing the failure shape to a job that
   succeeded. So the settle is the crossings only, holds cut out. */
function crossings(shape: number): Array<[number, number]> {
  const legs: Array<[number, number]> = []
  for (let from = CIRCLE; from < shape; from++) {
    legs.push([from * SLOT + HOLD, (from + 1) * SLOT])
  }
  return legs
}

const SETTLE_MS_PER_LEG = 460

function drawFrame(canvas: HTMLCanvasElement, t: number) {
  const ratio = Math.min(2, (typeof devicePixelRatio !== 'undefined' && devicePixelRatio) || 1)
  canvas.width = Math.round(SIZE * ratio)
  canvas.height = Math.round(SIZE * ratio)
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const { mode, opts } = resolvePreset('shaping', SIZE)
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
  ctx.clearRect(0, 0, SIZE, SIZE)
  // false is the light theme: dark ink on a transparent canvas, which is what
  // the tints in globals.css then colour. `spread` widens the outline to the
  // sphere's footprint, so a column of marks keeps one rhythm instead of the
  // finished ones reading as a size smaller.
  MODE_DRAWS[mode](ctx, SIZE, t, false, { ...opts, spread: (opts.spread ?? 1) * 1.16 })
}

/**
 * A finished job's mark: the dotted outline at rest in one shape, and if the
 * job finished while the owner was watching, the fold that got it there.
 */
function RestingMark({
  status,
  settle,
  onSettled,
}: {
  status: JobStatus
  settle: boolean
  onSettled?: () => void
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const reduced = useReducedMotion()
  const shape = RESTING_SHAPE[status] ?? CIRCLE
  const done = useRef(onSettled)
  done.current = onSettled

  useEffect(() => {
    const element = canvas.current
    if (!element) return
    const rest = shape * SLOT
    const legs = crossings(shape)

    if (!settle || reduced || legs.length === 0) {
      drawFrame(element, rest)
      if (settle) done.current?.()
      return
    }

    // Motion here is a real event and nothing else: it plays once, when a job
    // the owner was watching actually landed, and never on mount, on a poll
    // that changed nothing, or when the rail opens and closes.
    const span = legs.length * SETTLE_MS_PER_LEG
    const started = performance.now()
    let frame = 0
    const step = () => {
      const elapsed = performance.now() - started
      if (elapsed >= span) {
        drawFrame(element, rest)
        done.current?.()
        return
      }
      const progress = (elapsed / span) * legs.length
      const leg = legs[Math.min(legs.length - 1, Math.floor(progress))]
      const within = progress - Math.floor(progress)
      drawFrame(element, leg[0] + (leg[1] - leg[0]) * within)
      frame = requestAnimationFrame(step)
    }
    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [shape, settle, reduced])

  return <canvas ref={canvas} style={{ width: SIZE, height: SIZE, display: 'block' }} />

}

/**
 * One mark per job, the same at 50px and open.
 *
 * A running job is the orb, animating. When it lands the dots fold into the
 * shape it landed in and stay there: a square for done, a triangle for failed,
 * and for interrupted the circle it never left. Shape carries the outcome, so
 * the marks stay legible with motion off and before the colour resolves; the
 * tints in globals.css say the same thing a second way.
 */
export function JobMark({
  status,
  settle = false,
  onSettled,
}: {
  status: JobStatus
  settle?: boolean
  onSettled?: () => void
}) {
  const reduced = useReducedMotion()
  const running = status === 'running'
  const live = running || status === 'queued'
  /* Hidden from assistive tech at both widths: the open rail already says the
     status in words, and the collapsed one is a count, not a report. */
  return (
    <span className={`job-mark job-mark--${status}`} aria-hidden="true">
      {live ? (
        /* "listening" is the state that survives this size: its latitude rings
           hold a sphere, where the default "working" is particles on tilted
           orbits and reads as loose specks. Queued is the same sphere held
           still: motion means running and nothing else. */
        <ThinkingOrb state="listening" size={SIZE} theme="light" paused={!running || reduced} />
      ) : (
        <RestingMark status={status} settle={settle} onSettled={onSettled} />
      )}
    </span>
  )
}
