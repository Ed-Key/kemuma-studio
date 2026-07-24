'use client'

import { useEffect, useState } from 'react'
import { ThinkingOrb, type OrbState } from 'thinking-orbs'

export type { OrbState }

type OrbSize = 'pill' | 'fill'

function useReducedMotion() {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReduced(mq.matches)
    const onChange = () => setReduced(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return reduced
}

function OrbVisual({ state, px }: { state: OrbState; px: 20 | 64 }) {
  const reduced = useReducedMotion()
  // Brief's reduced-motion fallback: a slow-pulsing dot instead of the animation.
  if (reduced) {
    return <span className="orb-dot" aria-hidden="true" style={{ margin: (px - 10) / 2 }} />
  }
  return <ThinkingOrb state={state} size={px} theme="dark" aria-hidden="true" />
}

/**
 * The signature "working" indicator. Wraps thinking-orbs' ThinkingOrb in the
 * brief's pill (orb left, verb label right) or a centered whole-card overlay.
 * Theme is pinned to dark to match the app.
 */
export default function WorkingOrb({
  label,
  state = 'working',
  size = 'pill',
}: {
  label: string
  state?: OrbState
  size?: OrbSize
}) {
  if (size === 'fill') {
    return (
      <div className="orb-overlay" role="status" aria-live="polite">
        <OrbVisual state={state} px={64} />
        <span>{label}</span>
      </div>
    )
  }
  return (
    <span className="orb-pill" role="status" aria-live="polite">
      <OrbVisual state={state} px={20} />
      <span>{label}</span>
    </span>
  )
}
