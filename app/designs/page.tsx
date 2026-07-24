import Link from 'next/link'
import { getCatalogDb } from '@/lib/catalog/instance'
import { listDesigns, getDesignDetail } from '@/lib/catalog/catalog'
import { createDesignAction } from './actions'
import PendingSubmit from '../components/PendingSubmit'

export const dynamic = 'force-dynamic'

function statusFor(pieceStatuses: string[], onEtsy: boolean): { label: string; cls: string } {
  if (pieceStatuses.length === 0) return { label: 'empty', cls: 'pill pill--none muted' }
  const listed = pieceStatuses.filter((s) => s === 'listed').length
  if (onEtsy || listed === pieceStatuses.length) return { label: 'listed', cls: 'pill pill--accent' }
  if (listed > 0) return { label: 'partly listed', cls: 'pill pill--warn' }
  return { label: 'cataloged', cls: 'pill' }
}

export default function DesignsPage() {
  const db = getCatalogDb()
  const designs = listDesigns(db)
  const cards = designs.map((d) => {
    const detail = getDesignDetail(db, d.design_id)
    const cover = detail?.pieces.flatMap((p) => p.photos)[0]?.photo_id ?? null
    const status = statusFor(
      detail?.pieces.map((p) => p.status) ?? [],
      detail?.etsy_listing_id != null
    )
    return { ...d, cover, status }
  })

  const totalPieces = designs.reduce((n, d) => n + d.piece_count, 0)
  const totalQty = designs.reduce((n, d) => n + d.total_quantity, 0)
  const onEtsy = cards.filter((c) => c.status.label === 'listed').length

  return (
    <div>
      <div className="page-head">
        <h1>Catalog</h1>
        <p className="eyebrow">Vintage Kisii soapstone, catalogued for Etsy.</p>
      </div>

      <div className="stat-row">
        <div className="stat-card">
          <div className="stat-number">{designs.length}</div>
          <div className="stat-label">Designs</div>
        </div>
        <div className="stat-card">
          <div className="stat-number">{totalPieces}</div>
          <div className="stat-label">Pieces, {totalQty} total quantity</div>
        </div>
        <div className="stat-card">
          <div className="stat-number">{onEtsy}</div>
          <div className="stat-label">On Etsy</div>
        </div>
      </div>

      <div className="design-grid">
        {cards.map((c) => (
          <Link key={c.design_id} href={`/designs/${c.design_id}`} className="design-card">
            {c.cover ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="design-cover" src={`/api/photos/${c.cover}`} alt={`${c.name}, ${c.family}`} />
            ) : (
              <div className="design-cover design-cover--empty">No photo yet</div>
            )}
            <div className="design-body">
              <div className="design-name">{c.name}</div>
              <div className="design-meta">
                <span className="design-family">{c.family}</span>
                <span className="design-qty">qty {c.total_quantity}</span>
              </div>
              <span className={c.status.cls}>{c.status.label}</span>
            </div>
          </Link>
        ))}

        <details className="ghost-card">
          <summary>+ New design</summary>
          <form action={createDesignAction} className="form-grid">
            <label className="field">
              <span className="field-label">Name</span>
              <input className="input" name="name" placeholder="Eternity Love Knot" required />
            </label>
            <label className="field">
              <span className="field-label">Family</span>
              <input className="input" name="family" placeholder="love knot, bowl, elephant" required />
            </label>
            <div className="action-row">
              <PendingSubmit pendingLabel="Creating..." orbState="working" variant="primary">
                Create design
              </PendingSubmit>
            </div>
          </form>
        </details>
      </div>
    </div>
  )
}
