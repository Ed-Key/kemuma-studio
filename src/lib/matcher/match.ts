import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import type { Db } from '@/lib/catalog/db'
import { logEvent } from '@/lib/catalog/catalog'
import { imageToApiBlock } from '@/lib/images/prepare'
import type { ApiImageBlock } from '@/lib/writer/generate'
import { MatchProposalSchema, enforceCaution, type MatchProposal } from './schema'

export interface MatchCandidate {
  design_id: number
  name: string
  family: string
  exemplarPath: string
}

export function loadCandidates(db: Db): MatchCandidate[] {
  return db
    .prepare(`
      SELECT d.design_id, d.name, d.family, MIN(ph.photo_id) AS photo_id, ph2.file_path AS exemplarPath
      FROM designs d
      JOIN pieces p ON p.design_id = d.design_id
      JOIN photos ph ON ph.piece_id = p.piece_id
      JOIN photos ph2 ON ph2.photo_id = (
        SELECT MIN(ph3.photo_id) FROM photos ph3
        JOIN pieces p3 ON p3.piece_id = ph3.piece_id
        WHERE p3.design_id = d.design_id
      )
      GROUP BY d.design_id
      ORDER BY d.design_id
    `)
    .all() as MatchCandidate[]
}

export function buildMatcherSystemPrompt(): string {
  return [
    'You match a newly photographed soapstone piece against a catalog of known designs.',
    'The catalog is a finite family collection; designs repeat in different colorways and finishes.',
    'Rules:',
    '- decision "existing": the new piece is the SAME carved design as a candidate. Color, finish,',
    '  and surface pattern may differ (those are legitimate variations); the carved form, shape,',
    '  and proportions must match.',
    '- decision "new": clearly none of the candidates share the carved form.',
    '- decision "abstain": anything in between. A wrong merge is far worse than a wrong split:',
    '  when not certain at high confidence, abstain.',
    '- design_id must be one of the candidate ids, or null.',
    '- evidence: one or two sentences naming the visual features that decided it.',
    '- suggested_name and suggested_family: fill these whenever the decision is NOT "existing",',
    '  and leave them null when it is. Name the piece the way the candidate lineup is named:',
    '  the carved subject plus the object type ("Canoe Trinket Dish", "Lovers Embrace Figure",',
    '  "Painted Safari Heart Dish"). No colorway in the name; colorway is a variation of a design,',
    '  not a design. Reuse an existing family verbatim when one fits, and only invent a family when',
    '  the object is genuinely a kind the catalog does not have yet.',
  ].join('\n')
}

export function buildMatcherUserText(candidates: Array<{ design_id: number; name: string; family: string }>): string {
  const lineup = candidates
    .map((c, i) => `Candidate ${i + 1}: design_id ${c.design_id}, "${c.name}" (${c.family})`)
    .join('\n')
  return [
    'The candidate lineup follows, one exemplar photo each, in this order:',
    lineup,
    'After the lineup come the photos of the NEW piece. Decide: existing, new, or abstain,',
    'and if it is not existing, propose a name and family in the lineup\'s style.',
  ].join('\n')
}

export interface DesignMatcher {
  match(candidateImages: ApiImageBlock[], newImages: ApiImageBlock[], userText: string): Promise<MatchProposal>
}

export function matcherModel(): string {
  const spec = process.env.MATCHER_MODEL ?? ''
  if (spec.startsWith('anthropic:')) return spec.slice('anthropic:'.length)
  if (spec.startsWith('openai:')) return spec.slice('openai:'.length)
  return spec || 'gpt-5.1'
}

export function createClaudeMatcher(): DesignMatcher {
  const client = new Anthropic()
  return {
    async match(candidateImages, newImages, userText) {
      const response = await client.messages.parse({
        model: matcherModel(),
        max_tokens: 4000,
        thinking: { type: 'adaptive' },
        system: buildMatcherSystemPrompt(),
        messages: [
          {
            role: 'user',
            content: [...candidateImages, ...newImages, { type: 'text', text: userText }],
          },
        ],
        output_config: { format: zodOutputFormat(MatchProposalSchema) },
      })
      if (!response.parsed_output) {
        throw new Error(`matcher returned no parsed output (stop_reason: ${response.stop_reason})`)
      }
      return response.parsed_output
    },
  }
}

export async function proposeMatch(db: Db, matcher: DesignMatcher, newImagePaths: string[]): Promise<MatchProposal> {
  const candidates = loadCandidates(db)
  if (candidates.length === 0) {
    // No candidates means no model call, so there is nothing to suggest a name
    // from. Only ever the very first piece.
    const proposal: MatchProposal = {
      decision: 'new',
      design_id: null,
      confidence: 'high',
      evidence: 'catalog is empty',
      suggested_name: null,
      suggested_family: null,
    }
    logEvent(db, 'match.proposed', { proposal, candidates: 0 })
    return proposal
  }

  const candidateImages: ApiImageBlock[] = []
  for (const c of candidates) candidateImages.push(await imageToApiBlock(c.exemplarPath))
  const newImages: ApiImageBlock[] = []
  for (const p of newImagePaths) newImages.push(await imageToApiBlock(p))

  let proposal = await matcher.match(candidateImages, newImages, buildMatcherUserText(candidates))
  if (proposal.decision === 'existing' && !candidates.some((c) => c.design_id === proposal.design_id)) {
    proposal = { ...proposal, decision: 'abstain', evidence: `downgraded: proposed design_id ${proposal.design_id} is not a candidate` }
  }
  proposal = enforceCaution(proposal)
  logEvent(db, 'match.proposed', { proposal, candidates: candidates.length })
  return proposal
}
