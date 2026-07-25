import Link from 'next/link'
import { getCatalogDb } from '@/lib/catalog/instance'
import { getDesignDetail } from '@/lib/catalog/catalog'
import { listStagedForDesign, DESTINATIONS } from '@/lib/catalog/staged'
import { listDimensionCardsForDesign } from '@/lib/catalog/dimcards'
import { getChatForDesign, type ChatMessage } from '@/lib/catalog/chats'
import { scenesForFamily, SCENES } from '@/lib/staging/scenes'
import ActionForm from '../../../components/ActionForm'
import DesignHeader from '../../../components/DesignHeader'
import JobArrival from '../../../components/JobArrival'
import PendingSubmit from '../../../components/PendingSubmit'
import {
  stageDesignAction,
  approveStagedAction,
  rejectStagedAction,
  generateDimensionCardAction,
  approveDimensionCardAction,
  rejectDimensionCardAction,
  chatTurnAction,
  executePlanAction,
  discardPlanAction,
  attachCardToEtsyAction,
  attachSceneToEtsyAction,
} from './actions'

export const dynamic = 'force-dynamic'

const DESTINATION_LABELS: Record<string, string> = {
  social: 'Social',
  pinterest: 'Pinterest',
  storefront: 'Storefront',
  storyboard: 'Shoot storyboard',
}

