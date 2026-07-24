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
  ].join('\n')
}

export function buildMatcherUserText(candidates: Array<{ design_id: number; name: string; family: string }>): string {
  const lineup = candidates
    .map((c, i) => `Candidate ${i + 1}: design_id ${c.design_id}, "${c.name}" (${c.family})`)
    .join('\n')
  return [
    'The candidate lineup follows, one exemplar photo each, in this order:',
    lineup,
    'After the lineup come the photos of the NEW piece. Decide: existing, new, or abstain.',
  ].join('\n')
}

export interface DesignMatcher {
  match(candidateImages: ApiImageBlock[], newImages: ApiImageBlock[], userText: string): Promise<MatchProposal>
}

export function matcherModel(): string {
  return process.env.ANTHROPIC_MODEL ?? 'claude-opus-4-8'
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
    const proposal: MatchProposal = { decision: 'new', design_id: null, confidence: 'high', evidence: 'catalog is empty' }
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
