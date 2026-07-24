import Link from 'next/link'
import { getCatalogDb } from '@/lib/catalog/instance'
import { getDesignDetail } from '@/lib/catalog/catalog'
import { listLatestDraftPerModel } from '@/lib/catalog/drafts'
import { chooseWinnerAction } from './actions'
import PendingSubmit from '../../../components/PendingSubmit'

export const dynamic = 'force-dynamic'

// Deterministic shuffle so labels are stable across reloads but not in
// generation order (which would leak which model is which).
function blindOrder<T extends { draft_id: number }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => ((a.draft_id * 2654435761) >>> 0) - ((b.draft_id * 2654435761) >>> 0))
}

export default async function BakeoffPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const db = getCatalogDb()
  const detail = getDesignDetail(db, Number(id))
  if (!detail) return <p className="empty">Design not found.</p>
  const contestants = blindOrder(
    listLatestDraftPerModel(db, Number(id)).filter((d) => d.status === 'generated')
  )
  const photoIds = detail.pieces.flatMap((p) => p.photos.map((ph) => ph.photo_id)).slice(0, 6)

  return (
    <div>
      <Link href={`/designs/${detail.design_id}/draft`} className="backlink">
        Draft review
      </Link>
      <div className="page-head">
        <h1>Blind bake-off</h1>
        <p className="eyebrow">
          {detail.name} ·{' '}
          {contestants.length === 0
            ? `no unapproved drafts to compare. Run: npx tsx scripts/bakeoff.ts ${detail.design_id}`
            : 'model names are hidden until you choose. Judge the copy.'}
        </p>
      </div>

      {contestants.length === 0 ? (
        <p className="empty">Nothing to compare yet.</p>
      ) : (
        <div className="bakeoff-row">
          {contestants.map((d, i) => {
            const draft = JSON.parse(d.generated_json)
            const label = String.fromCharCode(65 + i)
            return (
              <div key={d.draft_id} className="card stack-sm">
                <div className="photo-strip">
                  {photoIds.map((pid) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={pid}
                      className="strip-photo"
                      src={`/api/photos/${pid}`}
                      alt={`${detail.name}, ${detail.family}`}
                    />
                  ))}
                </div>
                <div className="contestant-label">Contestant {label}</div>
                <h2>{draft.title}</h2>
                <p className="contestant-desc">{draft.description}</p>
                <p className="tag-list">{draft.tags.join(' · ')}</p>
                <p className="mono">
                  ${draft.price_usd}
                  {d.cost_usd != null ? ` · gen cost $${d.cost_usd.toFixed(3)}` : ''}
                </p>
                {draft.price_justification && (
                  <p className="price-why">Why this price: {draft.price_justification}</p>
                )}
                <form action={chooseWinnerAction} className="action-row">
                  <input type="hidden" name="design_id" value={detail.design_id} />
                  <input type="hidden" name="draft_id" value={d.draft_id} />
                  <PendingSubmit pendingLabel="Selecting winner..." orbState="working" variant="primary">
                    Choose {label}
                  </PendingSubmit>
                </form>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
