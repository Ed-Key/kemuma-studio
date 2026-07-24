import Link from 'next/link'
import { getCatalogDb } from '@/lib/catalog/instance'
import { getIntake } from '@/lib/catalog/intakes'
import { listDesigns } from '@/lib/catalog/catalog'
import { loadCandidates } from '@/lib/matcher/match'
import type { MatchProposal } from '@/lib/matcher/schema'
import { confirmIntakeAction } from '../actions'

export const dynamic = 'force-dynamic'

export default async function IntakeReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const db = getCatalogDb()
  const intake = getIntake(db, Number(id))
  if (!intake) return <main style={{ padding: 40 }}>Intake not found.</main>
  const proposal = JSON.parse(intake.proposal_json ?? 'null') as MatchProposal | null
  const designs = listDesigns(db)
  const proposedName = designs.find((d) => d.design_id === proposal?.design_id)?.name
  const exemplar = loadCandidates(db).find((c) => c.design_id === proposal?.design_id)

  return (
    <main style={{ fontFamily: 'system-ui', padding: 40, maxWidth: 820 }}>
      <p><Link href="/intake">← Intake</Link></p>
      <h1>Intake {intake.intake_id} {intake.status === 'confirmed' ? '(confirmed)' : ''}</h1>

      <h2>Matcher says: {proposal?.decision ?? 'no proposal'}</h2>
      {proposal && (
        <p>
          {proposal.decision === 'existing' && proposedName
            ? `Looks like another "${proposedName}" (confidence: ${proposal.confidence}).`
            : proposal.decision === 'new'
              ? 'Looks like a design not yet in the catalog.'
              : 'Not sure; your call.'}
          <br />
          Evidence: {proposal.evidence}
        </p>
      )}
      {exemplar && proposal?.decision === 'existing' && (
        <p>
          Proposed match exemplar:{' '}
          {/* the exemplar is a catalog photo; find its id via the photos api is overkill here,
              show the design link instead */}
          <Link href={`/designs/${exemplar.design_id}`}>{exemplar.name}</Link>
        </p>
      )}

      {intake.status === 'pending' && (
        <form action={confirmIntakeAction} style={{ display: 'grid', gap: 10, maxWidth: 420 }}>
          <input type="hidden" name="intake_id" value={intake.intake_id} />
          <label>
            <input type="radio" name="choice" value="proposed" defaultChecked={proposal?.decision === 'existing'} disabled={proposal?.design_id == null} />
            {' '}Accept the proposal{proposedName ? ` (${proposedName})` : ''}
          </label>
          <label>
            <input type="radio" name="choice" value="other" />
            {' '}Different existing design:{' '}
            <select name="other_design_id">
              {designs.map((d) => (
                <option key={d.design_id} value={d.design_id}>{d.name}</option>
              ))}
            </select>
          </label>
          <label>
            <input type="radio" name="choice" value="new" defaultChecked={proposal?.decision !== 'existing'} />
            {' '}New design
          </label>
          <input name="new_name" placeholder="New design name" />
          <input name="new_family" placeholder="New design family (e.g. figure, bowl)" />
          <hr />
          <input name="colorway" placeholder="Colorway" required />
          <input name="height_in" type="number" step="0.1" placeholder="Height (in)" required />
          <input name="width_in" type="number" step="0.1" placeholder="Width (in)" required />
          <input name="depth_in" type="number" step="0.1" placeholder="Depth (in)" required />
          <input name="weight_lb" type="number" step="0.1" placeholder="Weight (lb)" required />
          <input name="quantity" type="number" min="1" step="1" defaultValue={1} />
          <button type="submit">Confirm intake</button>
        </form>
      )}
    </main>
  )
}
