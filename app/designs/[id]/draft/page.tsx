import Link from 'next/link'
import { getCatalogDb } from '@/lib/catalog/instance'
import { getDesignDetail } from '@/lib/catalog/catalog'
import { latestDraftForDesign } from '@/lib/catalog/drafts'
import { vocabForFamily } from '@/lib/etsy/attribute-vocab'
import { generateDraftAction, approveDraftAction, pushToEtsyAction } from './actions'
import ActionForm from '../../../components/ActionForm'
import DesignHeader from '../../../components/DesignHeader'
import JobArrival from '../../../components/JobArrival'
import PendingSubmit from '../../../components/PendingSubmit'
import TitleField from '../../../components/TitleField'

export const dynamic = 'force-dynamic'

export default async function DraftPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const db = getCatalogDb()
  const detail = getDesignDetail(db, Number(id))
  if (!detail) return <p className="empty">Design not found.</p>
  const record = latestDraftForDesign(db, Number(id))
  const draft = record ? JSON.parse(record.final_json ?? record.generated_json) : null
  const vocab = vocabForFamily(detail.family)
  const photoIds = detail.pieces.flatMap((p) => p.photos.map((ph) => ph.photo_id)).slice(0, 6)
  const approved = record?.status === 'approved'

  return (
    <div>
      <Link href="/designs" className="backlink">
        All designs
      </Link>

      <div className="split">
        <div className="photo-rail">
          {photoIds.length === 0 ? (
            <p className="empty">No photos yet.</p>
          ) : (
            photoIds.map((pid) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={pid}
                className="rail-photo"
                src={`/api/photos/${pid}`}
                alt={`${detail.name}, ${detail.family}`}
              />
            ))
          )}
        </div>

        <div className="stack">
          <DesignHeader detail={detail} current="draft" />
          <JobArrival destination={`/designs/${detail.design_id}/draft`} />

          <div className="card">
            <div className="between">
              <div>
                <div className="card-title" style={{ marginBottom: 4 }}>
                  {draft ? 'Rewrite the copy' : 'Write the copy'}
                </div>
                {record && (
                  /* The status is already stated by the tab chip above, and the
                     model id is provenance the owner needs about twice a year,
                     not every time they open a listing. It stays on the title so
                     it is one hover away. What is left is the one fact worth a
                     line of its own: what this copy cost to write. */
                  <p className="eyebrow" title={`written by ${record.model}`}>
                    {record.cost_usd != null
                      ? `Written for $${record.cost_usd.toFixed(3)}`
                      : 'Written by the studio writer'}
                  </p>
                )}
              </div>
              <ActionForm action={generateDraftAction}>
                <input type="hidden" name="design_id" value={detail.design_id} />
                <PendingSubmit
                  pendingLabel="Writing listing..."
                  orbState="composing"
                  variant={draft ? 'ghost' : 'primary'}
                >
                  {draft ? 'Regenerate' : 'Generate draft'}
                </PendingSubmit>
              </ActionForm>
            </div>
          </div>

          {/* The form below is keyed on the draft so regenerating swaps the
              whole thing. Every field in it is uncontrolled, and React only
              honours defaultValue when it builds the node: without the key it
              reuses the existing inputs and the new copy never lands, leaving
              the owner reading the previous draft while the header says it was
              just rewritten. */}
          {draft && record && (
            <ActionForm key={record.draft_id} action={approveDraftAction} className="stack">
              <input type="hidden" name="design_id" value={detail.design_id} />
              <input type="hidden" name="draft_id" value={record.draft_id} />

              <div className="card stack-sm">
                <div className="card-title">Listing copy</div>
                <TitleField defaultValue={draft.title} />
                <label className="field">
                  <span className="field-label">Description</span>
                  <textarea className="textarea" name="description" defaultValue={draft.description} rows={14} />
                </label>
              </div>

              <div className="card">
                <div className="card-title">Tags</div>
                <fieldset className="grid-3" style={{ border: 'none', padding: 0, margin: 0 }}>
                  <legend className="field-label" style={{ marginBottom: 8 }}>
                    13 tags
                  </legend>
                  {draft.tags.map((t: string, i: number) => (
                    <input key={i} className="input input--mono" name={`tag_${i}`} defaultValue={t} aria-label={`Tag ${i + 1}`} />
                  ))}
                </fieldset>
              </div>

              <div className="card stack-sm">
                <div className="card-title">Pricing</div>
                <div className="grid-3">
                  <label className="field">
                    <span className="field-label">Price (USD)</span>
                    <input className="input input--mono" name="price_usd" type="number" step="1" defaultValue={draft.price_usd} />
                  </label>
                </div>
                <label className="field">
                  <span className="field-label">Price justification</span>
                  <input className="input" name="price_justification" defaultValue={draft.price_justification ?? ''} />
                  <span className="field-note">Internal only. Not sent to Etsy.</span>
                </label>
              </div>

              <div className="card stack-sm">
                <div className="card-title">Details</div>
                <label className="field">
                  <span className="field-label">Materials</span>
                  <input className="input" name="materials" defaultValue={draft.materials.join(', ')} />
                  <span className="field-note">Comma separated.</span>
                </label>
                <label className="field">
                  <span className="field-label">Colorway notes</span>
                  <input className="input" name="colorway_notes" defaultValue={draft.colorway_notes} />
                </label>
                <div className="field">
                  <span className="field-label">Primary color</span>
                  <select className="select" name="primary_color" defaultValue={draft.primary_color ?? ''}>
                    <option value="">(none)</option>
                    {vocab.colors.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <span className="field-label">Secondary color</span>
                  <select className="select" name="secondary_color" defaultValue={draft.secondary_color ?? ''}>
                    <option value="">(none)</option>
                    {vocab.colors.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
                {vocab.artStyles && (
                  <div className="field">
                    <span className="field-label">Art style</span>
                    <select className="select" name="art_style" defaultValue={draft.art_style ?? ''}>
                      <option value="">(none)</option>
                      {vocab.artStyles.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              <div className="action-row">
                <PendingSubmit pendingLabel="Approving..." orbState="working" variant="primary">
                  {approved ? 'Save and re-approve' : 'Approve'}
                </PendingSubmit>
              </div>
            </ActionForm>
          )}

          {(approved || detail.etsy_listing_id != null) && (
            <div className="card stack-sm">
              <div className="card-title">Etsy</div>
              {detail.etsy_listing_id != null && !approved ? (
                <span className="pill pill--warn">draft rewritten since the last push</span>
              ) : detail.etsy_listing_id ? (
                <p className="muted">Live as draft listing {detail.etsy_listing_id}.</p>
              ) : (
                <p className="muted">Not yet on Etsy.</p>
              )}
              <ActionForm action={pushToEtsyAction}>
                <input type="hidden" name="design_id" value={detail.design_id} />
                <div className="action-row">
                  <PendingSubmit
                    pendingLabel="Pushing to Etsy..."
                    orbState="working"
                    variant="primary"
                    disabled={!approved}
                  >
                    {detail.etsy_listing_id ? 'Re-push updates to Etsy' : 'Push to Etsy as draft'}
                  </PendingSubmit>
                </div>
                {!approved && <p className="field-note">Approve the copy to push these edits.</p>}
              </ActionForm>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