export default async function StagingPage({ params }: { params: Promise<{ id: string }> }) {
  const sceneLabel = (key: string) => SCENES.find((s) => s.key === key)?.label ?? 'Custom scene'
  const { id } = await params
  const db = getCatalogDb()
  const detail = getDesignDetail(db, Number(id))
  if (!detail) return <p className="empty">Design not found.</p>
  const scenes = scenesForFamily(detail.family)
  // The caption on a reference-photo tile only has to say which piece the photo
  // is of, and the dimensions are the same for every photo of a piece, so the
  // colorway carries it alone. The parenthetical spelling-out of an assorted
  // colorway ("assorted (pink blue tan magenta)") belongs to the pieces table,
  // not to a 72px tile; the full string stays on the title attribute.
  const photos = detail.pieces.flatMap((p) =>
    p.photos.map((ph) => ({
      photo_id: ph.photo_id,
      colorway: p.colorway,
      short: p.colorway.replace(/\s*\(.*\)\s*$/, ''),
    }))
  )
  const staged = listStagedForDesign(db, Number(id))
  const dimCards = listDimensionCardsForDesign(db, Number(id))
  const chat = getChatForDesign(db, Number(id))
  const chatMessages: ChatMessage[] = chat ? JSON.parse(chat.messages_json) : []
  const pendingPlan = chat?.pending_plan_json ? JSON.parse(chat.pending_plan_json) : null

  return (
    <div>
      <Link href="/designs" className="backlink">
        All designs
      </Link>
      <DesignHeader detail={detail} current="staging" />
      <JobArrival destination={`/designs/${detail.design_id}/staging`} />

      <p className="policy-note">
        Approved images ship to marketing channels only. Etsy listing galleries stay real
        photographs per Etsy&apos;s Creativity Standards.
      </p>

      <div className="card section stack-sm">
        <div className="card-title">Stage a new batch</div>
        <ActionForm action={stageDesignAction} className="stack-sm">
          <input type="hidden" name="design_id" value={detail.design_id} />
          <div className="field field--options">
            <span className="field-label">Scene</span>
            <label className="select-row select-row--wide">
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
                    <span className="photo-caption" title={p.colorway}>
                      {p.short}
                    </span>
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

      <div className="card section stack-sm">
        <div className="card-title">Dimension card</div>
        <p className="policy-note">
          Real photo cutout with measured arrows; no AI. Approved cards are eligible for the
          Etsy listing gallery. Use a photo showing the whole piece.
        </p>
        {detail.pieces.some((p) => /estimated/i.test(p.condition_notes ?? '')) && (
          <p className="policy-note">
            These measurements are still estimates. The numbers printed on the card come straight from the
            catalog, so verify them before attaching the card to a listing.
          </p>
        )}
        <ActionForm action={generateDimensionCardAction} className="stack-sm">
          <input type="hidden" name="design_id" value={detail.design_id} />
          {photos.length > 1 && (
            <div className="photo-choice-row">
              {photos.map((p, i) => (
                <label key={p.photo_id} className="photo-choice">
                  <input type="radio" name="source_photo_id" value={p.photo_id} defaultChecked={i === 0} />
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/photos/${p.photo_id}`} alt={`${detail.name}, ${p.colorway}`} />
                  <span className="photo-caption" title={p.colorway}>
                    {p.short}
                  </span>
                </label>
              ))}
            </div>
          )}
          <div className="action-row">
            <PendingSubmit pendingLabel="Drawing card..." orbState="working" variant="primary">
              Generate dimension card
            </PendingSubmit>
          </div>
        </ActionForm>
        {dimCards.length > 0 && (
          <div className="staged-grid">
            {dimCards.map((c) => (
              <div key={c.card_id} className="card stack-sm">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className="staged-img" src={`/api/dimcards/${c.card_id}`} alt={`${detail.name} dimensions`} />
                <div className="meta-line mono">
                  {c.height_in} x {c.width_in} in
                </div>
                {c.status === 'approved' && (
                  <div className="stack-sm">
                    <span className="pill pill--ok">approved</span>
                    {c.etsy_uploaded_at ? (
                      <span className="pill pill--ok">On the Etsy listing</span>
                    ) : detail.etsy_listing_id ? (
                      <ActionForm action={attachCardToEtsyAction} className="action-row">
                        <input type="hidden" name="design_id" value={detail.design_id} />
                        <input type="hidden" name="card_id" value={c.card_id} />
                        <PendingSubmit pendingLabel="Adding to listing..." orbState="working" variant="primary">
                          Add to Etsy listing
                        </PendingSubmit>
                      </ActionForm>
                    ) : (
                      <span className="muted">Push the listing to Etsy to attach this card.</span>
                    )}
                  </div>
                )}
                {c.status === 'rejected' && <span className="pill pill--danger">rejected</span>}
                {c.status === 'candidate' && (
                  <div className="stack-sm">
                    <ActionForm action={approveDimensionCardAction} className="action-row">
                      <input type="hidden" name="design_id" value={detail.design_id} />
                      <input type="hidden" name="card_id" value={c.card_id} />
                      <PendingSubmit pendingLabel="Approving..." variant="primary">
                        Approve
                      </PendingSubmit>
                    </ActionForm>
                    <ActionForm action={rejectDimensionCardAction} className="action-row">
                      <input type="hidden" name="design_id" value={detail.design_id} />
                      <input type="hidden" name="card_id" value={c.card_id} />
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

      <div className="card section stack-sm">
        <div className="card-title">Staging director</div>
        <p className="policy-note">
          Tell it how this piece lives (what it holds, its story) and it plans a custom scene.
          It looks at the photos and catalog before planning; you approve every generation.
        </p>
        {chat?.staging_notes && (
          <p className="chat-note">Staging notes: {chat.staging_notes}</p>
        )}
        {chatMessages.length > 0 && (
          <div className="chat-log">
            {chatMessages.map((m, i) => (
              <div key={i} className={`chat-msg chat-msg--${m.role}`}>
                <span className="chat-role">{m.role === 'user' ? 'You' : 'Director'}</span>
                <p>{m.text}</p>
              </div>
            ))}
          </div>
        )}
        <ActionForm action={chatTurnAction} className="stack-sm">
          <input type="hidden" name="design_id" value={detail.design_id} />
          <textarea
            className="textarea"
            name="message"
            rows={3}
            placeholder="e.g. I keep my jewelry in this dish. Stage it with a thin gold chain draped over the edge."
            required
          />
          <div className="action-row">
            <PendingSubmit pendingLabel="Director is thinking..." orbState="composing" variant="primary">
              Send
            </PendingSubmit>
          </div>
        </ActionForm>
        {pendingPlan && (
          <div className="plan-card stack-sm">
            <div className="card-title">Planned batch</div>
            <p className="plan-scene">{pendingPlan.scene}</p>
            <p className="mono muted">
              {pendingPlan.n} images · {pendingPlan.size} · {pendingPlan.reference_photo_ids.length} reference
              photo{pendingPlan.reference_photo_ids.length > 1 ? 's' : ''} · about ${(pendingPlan.n * 0.2).toFixed(2)}
            </p>
            <div className="row">
              <ActionForm action={executePlanAction} className="action-row">
                <input type="hidden" name="design_id" value={detail.design_id} />
                <PendingSubmit pendingLabel="Staging planned scene..." orbState="working" variant="primary">
                  Generate {pendingPlan.n}
                </PendingSubmit>
              </ActionForm>
              <ActionForm action={discardPlanAction} className="action-row">
                <input type="hidden" name="design_id" value={detail.design_id} />
                <PendingSubmit pendingLabel="Discarding..." variant="ghost">
                  Discard plan
                </PendingSubmit>
              </ActionForm>
            </div>
          </div>
        )}
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
                {/* The scene is the name of a set, not a machine value, so only
                    the cost beside it stays in mono. */}
                <div className="staged-caption">
                  {sceneLabel(s.scene_key)}
                  {s.cost_usd != null ? (
                    <span className="mono muted"> · ${s.cost_usd.toFixed(3)}</span>
                  ) : null}
                </div>
                {s.status === 'approved' && (
                  <div className="stack-sm">
                    <span className="pill pill--ok">{DESTINATION_LABELS[s.destination ?? ''] ?? s.destination}</span>
                    {s.etsy_uploaded_at ? (
                      <span className="pill pill--ok">On the Etsy listing</span>
                    ) : detail.etsy_listing_id ? (
                      <ActionForm action={attachSceneToEtsyAction} className="stack-sm">
                        <input type="hidden" name="design_id" value={detail.design_id} />
                        <input type="hidden" name="staged_id" value={s.staged_id} />
                        <label className="ack-row">
                          <input type="checkbox" name="acknowledge" required />
                          <span>
                            I understand Etsy requires real photos in listing galleries; attaching an
                            AI-staged scene is at my own risk.
                          </span>
                        </label>
                        <div className="action-row">
                          <PendingSubmit pendingLabel="Adding to listing..." orbState="working" variant="ghost">
                            Add to Etsy listing
                          </PendingSubmit>
                        </div>
                      </ActionForm>
                    ) : null}
                  </div>
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
