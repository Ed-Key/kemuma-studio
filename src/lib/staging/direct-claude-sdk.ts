import type { ClaudeSdkQueryFn } from '@/lib/claude-sdk'
import { queryClaudeStructured } from '@/lib/claude-sdk'
import {
  ArtDirectionSchema,
  VariedArtDirectionSchema,
  buildDirectorSystemPrompt,
  type ArtDirector,
} from './direct'

/**
 * The art director on the Claude Agent SDK, billed through the owner's Claude
 * Code subscription. Vision and structured output stay inside the isolated
 * shared boundary so API credentials cannot override the subscription.
 */
export function createClaudeSdkArtDirector(opts?: {
  model?: string
  queryFn?: ClaudeSdkQueryFn
}): ArtDirector {
  const spec = process.env.ART_DIRECTOR_MODEL ?? ''
  const model =
    opts?.model ?? (spec.startsWith('claude-sub:') ? spec.slice('claude-sub:'.length) : undefined)

  return {
    label: `claude-sub:${model || 'default'}`,
    async direct(userText, image) {
      const out = await queryClaudeStructured({
        queryFn: opts?.queryFn,
        model: model || undefined,
        systemPrompt: buildDirectorSystemPrompt(),
        userText,
        images: [image],
        schema: ArtDirectionSchema,
      })
      return {
        direction: out.parsed,
        input_tokens: out.input_tokens,
        output_tokens: out.output_tokens,
      }
    },
    async directVaried(userText, images) {
      const out = await queryClaudeStructured({
        queryFn: opts?.queryFn,
        model: model || undefined,
        systemPrompt: buildDirectorSystemPrompt(),
        userText,
        images,
        schema: VariedArtDirectionSchema,
      })
      return {
        direction: out.parsed,
        input_tokens: out.input_tokens,
        output_tokens: out.output_tokens,
      }
    },
  }
}
