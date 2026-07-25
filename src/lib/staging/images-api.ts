import sharp from 'sharp'
import type { StagingSize } from './scenes'

// Pinned snapshot for reproducible output; the moving alias shifts under us.
export const GPT_IMAGE_MODEL = 'gpt-image-2-2026-04-21'

// USD per million tokens (OpenAI images pricing, verified 2026-07-24).
export const GPT_IMAGE_PRICES = { textInput: 5, imageInput: 8, textOutput: 10, imageOutput: 30 }

export interface ImagesUsage {
  input_tokens: number
  output_tokens: number
  input_tokens_details?: { image_tokens: number; text_tokens: number }
  output_tokens_details?: { image_tokens: number; text_tokens: number }
}

export function computeImageCostUsd(usage: ImagesUsage): number {
  // Without detail splits, price conservatively: inputs as image tokens
  // (reference photo dominates) and outputs as image tokens.
  const inImg = usage.input_tokens_details?.image_tokens ?? usage.input_tokens
  const inText = usage.input_tokens_details?.text_tokens ?? 0
  const outImg = usage.output_tokens_details?.image_tokens ?? usage.output_tokens
  const outText = usage.output_tokens_details?.text_tokens ?? 0
  const p = GPT_IMAGE_PRICES
  return (inText * p.textInput + inImg * p.imageInput + outText * p.textOutput + outImg * p.imageOutput) / 1_000_000
}

// Letterbox the product photo onto the exact output canvas so the model sees
// the product at final aspect ratio (the shape the validated batches used).
export async function prepareReference(photoPath: string, size: StagingSize): Promise<Buffer> {
  const [w, h] = size.split('x').map(Number)
  return sharp(photoPath, { failOn: 'none' })
    .rotate()
    .resize(w, h, { fit: 'contain', background: { r: 245, g: 246, b: 248 } })
    .toColorspace('srgb')
    .jpeg({ quality: 95 })
    .toBuffer()
}

export interface StagedBatch {
  images: Buffer[]
  usage: ImagesUsage
  cost_usd: number
}

export interface StagedImageInput {
  references: Buffer[]
  prompt: string
  size: StagingSize
  n: number
}

export interface ImageGenerator {
  label: string
  generate(input: StagedImageInput): Promise<StagedBatch>
}

// NOTE: never send input_fidelity; gpt-image-2 rejects the parameter and
// already processes references at high fidelity automatically. Multiple
// references are different views of the SAME product; the prompt's
// SUBJECT AND COUNT section must say so or the model may render one
// product per image.
export async function generateStagedImages(
  fetchFn: typeof fetch,
  apiKey: string,
  input: StagedImageInput
): Promise<StagedBatch> {
  if (input.references.length === 0) throw new Error('staging needs at least one reference image')
  const form = new FormData()
  form.set('model', GPT_IMAGE_MODEL)
  form.set('prompt', input.prompt)
  form.set('size', input.size)
  form.set('quality', 'high')
  form.set('n', String(input.n))
  for (const [i, ref] of input.references.entries()) {
    form.append('image[]', new Blob([new Uint8Array(ref)], { type: 'image/jpeg' }), `reference-${i + 1}.jpg`)
  }

  const res = await fetchFn('https://api.openai.com/v1/images/edits', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`images API ${res.status}: ${text.slice(0, 400)}`)
  const body = JSON.parse(text) as { data: Array<{ b64_json: string }>; usage: ImagesUsage }
  return {
    images: body.data.map((d) => Buffer.from(d.b64_json, 'base64')),
    usage: body.usage,
    cost_usd: computeImageCostUsd(body.usage),
  }
}

/**
 * The image generator on the OpenAI API. This keeps the original gpt-image-2
 * request available when IMAGE_PROVIDER does not select a subscription path.
 */
export function createOpenAIImageGenerator(opts?: {
  apiKey?: string
  fetchFn?: typeof fetch
}): ImageGenerator {
  const fetchFn = opts?.fetchFn ?? fetch
  return {
    label: GPT_IMAGE_MODEL,
    async generate(input) {
      const apiKey = opts?.apiKey ?? process.env.OPENAI_API_KEY
      if (!apiKey) throw new Error('OPENAI_API_KEY is not set')
      return generateStagedImages(fetchFn, apiKey, input)
    },
  }
}
