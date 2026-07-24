import { describe, it, expect } from 'vitest'
import { MatchProposalSchema, enforceCaution } from '@/lib/matcher/schema'

describe('MatchProposalSchema', () => {
  it('accepts a valid proposal', () => {
    expect(
      MatchProposalSchema.parse({ decision: 'existing', design_id: 3, confidence: 'high', evidence: 'same knot form' })
    ).toBeTruthy()
  })
  it('rejects unknown decisions', () => {
    expect(() => MatchProposalSchema.parse({ decision: 'maybe', design_id: null, confidence: 'low', evidence: '' })).toThrow()
  })
})

describe('enforceCaution', () => {
  it('downgrades medium-confidence merges to abstain', () => {
    const out = enforceCaution({ decision: 'existing', design_id: 3, confidence: 'medium', evidence: 'similar' })
    expect(out.decision).toBe('abstain')
    expect(out.evidence).toMatch(/downgraded/i)
  })
  it('downgrades merges with no design id', () => {
    expect(enforceCaution({ decision: 'existing', design_id: null, confidence: 'high', evidence: 'x' }).decision).toBe('abstain')
  })
  it('leaves high-confidence merges and new/abstain untouched', () => {
    expect(enforceCaution({ decision: 'existing', design_id: 3, confidence: 'high', evidence: 'x' }).decision).toBe('existing')
    expect(enforceCaution({ decision: 'new', design_id: null, confidence: 'low', evidence: 'x' }).decision).toBe('new')
  })
})
