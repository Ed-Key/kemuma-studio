import type { ClaudeSdkQueryFn } from '@/lib/claude-sdk'
import { queryClaudeStructured } from '@/lib/claude-sdk'
import { MatchProposalSchema } from './schema'
import { buildMatcherSystemPrompt, type DesignMatcher } from './match'

/**
 * The intake matcher on the Claude Agent SDK, billed through the owner's
 * Claude Code subscription. The shared SDK boundary strips API credentials
 * and excludes personal Claude settings before each call.
 */
export function createClaudeSdkMatcher(opts?: {
  model?: string
  queryFn?: ClaudeSdkQueryFn
}): DesignMatcher {
  const spec = process.env.MATCHER_MODEL ?? ''
  const model = opts?.model ?? (spec.startsWith('claude-sub:') ? spec.slice('claude-sub:'.length) : undefined)
  return {
    async match(candidateImages, newImages, userText) {
      const out = await queryClaudeStructured({
        queryFn: opts?.queryFn,
        model: model || undefined,
        systemPrompt: buildMatcherSystemPrompt(),
        userText,
        images: [...candidateImages, ...newImages],
        schema: MatchProposalSchema,
      })
      return out.parsed
    },
  }
}
