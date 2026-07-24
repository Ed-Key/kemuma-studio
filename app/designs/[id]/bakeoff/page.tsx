import Link from 'next/link'
import { getCatalogDb } from '@/lib/catalog/instance'
import { getDesignDetail } from '@/lib/catalog/catalog'
import { listLatestDraftPerModel } from '@/lib/catalog/drafts'
import { chooseWinnerAction } from './actions'

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
  if (!detail) return <main style={{ padding: 40 }}>Design not found.</main>
  const contestants = blindOrder(listLatestDraftPerModel(db, Number(id)).filter((d) => d.status === 'generated'))

  return (
    <main style={{ fontFamily: 'system-ui', padding: 40 }}>
      <p><Link href={`/designs/${detail.design_id}/draft`}>← Draft review</Link></p>
      <h1>Blind bake-off: {detail.name}</h1>
      <p>
        {contestants.length === 0
          ? 'No unapproved drafts to compare. Run: npx tsx scripts/bakeoff.ts ' + detail.design_id
          : 'Model names are hidden until you choose. Judge the copy.'}
      </p>
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        {contestants.map((d, i) => {
          const draft = JSON.parse(d.generated_json)
          return (
            <div key={d.draft_id} style={{ border: '1px solid #999', padding: 16, width: 380 }}>
              <h2>Contestant {String.fromCharCode(65 + i)}</h2>
              <p><strong>{draft.title}</strong></p>
              <p style={{ whiteSpace: 'pre-wrap', maxHeight: 320, overflowY: 'auto' }}>{draft.description}</p>
              <p>{draft.tags.join(' · ')}</p>
              <p>
                ${draft.price_usd}
                {d.cost_usd != null && ` · generation cost $${d.cost_usd.toFixed(3)}`}
              </p>
              <form action={chooseWinnerAction}>
                <input type="hidden" name="design_id" value={detail.design_id} />
                <input type="hidden" name="draft_id" value={d.draft_id} />
                <button type="submit">Choose {String.fromCharCode(65 + i)}</button>
              </form>
            </div>
          )
        })}
      </div>
    </main>
  )
}
