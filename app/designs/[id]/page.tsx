import Link from 'next/link'
import { getCatalogDb } from '@/lib/catalog/instance'
import { getDesignDetail } from '@/lib/catalog/catalog'
import { addPieceAction, uploadPhotosAction } from '../actions'
import ActionForm from '../../components/ActionForm'
import PendingSubmit from '../../components/PendingSubmit'

export const dynamic = 'force-dynamic'

function pieceStatusPill(status: string) {
  const map: Record<string, string> = {
    listed: 'pill pill--accent',
    approved: 'pill pill--ok',
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
          Design not found. <Link href="/designs">Back to catalog</Link>
        </p>
      </div>
    )

  return (
    <div>
      <Link href="/designs" className="backlink">
        All designs
      </Link>

      <div className="between page-head">
        <div>
          <h1>{detail.name}</h1>
          <p className="eyebrow">
            {detail.family}
            {detail.notes ? ` · ${detail.notes}` : ''}
          </p>
        </div>
        <div className="row">
          {detail.etsy_listing_id ? (
            <a
              className="pill pill--accent"
              href="https://www.etsy.com/your/shops/me/tools/listings/state:draft"
              target="_blank"
              rel="noreferrer"
            >
              On Etsy {detail.etsy_listing_id}
            </a>
          ) : (
            <span className="pill pill--none muted">Not on Etsy</span>
          )}
          <Link href={`/designs/${detail.design_id}/draft`} className="btn btn--ghost">
            Listing draft
          </Link>
        </div>
      </div>

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
                    <ActionForm action={uploadPhotosAction} className="file-inline stack-sm">
                      <input type="hidden" name="piece_id" value={p.piece_id} />
                      <input type="hidden" name="design_id" value={detail.design_id} />
                      <input
                        type="file"
                        name="photos"
                        accept=".jpg,.jpeg,.png,.webp,.heic"
                        multiple
                        required
                      />
                      <div>
                        <PendingSubmit pendingLabel="Uploading..." variant="ghost">
                          Add photos
                        </PendingSubmit>
                      </div>
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
