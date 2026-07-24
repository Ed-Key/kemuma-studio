import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import {
  GPT_IMAGE_MODEL, computeImageCostUsd, prepareReference, generateStagedImages,
} from '@/lib/staging/images-api'

describe('computeImageCostUsd', () => {
  it('prices the observed poc usage correctly', () => {
    // Real usage from the 2026-07-24 figure test: $0.1782
    const cost = computeImageCostUsd({
      input_tokens: 1791,
      output_tokens: 5488,
      input_tokens_details: { image_tokens: 1536, text_tokens: 255 },
      output_tokens_details: { image_tokens: 5488, text_tokens: 0 },
    })
    expect(cost).toBeCloseTo(0.178203, 5)
  })

  it('treats all output as image tokens when details are missing', () => {
    const cost = computeImageCostUsd({ input_tokens: 1000, output_tokens: 1000 })
    // 1000 image-input tokens at $8/M + 1000 image-output tokens at $30/M
    expect(cost).toBeCloseTo(0.038, 5)
  })
})

describe('prepareReference', () => {
  it('letterboxes the photo onto the target canvas', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'kemuma-img-'))
    const src = path.join(dir, 'src.jpg')
    await sharp({ create: { width: 400, height: 300, channels: 3, background: { r: 120, g: 90, b: 60 } } })
      .jpeg()
      .toFile(src)
    const buf = await prepareReference(src, '1536x1024')
    const meta = await sharp(buf).metadata()
    expect(meta.width).toBe(1536)
    expect(meta.height).toBe(1024)
    expect(meta.format).toBe('jpeg')
  })
})

describe('generateStagedImages', () => {
  const usage = {
    input_tokens: 100, output_tokens: 200,
    input_tokens_details: { image_tokens: 80, text_tokens: 20 },
    output_tokens_details: { image_tokens: 200, text_tokens: 0 },
  }

  function fakeFetch(capture: { url?: string; auth?: string; form?: FormData }, images = 2) {
    const png = Buffer.from('fakepng')
    return (async (url: RequestInfo | URL, init?: RequestInit) => {
      capture.url = String(url)
      capture.auth = String((init?.headers as Record<string, string>).Authorization)
      capture.form = init?.body as FormData
      return new Response(
        JSON.stringify({
          data: Array.from({ length: images }, () => ({ b64_json: png.toString('base64') })),
          usage,
        }),
        { status: 200 }
      )
    }) as typeof fetch
  }

  it('posts every reference as an image[] entry and decodes the batch', async () => {
    const capture: { url?: string; auth?: string; form?: FormData } = {}
    const batch = await generateStagedImages(fakeFetch(capture), 'sk-test', {
      references: [Buffer.from('ref-a'), Buffer.from('ref-b'), Buffer.from('ref-c')],
      prompt: 'SCENE - test',
      size: '1536x1024',
      n: 2,
    })
    expect(capture.url).toBe('https://api.openai.com/v1/images/edits')
    expect(capture.auth).toBe('Bearer sk-test')
    expect(capture.form!.get('model')).toBe(GPT_IMAGE_MODEL)
    expect(capture.form!.get('quality')).toBe('high')
    expect(capture.form!.get('n')).toBe('2')
    expect(capture.form!.get('input_fidelity')).toBeNull() // gpt-image-2 rejects this param
    const refs = capture.form!.getAll('image[]')
    expect(refs).toHaveLength(3)
    expect(refs.every((r) => r instanceof Blob)).toBe(true)
    expect(capture.form!.get('image')).toBeNull() // legacy single field must be gone
    expect(batch.images).toHaveLength(2)
    expect(batch.cost_usd).toBeGreaterThan(0)
  })

  it('rejects an empty reference list', async () => {
    const capture: { url?: string; auth?: string; form?: FormData } = {}
    await expect(
      generateStagedImages(fakeFetch(capture), 'sk-test', {
        references: [], prompt: 'p', size: '1024x1536', n: 1,
      })
    ).rejects.toThrow(/at least one reference/)
  })

  it('throws with the API error body on non-200', async () => {
    const fetchFn = (async () =>
      new Response(JSON.stringify({ error: { message: 'bad prompt' } }), { status: 400 })) as typeof fetch
    await expect(
      generateStagedImages(fetchFn, 'sk-test', {
        references: [Buffer.from('x')], prompt: 'p', size: '1024x1536', n: 4,
      })
    ).rejects.toThrow(/images API 400.*bad prompt/s)
  })
})
