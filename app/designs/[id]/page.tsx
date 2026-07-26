import Link from 'next/link'
import { getCatalogDb } from '@/lib/catalog/instance'
import { getDesignDetail } from '@/lib/catalog/catalog'
import { addPieceAction, markPublishedAction, uploadPhotosAction } from '../actions'
import ActionForm from '../../components/ActionForm'
import DesignHeader from '../../components/DesignHeader'
import PendingSubmit from '../../components/PendingSubmit'
import PhotoPicker from '../../components/PhotoPicker'

export const dynamic = 'force-dynamic'

/* The dot carries how far the piece is from being on Etsy, on the same three
   colours the catalog uses: green once it is listed, gold while it is only
   drafted or approved copy, grey before that. The word beside it carries the
   rest, so no status has to borrow the accent to be distinguishable. */
function pieceStatusPill(status: string) {
  const map: Record<string, string> = {
    listed: 'pill pill--ok',
    approved: 'pill pill--warn',
    drafted: 'pill pill--warn',
    cataloged: 'pill',
  }
  return map[status] ?? 'pill'
}

export default async function DesignDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const detail = getDesignDetail(getCatalogDb(), Number(id))
  if (!detail)
    return (
      <div>
        <p className="empty">
          Design not found. <Link href="/designs" className="text-link">Back to catalog</Link>
        </p>
      </div>
    )

  return (
    <div>
      <Link href="/designs" className="backlink">
        All designs
      </Link>

      {/* Only the action. Whether it is published is a fact and now sits in the
          header's facts line; showing it here as well said the same thing twice
          in two different shapes. */}
      <DesignHeader detail={detail} current="pieces">
        {detail.etsy_listing_id != null && !detail.published_at && (
          <ActionForm action={markPublishedAction}>
            <PendingSubmit pendingLabel="Marking published..." variant="ghost">
              Mark published
            </PendingSubmit>
            <input type="hidden" name="design_id" value={detail.design_id} />
          </ActionForm>
        )}
      </DesignHeader>

      <div className="card">
        <div className="card-title">Pieces</div>
        {detail.pieces.length === 0 ? (
          <p className="empty">No pieces yet. Add the first one below.</p>
        ) : (
          <table className="piece-table">
            <thead>
              <tr>
                <th>Colorway</th>
                <th>Dimensions</th>
                <th>Weight</th>
                <th>Qty</th>
                <th>Status</th>
                <th>Photos</th>
              </tr>
            </thead>
            <tbody>
              {detail.pieces.map((p) => (
                <tr key={p.piece_id}>
                  <td>
                    {p.colorway}
                    <div className="mono muted">#{p.piece_id}</div>
                  </td>
                  <td className="mono">
                    {p.height_in} x {p.width_in} x {p.depth_in} in
                    {/estimated/i.test(p.condition_notes ?? '') && (
                      <div>
                        <span className="pill pill--warn">estimated</span>
                      </div>
                    )}
                  </td>
                  <td className="mono">{p.weight_lb} lb</td>
                  <td className="mono">{p.quantity}</td>
                  <td>
                    <span className={pieceStatusPill(p.status)}>{p.status}</span>
                  </td>
                  <td>
                    <div className="thumb-row">
                      {p.photos.map((ph) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          key={ph.photo_id}
                          className="thumb"
                          src={`/api/photos/${ph.photo_id}`}
                          alt={`${detail.name}, ${p.colorway}`}
                        />
                      ))}
                    </div>
                    <ActionForm action={uploadPhotosAction} className="row upload-row">
                      <input type="hidden" name="piece_id" value={p.piece_id} />
                      <input type="hidden" name="design_id" value={detail.design_id} />
                      <PhotoPicker />
                      <PendingSubmit pendingLabel="Uploading..." variant="ghost">
                        Upload
                      </PendingSubmit>
                    </ActionForm>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card section" style={{ maxWidth: 460 }}>
        <div className="card-title">Add a piece</div>
        <ActionForm action={addPieceAction} className="form-grid">
          <input type="hidden" name="design_id" value={detail.design_id} />
          <label className="field">
            <span className="field-label">Colorway</span>
            <input className="input" name="colorway" placeholder="gray, rose, natural" required />
          </label>
          <div className="grid-3">
            <label className="field">
              <span className="field-label">Height (in)</span>
              <input className="input input--mono" name="height_in" type="number" step="0.1" required />
            </label>
            <label className="field">
              <span className="field-label">Width (in)</span>
              <input className="input input--mono" name="width_in" type="number" step="0.1" required />
            </label>
            <label className="field">
              <span className="field-label">Depth (in)</span>
              <input className="input input--mono" name="depth_in" type="number" step="0.1" required />
            </label>
          </div>
          <div className="grid-3">
            <label className="field">
              <span className="field-label">Weight (lb)</span>
              <input className="input input--mono" name="weight_lb" type="number" step="0.1" required />
            </label>
            <label className="field">
              <span className="field-label">Quantity</span>
              <input className="input input--mono" name="quantity" type="number" min="1" step="1" defaultValue={1} />
            </label>
          </div>
          <div className="action-row">
            <PendingSubmit pendingLabel="Adding piece..." variant="primary">
              Add piece
            </PendingSubmit>
          </div>
        </ActionForm>
      </div>
    </div>
  )
}
