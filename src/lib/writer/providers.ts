import { createClaudeWriter, type ListingWriter } from './generate'
import { createOpenAICompatWriter } from './openai-compat'

const PROVIDERS: Record<string, { baseUrl: string; keyEnv: string }> = {
  gemini: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', keyEnv: 'GEMINI_API_KEY' },
  xai: { baseUrl: 'https://api.x.ai/v1', keyEnv: 'XAI_API_KEY' },
  openai: { baseUrl: 'https://api.openai.com/v1', keyEnv: 'OPENAI_API_KEY' },
}

export function parseModelSpec(spec: string): { provider: string; model: string } {
  const i = spec.indexOf(':')
  if (i < 1) throw new Error(`model spec "${spec}" must be provider:model`)
  return { provider: spec.slice(0, i), model: spec.slice(i + 1) }
}

export function bakeoffSpecs(env?: string): string[] {
  const raw = env ?? process.env.BAKEOFF_MODELS ?? 'anthropic:claude-opus-4-8'
  return raw.split(',').map((s) => s.trim()).filter(Boolean)
}

export function createWriterFor(spec: string): ListingWriter {
  const { provider, model } = parseModelSpec(spec)
  if (provider === 'anthropic') return createClaudeWriter(model)
  const entry = PROVIDERS[provider]
  if (!entry) throw new Error(`unknown provider "${provider}" (known: anthropic, ${Object.keys(PROVIDERS).join(', ')})`)
  const apiKey = process.env[entry.keyEnv]
  if (!apiKey) throw new Error(`${entry.keyEnv} is not set in .env.local`)
  return createOpenAICompatWriter({ label: spec, baseUrl: entry.baseUrl, apiKey, model })
}
