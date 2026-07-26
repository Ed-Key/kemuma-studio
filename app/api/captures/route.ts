import { getCatalogDb } from '@/lib/catalog/instance'
import { listDesigns } from '@/lib/catalog/catalog'
import { listPendingIntakes, type CapturedFacts } from '@/lib/catalog/intakes'
import type { MatchProposal } from '@/lib/matcher/schema'

export const dynamic = 'force-dynamic'

export function GET() {
  const db = getCatalogDb()
  const designs = listDesigns(db)
  const byId = new Map(designs.map((d) => [d.design_id, d]))

  const pending = listPendingIntakes(db).map((intake) => {
    const proposal = JSON.parse(intake.proposal_json ?? 'null') as MatchProposal | null
    const facts = JSON.parse(intake.facts_json ?? '{}') as CapturedFacts
    const match = proposal?.design_id != null ? byId.get(proposal.design_id) : undefined
    return {
      intake_id: intake.intake_id,
      created_at: intake.created_at,
      photos: (JSON.parse(intake.photos_json) as string[]).length,
      colorway: facts.colorway ?? null,
      measured: Boolean(facts.height_in && facts.width_in && facts.depth_in && facts.weight_lb),
      // Null while the matcher is still running behind the response.
      decision: proposal?.decision ?? null,
      design_id: match?.design_id ?? null,
      design_name: match?.name ?? null,
    }
  })

  return Response.json(
    { pending, designs: designs.map((d) => ({ design_id: d.design_id, name: d.name, family: d.family })) },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}
