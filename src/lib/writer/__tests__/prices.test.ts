import { describe, it, expect } from 'vitest'
import { computeCostUsd } from '@/lib/writer/prices'

describe('computeCostUsd', () => {
  it('prices a known model per million tokens', () => {
    // claude-opus-4-8: $5 in / $25 out per MTok
    expect(computeCostUsd('claude-opus-4-8', 1_000_000, 1_000_000)).toBeCloseTo(30)
    expect(computeCostUsd('claude-opus-4-8', 10_000, 2_000)).toBeCloseTo(0.1)
  })
  it('strips provider prefixes', () => {
    expect(computeCostUsd('gemini:gemini-2.5-flash', 1_000_000, 0)).not.toBeNull()
  })
  it('returns null for unknown models', () => {
    expect(computeCostUsd('mystery-model-9000', 1000, 1000)).toBeNull()
  })
})
