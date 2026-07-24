'use client'

import { useEffect, useRef } from 'react'

type OrbSize = 'pill' | 'fill'

const POINT_COUNT = 140
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))
const NEIGHBOR_DIST = 0.42 // 3D distance under which two points get a hairline link
const Y_PERIOD = 12000 // ms per revolution

type P3 = { x: number; y: number; z: number }

// Fibonacci lattice on a unit sphere: even coverage, no clustered poles.
function spherePoints(n: number): P3[] {
  const pts: P3[] = []
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2
    const r = Math.sqrt(Math.max(0, 1 - y * y))
    const theta = i * GOLDEN_ANGLE
    pts.push({ x: Math.cos(theta) * r, y, z: Math.sin(theta) * r })
  }
  return pts
}

function neighborPairs(pts: P3[]): Array<[number, number]> {
  const pairs: Array<[number, number]> = []
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const dx = pts[i].x - pts[j].x
      const dy = pts[i].y - pts[j].y
      const dz = pts[i].z - pts[j].z
      if (dx * dx + dy * dy + dz * dz < NEIGHBOR_DIST * NEIGHBOR_DIST) {
        pairs.push([i, j])
      }
    }
  }
  return pairs
}

function OrbCanvas({ diameter }: { diameter: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = diameter * dpr
    canvas.height = diameter * dpr
    ctx.scale(dpr, dpr)

    const base = spherePoints(POINT_COUNT)
    const pairs = neighborPairs(base)
    // Per-point twinkle boost (0..1) that decays each frame.
    const twinkle = new Float32Array(POINT_COUNT)

    const cx = diameter / 2
    const cy = diameter / 2
    const radius = diameter * 0.44
    const start = performance.now()
    let last = start
    let raf = 0

    const rotated: P3[] = base.map(() => ({ x: 0, y: 0, z: 0 }))

    function frame(now: number) {
      const dt = Math.min(now - last, 64)
      last = now
      const t = now - start

      const ay = (t / Y_PERIOD) * Math.PI * 2
      const wob = Math.sin(t / 4200) * 0.28 // slight axis wobble on X

      const cosY = Math.cos(ay)
      const sinY = Math.sin(ay)
      const cosW = Math.cos(wob)
      const sinW = Math.sin(wob)

      for (let i = 0; i < base.length; i++) {
        const p = base[i]
        const x1 = p.x * cosY + p.z * sinY
        const z1 = -p.x * sinY + p.z * cosY
        const y2 = p.y * cosW - z1 * sinW
        const z2 = p.y * sinW + z1 * cosW
        rotated[i].x = x1
        rotated[i].y = y2
        rotated[i].z = z2
      }

      // Twinkle a few points per second.
      if (Math.random() < (dt / 1000) * 2.5) {
        twinkle[(Math.random() * POINT_COUNT) | 0] = 1
      }
      for (let i = 0; i < POINT_COUNT; i++) {
        if (twinkle[i] > 0) twinkle[i] = Math.max(0, twinkle[i] - dt / 480)
      }

      const ctx2 = ctx as CanvasRenderingContext2D
      ctx2.clearRect(0, 0, diameter, diameter)

      // Constellation links first, so points sit on top.
      ctx2.lineWidth = 1
      for (const [i, j] of pairs) {
        const a = rotated[i]
        const b = rotated[j]
        const depth = (a.z + b.z) / 2 // -1..1
        const alpha = 0.05 + (depth + 1) * 0.05
        ctx2.strokeStyle = `rgba(237,237,239,${alpha.toFixed(3)})`
        ctx2.beginPath()
        ctx2.moveTo(cx + a.x * radius, cy + a.y * radius)
        ctx2.lineTo(cx + b.x * radius, cy + b.y * radius)
        ctx2.stroke()
      }

      for (let i = 0; i < POINT_COUNT; i++) {
        const p = rotated[i]
        const depth = (p.z + 1) / 2 // 0 (back) .. 1 (front)
        const tw = twinkle[i]
        const alpha = Math.min(0.95, 0.25 + depth * 0.65 + tw * 0.4)
        const size = 1 + depth * 0.5 + tw * 0.9
        ctx2.fillStyle = `rgba(237,237,239,${alpha.toFixed(3)})`
        ctx2.beginPath()
        ctx2.arc(cx + p.x * radius, cy + p.y * radius, size, 0, Math.PI * 2)
        ctx2.fill()
      }

      raf = requestAnimationFrame(frame)
    }

    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [diameter])

  return (
    <canvas
      ref={canvasRef}
      className="orb-canvas"
      style={{ width: diameter, height: diameter }}
      aria-hidden="true"
    />
  )
}

function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function OrbVisual({ diameter }: { diameter: number }) {
  // The dot fallback is CSS-animated and also respects reduced motion in CSS.
  if (prefersReducedMotion()) {
    return <span className="orb-dot" aria-hidden="true" style={{ margin: (diameter - 10) / 2 }} />
  }
  return <OrbCanvas diameter={diameter} />
}

export default function WorkingOrb({ label, size = 'pill' }: { label: string; size?: OrbSize }) {
  if (size === 'fill') {
    return (
      <div className="orb-overlay" role="status" aria-live="polite">
        <OrbVisual diameter={72} />
        <span>{label}</span>
      </div>
    )
  }
  return (
    <span className="orb-pill" role="status" aria-live="polite">
      <OrbVisual diameter={28} />
      <span>{label}</span>
    </span>
  )
}
