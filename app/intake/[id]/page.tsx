import Link from 'next/link'
import { getCatalogDb } from '@/lib/catalog/instance'
import { getIntake } from '@/lib/catalog/intakes'
import { listDesigns } from '@/lib/catalog/catalog'
import { loadCandidates } from '@/lib/matcher/match'
import type { MatchProposal } from '@/lib/matcher/schema'
import { confirmIntakeAction } from '../actions'
import PendingSubmit from '../../components/PendingSubmit'

export const dynamic = 'force-dynamic'

export default async function IntakeReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const db = getCatalogDb()
  const intake = getIntake(db, Number(id))
  if (!intake) return <p className="empty">Intake not found.</p>
  const proposal = JSON.parse(intake.proposal_json ?? 'null') as MatchProposal | null
  const designs = listDesigns(db)
  const proposedName = designs.find((d) => d.design_id === proposal?.design_id)?.name
  const exemplar = loadCandidates(db).find((c) => c.design_id === proposal?.design_id)

  const verdict =
    proposal?.decision === 'existing' && proposedName
      ? `Looks like another ${proposedName}`
      : proposal?.decision === 'new'
        ? 'Looks like a new design'
        : 'Not sure. Your call.'

  return (
    <div>
      <Link href="/intake" className="backlink">
        Intake
      </Link>
      <div className="page-head">
        <h1>
          Intake {intake.intake_id}
          {intake.status === 'confirmed' ? ' (confirmed)' : ''}
        </h1>
        <p className="eyebrow">The matcher proposes where this piece belongs.</p>
      </div>

      <div className="card stack-sm" style={{ maxWidth: 640 }}>
        <div className="verdict">{verdict}</div>
        {proposal && (
          <>
            <p className="mono muted">
              decision {proposal.decision}
              {proposal.decision === 'existing' ? ` · confidence ${proposal.confidence}` : ''}
            </p>
            <p className="evidence">{proposal.evidence}</p>
          </>
        )}
        {exemplar && proposal?.decision === 'existing' && (
          <p>
            Proposed match:{' '}
            <Link href={`/designs/${exemplar.design_id}`} className="text-link">
              {exemplar.name}
            </Link>
          </p>
        )}
      </div>

      {intake.status === 'pending' && (
        <form action={confirmIntakeAction} className="stack" style={{ maxWidth: 640, marginTop: 20 }}>
          <input type="hidden" name="intake_id" value={intake.intake_id} />

          <div className="stack-sm">
            <label className="select-row">
              <input
                type="radio"
                name="choice"
                value="proposed"
                defaultChecked={proposal?.decision === 'existing'}
                disabled={proposal?.design_id == null}
              />
              Accept the proposal{proposedName ? ` (${proposedName})` : ''}
            </label>
            <label className="select-row">
              <input type="radio" name="choice" value="other" />
              Different existing design
              <select name="other_design_id" className="select" style={{ marginTop: 8 }}>
                {designs.map((d) => (
                  <option key={d.design_id} value={d.design_id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="select-row">
              <input
                type="radio"
                name="choice"
                value="new"
                defaultChecked={proposal?.decision !== 'existing'}
              />
              New design
            </label>
          </div>

          <div className="card stack-sm">
            <div className="card-title">New design (if chosen)</div>
            <div className="grid-3">
              <label className="field">
                <span className="field-label">Name</span>
                <input className="input" name="new_name" placeholder="Design name" />
              </label>
              <label className="field">
                <span className="field-label">Family</span>
                <input className="input" name="new_family" placeholder="figure, bowl" />
              </label>
            </div>
          </div>

          <div className="card stack-sm">
            <div className="card-title">This piece</div>
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
          </div>

          <div className="action-row">
            <PendingSubmit pendingLabel="Confirming..." orbState="working" variant="primary">
              Confirm intake
            </PendingSubmit>
          </div>
        </form>
      )}
    </div>
  )
}
