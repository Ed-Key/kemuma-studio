import { z } from 'zod'

export const MatchProposalSchema = z.object({
  decision: z.enum(['existing', 'new', 'abstain']),
  design_id: z.number().nullable(),
  confidence: z.enum(['high', 'medium', 'low']),
  evidence: z.string(),
  // Only meaningful when this is not an existing design. Naming a piece is the
  // hardest field to fill standing in a garage, and the matcher is already
  // looking at the photographs with every existing name in front of it.
  suggested_name: z.string().nullable().default(null),
  suggested_family: z.string().nullable().default(null),
})

export type MatchProposal = z.infer<typeof MatchProposalSchema>

// A false merge (buyer receives the wrong sculpture) costs more than a false
// split (a duplicate listing). Uncertain merges never reach Ed as merges.
export function enforceCaution(p: MatchProposal): MatchProposal {
  if (p.decision === 'existing' && (p.confidence !== 'high' || p.design_id == null)) {
    return { ...p, decision: 'abstain', evidence: `downgraded to abstain (was existing/${p.confidence}): ${p.evidence}` }
  }
  return p
}
