import type { query } from '@anthropic-ai/claude-agent-sdk'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createClaudeSdkArtDirector } from '@/lib/staging/direct-claude-sdk'
import { defaultArtDirector } from '@/lib/staging/direct-openai'
import type { ApiImageBlock } from '@/lib/writer/generate'

function image(data: string): ApiImageBlock {
  return { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } }
}

function resultQuery(outputs: unknown[]): typeof query {
  let call = 0
  return (() =>
    (async function* () {
      yield {
        type: 'result',
        subtype: 'success',
        structured_output: outputs[call++],
        usage: { input_tokens: 41, output_tokens: 17 },
      }
    })()) as unknown as typeof query
}

describe('createClaudeSdkArtDirector', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('returns validated single and varied directions with SDK usage', async () => {
    const single = {
      subject_and_count: 'Show exactly one figure, appearing exactly once.',
      composition: 'Centered at realistic 8-inch scale.',
      product_lock:
        'Use the exact physical product from Image 1. Preserve its silhouette. Do not restyle, redraw, smooth, or symmetrize.',
      extra_exclusions: [],
    }
    const varied = {
      subject_and_count: 'Show exactly one figure, appearing exactly once.',
      product_lock: single.product_lock,
      extra_exclusions: [],
      compositions: ['one', 'two', 'three', 'four'],
    }
    const director = createClaudeSdkArtDirector({
      model: 'claude-test',
      queryFn: resultQuery([single, varied]),
    })

    const one = await director.direct('single instructions', image('one'))
    const many = await director.directVaried('varied instructions', [image('one'), image('two')])

    expect(director.label).toBe('claude-sub:claude-test')
    expect(one).toEqual({ direction: single, input_tokens: 41, output_tokens: 17 })
    expect(many).toEqual({ direction: varied, input_tokens: 41, output_tokens: 17 })
  })

  it('rejects a varied direction without exactly four compositions', async () => {
    const director = createClaudeSdkArtDirector({
      queryFn: resultQuery([
        {
          subject_and_count: 'Show exactly one figure.',
          product_lock:
            'Use the exact physical product from Image 1. Do not restyle, redraw, smooth, or symmetrize.',
          extra_exclusions: [],
          compositions: ['one', 'two', 'three'],
        },
      ]),
    })

    await expect(director.directVaried('instructions', [image('one')])).rejects.toThrow()
  })

  it('is selected by the claude-sub provider prefix', () => {
    vi.stubEnv('ART_DIRECTOR_MODEL', 'claude-sub:claude-test')

    expect(defaultArtDirector().label).toBe('claude-sub:claude-test')
  })
})
