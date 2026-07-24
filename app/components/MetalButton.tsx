'use client'

import { useEffect } from 'react'
import { MetalFx, setSharedPreset } from 'metal-fx'

/**
 * Wraps a single primary button in metal-fx's animated liquid-silver ring.
 *
 * metal-fx uses ONE shared WebGL renderer whose palette is a global seeded to
 * `chromatic` (the rainbow). The per-instance `preset` prop drives that global
 * via an effect, but the seed can win the first frames, which is what made the
 * ring read as a stale rainbow. We pin it to silver explicitly on mount so the
 * shared renderer is silver regardless of mount timing. `borderRadius={0}`
 * gives the ring square corners to match the rest of the UI. Glow is left on
 * and unclipped so it breathes like the package playground.
 */
export default function MetalButton({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    setSharedPreset('silver', 'dark')
  }, [])

  return (
    <MetalFx
      variant="button"
      preset="silver"
      theme="dark"
      strength={0.81}
      borderRadius={0}
      style={{ display: 'inline-flex' }}
    >
      {children}
    </MetalFx>
  )
}
