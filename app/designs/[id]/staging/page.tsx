import Link from 'next/link'
import { getCatalogDb } from '@/lib/catalog/instance'
import { getDesignDetail } from '@/lib/catalog/catalog'
import { listStagedForDesign, DESTINATIONS } from '@/lib/catalog/staged'
import { scenesForFamily, getScene } from '@/lib/staging/scenes'
import ActionForm from '../../../components/ActionForm'
import PendingSubmit from '../../../components/PendingSubmit'
import { stageDesignAction, approveStagedAction, rejectStagedAction } from './actions'

export const dynamic = 'force-dynamic'

const DESTINATION_LABELS: Record<string, string> = {
  social: 'Social',
  pinterest: 'Pinterest',
  storefront: 'Storefront',
  storyboard: 'Shoot storyboard',
}

export default async function StagingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const db = getCatalogDb()
  const detail = getDesignDetail(db, Number(id))
  if (!detail) return <p className="empty">Design not found.</p>
  const scenes = scenesForFamily(detail.family)
  const photos = detail.pieces.flatMap((p) =>
    p.photos.map((ph) => ({ photo_id: ph.photo_id, colorway: p.colorway }))
  )
  const staged = listStagedForDesign(db, Number(id))

  return (
    <div>
      <Link href={`/designs/${detail.design_id}`} className="backlink">
        {detail.name}
      </Link>
      <div className="page-head">
        <h1>Staging</h1>
        <p className="eyebrow">{detail.family} · AI lifestyle scenes for marketing</p>
      </div>

      <p className="policy-note">
        Approved images ship to marketing channels only. Etsy listing galleries stay real
        photographs per Etsy&apos;s Creativity Standards.
      </p>

      <div className="card section stack-sm">
        <div className="card-title">Stage a new batch</div>
        <ActionForm action={stageDesignAction} className="stack-sm">
          <input type="hidden" name="design_id" value={detail.design_id} />
          <div className="field">
            <span className="field-label">Scene</span>
            <label className="select-row">
              <input type="radio" name="scene_key" value="auto" defaultChecked />
              <span>
                Rotate automatically
                <span className="muted"> · least-used scene for this design</span>
              </span>
            </label>
            {scenes.map((s) => (
              <label key={s.key} className="select-row">
                <input type="radio" name="scene_key" value={s.key} />
                <span>{s.label}</span>
              </label>
            ))}
          </div>
          {photos.length > 1 && (
            <div className="field">
              <span className="field-label">Reference photo</span>
              <div className="photo-choice-row">
                {photos.map((p, i) => (
                  <label key={p.photo_id} className="photo-choice">
                    <input
                      type="radio"
                      name="source_photo_id"
                      value={p.photo_id}
                      defaultChecked={i === 0}
                    />
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/photos/${p.photo_id}`} alt={`${detail.name}, ${p.colorway}`} />
                  </label>
                ))}
              </div>
            </div>
          )}
          <label className="select-row">
            <input type="checkbox" name="variance" defaultChecked />
            <span>
              Vary pose and angle
              <span className="muted"> · four different arrangements from up to three reference views</span>
            </span>
          </label>
          <div className="action-row">
            <PendingSubmit pendingLabel="Staging four scenes..." orbState="composing" variant="primary">
              Stage four scenes
            </PendingSubmit>
          </div>
        </ActionForm>
      </div>

      <div className="section">
        {staged.length === 0 ? (
          <p className="empty">No staged images yet.</p>
        ) : (
          <div className="staged-grid">
            {staged.map((s) => (
              <div key={s.staged_id} className="card stack-sm">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className="staged-img" src={`/api/staged/${s.staged_id}`} alt={detail.name} />
                <div className="meta-line mono">
                  {getScene(s.scene_key).label}
                  {s.cost_usd != null ? ` · $${s.cost_usd.toFixed(3)}` : ''}
                </div>
                {s.status === 'approved' && (
                  <span className="pill pill--ok">{DESTINATION_LABELS[s.destination ?? ''] ?? s.destination}</span>
                )}
                {s.status === 'rejected' && <span className="pill pill--danger">rejected</span>}
                {s.status === 'candidate' && (
                  <div className="stack-sm">
                    <ActionForm action={approveStagedAction} className="action-row">
                      <input type="hidden" name="design_id" value={detail.design_id} />
                      <input type="hidden" name="staged_id" value={s.staged_id} />
                      <select className="select" name="destination" defaultValue="social">
                        {DESTINATIONS.map((d) => (
                          <option key={d} value={d}>
                            {DESTINATION_LABELS[d]}
                          </option>
                        ))}
                      </select>
                      <PendingSubmit pendingLabel="Approving..." variant="primary">
                        Approve
                      </PendingSubmit>
                    </ActionForm>
                    <ActionForm action={rejectStagedAction} className="action-row">
                      <input type="hidden" name="design_id" value={detail.design_id} />
                      <input type="hidden" name="staged_id" value={s.staged_id} />
                      <PendingSubmit pendingLabel="Rejecting..." variant="ghost">
                        Reject
                      </PendingSubmit>
                    </ActionForm>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
