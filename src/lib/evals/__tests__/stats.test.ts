import { describe, it, expect } from 'vitest'
import { computeModelStats, renderMarkdown } from '@/lib/evals/stats'

const gen = (price: number) =>
  JSON.stringify({ title: 't', description: 'd', tags: ['a'], price_usd: price, materials: ['m'], colorway_notes: 'c' })

describe('computeModelStats', () => {
  it('computes per-model acceptance, edits, cost, and price calibration', () => {
    const drafts = [
      { model: 'opus', status: 'approved' as const, generated_json: gen(50), final_json: gen(50), cost_usd: 0.1 },
      {
        model: 'opus', status: 'approved' as const, generated_json: gen(100),
        final_json: JSON.stringify({ ...JSON.parse(gen(100)), price_usd: 110, title: 'edited' }), cost_usd: 0.2,
      },
      { model: 'gem', status: 'generated' as const, generated_json: gen(40), final_json: null, cost_usd: 0.01 },
    ]
    const stats = computeModelStats(drafts, [])
    const opus = stats.find((s) => s.model === 'opus')!
    expect(opus.drafts).toBe(2)
    expect(opus.approved).toBe(2)
    expect(opus.acceptedUntouched).toBe(1)
    expect(opus.fieldEdits.title).toBe(1)
    expect(opus.fieldEdits.price_usd).toBe(1)
    expect(opus.avgCostUsd).toBeCloseTo(0.15)
    expect(opus.priceCalibration).toBeCloseTo(0.05) // (0 + 0.1) / 2
    const gem = stats.find((s) => s.model === 'gem')!
    expect(gem.approved).toBe(0)
    expect(gem.priceCalibration).toBeNull()
  })
})

describe('renderMarkdown', () => {
  it('renders a table with one row per model', () => {
    const md = renderMarkdown(
      computeModelStats(
        [{ model: 'opus', status: 'approved', generated_json: gen(50), final_json: gen(50), cost_usd: 0.1 }],
        []
      )
    )
    expect(md).toMatch(/\| model \|/)
    expect(md).toMatch(/\| opus \|/)
  })
})
