import Link from 'next/link'
import { getCatalogDb } from '@/lib/catalog/instance'
import { listApprovedImages, DESTINATIONS } from '@/lib/catalog/staged'

export const dynamic = 'force-dynamic'

const DESTINATION_LABELS: Record<string, string> = {
  social: 'Social',
  pinterest: 'Pinterest',
  storefront: 'Storefront',
  storyboard: 'Shoot storyboards',
}

export default function MarketingPage() {
  const approved = listApprovedImages(getCatalogDb())

  return (
    <div>
      <div className="page-head">
        <h1>Marketing library</h1>
        <p className="eyebrow">approved AI-staged scenes · not for Etsy listing galleries</p>
      </div>

      {approved.length === 0 ? (
        <p className="empty">
          Nothing approved yet. Stage scenes from a design page and approve the keepers.
        </p>
      ) : (
        DESTINATIONS.map((dest) => {
          const rows = approved.filter((s) => s.destination === dest)
          if (rows.length === 0) return null
          return (
            <div key={dest} className="section">
              <div className="card-title">{DESTINATION_LABELS[dest]}</div>
              <div className="staged-grid">
                {rows.map((s) => (
                  <div key={s.staged_id} className="card stack-sm">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img className="staged-img" src={`/api/staged/${s.staged_id}`} alt={s.design_name} />
                    <div className="meta-line">
                      <Link href={`/designs/${s.design_id}/staging`}>{s.design_name}</Link>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )
        })
      )}
    </div>
  )
}
