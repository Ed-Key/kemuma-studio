// USD per million tokens. Prices drift; update when providers change them.
// Unknown models get null cost, never a guess.
export const MODEL_PRICES: Record<string, { input: number; output: number }> = {
  'claude-opus-4-8': { input: 5, output: 25 },
  'claude-sonnet-5': { input: 3, output: 15 },
  'claude-haiku-4-5': { input: 1, output: 5 },
  'gemini-2.5-flash': { input: 0.3, output: 2.5 },
  'gemini-2.5-pro': { input: 1.25, output: 10 },
  'grok-4': { input: 3, output: 15 },
  // OpenAI, used for art direction (USD per million tokens).
  'gpt-5.1': { input: 1.25, output: 10 },
  'gpt-5.2': { input: 1.25, output: 10 },
  'gpt-5': { input: 1.25, output: 10 },
  'gpt-5-mini': { input: 0.25, output: 2 },
}

export function computeCostUsd(model: string, inputTokens: number, outputTokens: number): number | null {
  const bare = model.includes(':') ? model.slice(model.indexOf(':') + 1) : model
  const price = MODEL_PRICES[bare]
  if (!price) return null
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000
}
