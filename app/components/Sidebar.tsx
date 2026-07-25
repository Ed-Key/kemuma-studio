'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'

/* The rail shows itself once on load, then gets out of the way. Leaving it
   waits a beat so a pointer that clips the corner on its way past does not snap
   it shut mid-reach. */
const IDLE_MS = 2600
const GRACE_MS = 450

const NAV = [
  {
    href: '/designs',
    label: 'Catalog',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
        <rect x="3" y="3" width="7" height="7" />
        <rect x="14" y="3" width="7" height="7" />
        <rect x="3" y="14" width="7" height="7" />
        <rect x="14" y="14" width="7" height="7" />
      </svg>
    ),
  },
  {
    href: '/intake',
    label: 'Intake',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
        <path d="M12 3v12" />
        <path d="m7 10 5 5 5-5" />
        <path d="M4 20h16" />
      </svg>
    ),
  },
  {
    href: '/marketing',
    label: 'Marketing',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
        <rect x="3" y="4" width="18" height="15" />
        <circle cx="8.5" cy="9.5" r="1.6" />
        <path d="m4 17 5-5 4 4 3-2 4 4" />
      </svg>
    ),
  },
]

/** Read in the layout, which is a server component; the rail owns the collapse
 *  timers so it has to be a client component and cannot query the db itself. */
export type NavCounts = Record<string, number>

export default function Sidebar({ counts }: { counts?: NavCounts }) {
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const arm = useCallback((ms: number) => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setCollapsed(true), ms)
  }, [])

  const open = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    setCollapsed(false)
  }, [])

  useEffect(() => {
    arm(IDLE_MS)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [arm])

  return (
    <div className="rail">
      {/* onFocus/onBlur are React's focusin/focusout, so they fire for anything
          inside the rail: tabbing in opens it, tabbing out closes it on the
          same grace the pointer gets. */}
      <aside
        className="sidebar"
        data-collapsed={collapsed}
        onMouseEnter={open}
        onMouseLeave={() => arm(GRACE_MS)}
        onFocus={open}
        onBlur={() => arm(GRACE_MS)}
      >
        <Link href="/designs" className="brand" aria-label="Kemuma Carvings">
          <span className="crest">
            <img src="/brand/shop-logo.jpg" alt="" width={38} height={38} />
          </span>
          <span className="wordmark">
            Kemuma
            <small>Carvings</small>
          </span>
        </Link>
        <div className="origin">
          <img src="/brand/flag-ke.svg" alt="Kenya" width={15} height={15} />
          <span>Tabaka, Kisii</span>
        </div>
        <nav className="nav">
          {NAV.map((item) => {
            const active = pathname === item.href || pathname.startsWith(item.href + '/')
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`nav-item${active ? ' active' : ''}`}
                aria-current={active ? 'page' : undefined}
                /* The visible label folds to zero width when the rail closes,
                   so the accessible name cannot come from it. */
                aria-label={item.label}
              >
                {item.icon}
                <span className="nav-label">{item.label}</span>
                {counts?.[item.href] != null && (
                  /* Folds away with the label when the rail closes, so the
                     collapsed rail stays a clean column of glyphs. */
                  <span className="nav-count">{counts[item.href]}</span>
                )}
              </Link>
            )
          })}
        </nav>
      </aside>
    </div>
  )
}
