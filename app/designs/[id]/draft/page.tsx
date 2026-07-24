import Link from 'next/link'
import { getCatalogDb } from '@/lib/catalog/instance'
import { getDesignDetail } from '@/lib/catalog/catalog'
import { latestDraftForDesign } from '@/lib/catalog/drafts'
import { generateDraftAction, approveDraftAction, pushToEtsyAction } from './actions'

export const dynamic = 'force-dynamic'

export default async function DraftPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const db = getCatalogDb()
  const detail = getDesignDetail(db, Number(id))
  if (!detail) return <main style={{ padding: 40 }}>Design not found.</main>
  const record = latestDraftForDesign(db, Number(id))
  const draft = record ? JSON.parse(record.final_json ?? record.generated_json) : null
  const photoIds = detail.pieces.flatMap((p) => p.photos.map((ph) => ph.photo_id)).slice(0, 6)

  return (
    <main style={{ fontFamily: 'system-ui', padding: 40, display: 'flex', gap: 32 }}>
      <div style={{ width: 320 }}>
        <p><Link href={`/designs/${detail.design_id}`}>← {detail.name}</Link></p>
        {photoIds.map((pid) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={pid} src={`/api/photos/${pid}`} alt="" style={{ width: '100%', marginBottom: 8 }} />
        ))}
      </div>

      <div style={{ flex: 1, maxWidth: 640 }}>
        <h1>Listing draft</h1>
        <form action={generateDraftAction}>
          <input type="hidden" name="design_id" value={detail.design_id} />
          <button type="submit">{draft ? 'Regenerate' : 'Generate draft'}</button>
          {record && <span style={{ marginLeft: 12 }}>status: {record.status} · model: {record.model}</span>}
        </form>

        {draft && record && (
          <>
            <form action={approveDraftAction} style={{ display: 'grid', gap: 10, marginTop: 20 }}>
              <input type="hidden" name="design_id" value={detail.design_id} />
              <input type="hidden" name="draft_id" value={record.draft_id} />
              <label>Title ({draft.title.length}/140)
                <input name="title" defaultValue={draft.title} style={{ width: '100%' }} />
              </label>
              <label>Description
                <textarea name="description" defaultValue={draft.description} rows={14} style={{ width: '100%' }} />
              </label>
              <fieldset style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
                <legend>Tags (13)</legend>
                {draft.tags.map((t: string, i: number) => (
                  <input key={i} name={`tag_${i}`} defaultValue={t} />
                ))}
              </fieldset>
              <label>Price (USD)
                <input name="price_usd" type="number" step="1" defaultValue={draft.price_usd} />
              </label>
              <label>Materials (comma separated)
                <input name="materials" defaultValue={draft.materials.join(', ')} style={{ width: '100%' }} />
              </label>
              <label>Colorway notes
                <input name="colorway_notes" defaultValue={draft.colorway_notes} style={{ width: '100%' }} />
              </label>
              <button type="submit" disabled={record.status === 'approved'}>
                {record.status === 'approved' ? 'Approved' : 'Approve'}
              </button>
            </form>
            {record.status === 'approved' && (
              <div style={{ marginTop: 20, borderTop: '1px solid #ccc', paddingTop: 12 }}>
                {detail.etsy_listing_id ? (
                  <p>
                    On Etsy as draft listing {detail.etsy_listing_id}.{' '}
                    <a href={`https://www.etsy.com/your/shops/me/tools/listings/state:draft`} target="_blank">
                      Open drafts in Shop Manager
                    </a>
                  </p>
                ) : (
                  <p>Not yet on Etsy.</p>
                )}
                <form action={pushToEtsyAction}>
                  <input type="hidden" name="design_id" value={detail.design_id} />
                  <button type="submit">{detail.etsy_listing_id ? 'Re-push updates to Etsy' : 'Push to Etsy as draft'}</button>
                </form>
              </div>
            )}
          </>
        )}
      </div>
    </main>
  )
}
