import { describe, it, expect } from 'vitest'
import { parseModelSpec, bakeoffSpecs, createWriterFor } from '@/lib/writer/providers'

describe('parseModelSpec', () => {
  it('splits provider and model', () => {
    expect(parseModelSpec('gemini:gemini-2.5-flash')).toEqual({ provider: 'gemini', model: 'gemini-2.5-flash' })
  })
  it('throws without a colon', () => {
    expect(() => parseModelSpec('claude-opus-4-8')).toThrow(/provider:model/)
  })
})

describe('bakeoffSpecs', () => {
  it('parses a comma list with whitespace', () => {
    expect(bakeoffSpecs(' anthropic:claude-opus-4-8 , gemini:gemini-2.5-flash ')).toEqual([
      'anthropic:claude-opus-4-8',
      'gemini:gemini-2.5-flash',
    ])
  })
  it('defaults to claude when unset', () => {
    expect(bakeoffSpecs(undefined)).toEqual(['anthropic:claude-opus-4-8'])
  })
})

describe('createWriterFor', () => {
  it('builds an openai-compat writer when the key is present', () => {
    process.env.GEMINI_API_KEY = 'test-key'
    const writer = createWriterFor('gemini:gemini-2.5-flash')
    expect(writer.label).toBe('gemini:gemini-2.5-flash')
  })
  it('throws for a provider with no key set', () => {
    delete process.env.XAI_API_KEY
    expect(() => createWriterFor('xai:grok-4')).toThrow(/XAI_API_KEY/)
  })
  it('throws for unknown providers', () => {
    expect(() => createWriterFor('llamacorp:llama-99')).toThrow(/unknown provider/i)
  })
})
