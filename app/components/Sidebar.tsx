'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const NAV = [
  {
    href: '/designs',
    label: 'Catalog',
    icon: (
      <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <rect x="1.5" y="1.5" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2" />
        <rect x="9.5" y="1.5" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2" />
        <rect x="1.5" y="9.5" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2" />
        <rect x="9.5" y="9.5" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.2" />
      </svg>
    ),
  },
  {
    href: '/intake',
    label: 'Intake',
    icon: (
      <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M8 1.8v7.4M8 9.2 5.2 6.6M8 9.2l2.8-2.6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M2.2 10.5v2.3c0 .6.5 1 1 1h9.6c.5 0 1-.4 1-1v-2.3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      </svg>
    ),
  },
]

export default function Sidebar() {
  const pathname = usePathname()
  return (
    <aside className="sidebar">
      <Link href="/designs" className="brand">
        Kemuma Studio
      </Link>
      <nav className="nav">
        {NAV.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + '/')
          return (
            <Link key={item.href} href={item.href} className={`nav-item${active ? ' active' : ''}`}>
              {item.icon}
              {item.label}
            </Link>
          )
        })}
      </nav>
      <div className="sidebar-foot">vintage Kisii soapstone</div>
    </aside>
  )
}
