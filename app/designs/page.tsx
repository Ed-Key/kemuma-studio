import Link from 'next/link'
import { getCatalogDb } from '@/lib/catalog/instance'
import { listDesigns, getDesignDetail } from '@/lib/catalog/catalog'
import { latestDraftForDesign } from '@/lib/catalog/drafts'
import { listStagedForDesign } from '@/lib/catalog/staged'
import { listDimensionCardsForDesign } from '@/lib/catalog/dimcards'
import { SHOP_DRAFTS_URL, SHOP_LISTINGS_URL } from '@/lib/etsy/urls'
import { createDesignAction } from './actions'
import PendingSubmit from '../components/PendingSubmit'

export const dynamic = 'force-dynamic'

function statusFor(
  pieceStatuses: string[],
  onEtsy: boolean,
  published: boolean
): { label: string; cls: string } {
  if (pieceStatuses.length === 0) return { label: 'empty', cls: 'pill pill--none muted' }
  if (published) return { label: 'published', cls: 'pill pill--accent' }
  if (onEtsy) return { label: 'etsy draft', cls: 'pill pill--warn' }
  return { label: 'cataloged', cls: 'pill' }
}

// Order matches the real job: catalog, write, approve, push, review images, publish.
function nextAction(d: {
  pieceCount: number
  draftStatus: 'none' | 'generated' | 'approved'
  onEtsy: boolean
  published: boolean
  toReview: number
}): { stage: number; label: string } {
  if (d.pieceCount === 0) return { stage: 0, label: 'add a piece' }
  if (d.draftStatus === 'none') return { stage: 1, label: 'needs copy' }
  if (d.draftStatus === 'generated') return { stage: 2, label: 'approve the copy' }
  if (!d.onEtsy) return { stage: 3, label: 'ready to push' }
  if (d.toReview > 0) return { stage: 4, label: `${d.toReview} to review` }
  if (!d.published) return { stage: 5, label: 'publish it' }
  return { stage: 6, label: '' }
}

export default function DesignsPage() {
  const db = getCatalogDb()
  const designs = listDesigns(db)
  const cards = designs
    .map((d) => {
      const detail = getDesignDetail(db, d.design_id)
      const draft = latestDraftForDesign(db, d.design_id)
      const staged = listStagedForDesign(db, d.design_id)
      const dimCards = listDimensionCardsForDesign(db, d.design_id)
      const cover = detail?.pieces.flatMap((p) => p.photos)[0]?.photo_id ?? null
      const status = statusFor(
        detail?.pieces.map((p) => p.status) ?? [],
        detail?.etsy_listing_id != null,
        detail?.published_at != null
      )
      const next = nextAction({
        pieceCount: detail?.pieces.length ?? 0,
        draftStatus: draft?.status ?? 'none',
        onEtsy: detail?.etsy_listing_id != null,
        published: detail?.published_at != null,
        toReview:
          staged.filter((s) => s.status === 'candidate').length +
          dimCards.filter((c) => c.status === 'candidate').length,
      })
      return { ...d, cover, status, next }
    })
    .sort((a, b) => a.next.stage - b.next.stage || a.name.localeCompare(b.name))

  const totalPieces = designs.reduce((n, d) => n + d.piece_count, 0)
  const totalQty = designs.reduce((n, d) => n + d.total_quantity, 0)
  const pushed = cards.filter((c) => c.status.label === 'etsy draft' || c.status.label === 'published').length
  const live = cards.filter((c) => c.status.label === 'published').length

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
          <div className="stat-number">
            {pushed} pushed, {live} live
          </div>
          <div className="stat-label">
            On Etsy ·{' '}
            <a href={SHOP_LISTINGS_URL} target="_blank" rel="noreferrer">
              all listings
            </a>{' '}
            ·{' '}
            <a href={SHOP_DRAFTS_URL} target="_blank" rel="noreferrer">
              drafts
            </a>
          </div>
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
              {c.next.label ? <div className="meta-line mono">{c.next.label}</div> : null}
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
