import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import sharp from 'sharp'

const execFileAsync = promisify(execFile)

export type CutoutRunner = (srcPath: string, outPath: string) => Promise<void>

// isnet-general-use is deliberate: the default u2net model failed to cut the
// hollow center out of looped carvings (2026-07-24). Model weights cache
// under ~/.u2net after the first run.
export const rembgRunner: CutoutRunner = async (srcPath, outPath) => {
  await execFileAsync(
    'uvx',
    ['--from', 'rembg[cpu,cli]', 'rembg', 'i', '-m', 'isnet-general-use', srcPath, outPath],
    { timeout: 180_000 }
  )
}

export interface CutoutResult {
  png: Buffer
  bbox: { left: number; top: number; width: number; height: number }
  srcWidth: number
  srcHeight: number
}

export async function cutoutProduct(runner: CutoutRunner, srcPath: string, outPath: string): Promise<CutoutResult> {
  await runner(srcPath, outPath)
  const full = await sharp(outPath).ensureAlpha().png().toBuffer()
  const meta = await sharp(full).metadata()
  const srcWidth = meta.width!
  const srcHeight = meta.height!
  const alpha = (await sharp(full).stats()).channels[3]
  if (!alpha || alpha.max === 0) throw new Error('cutout found no product in the photo')

  let trimmed: { data: Buffer; info: sharp.OutputInfo }
  try {
    trimmed = await sharp(full).trim().toBuffer({ resolveWithObject: true })
  } catch {
    throw new Error('cutout found no product in the photo')
  }
  if (trimmed.info.width === srcWidth && trimmed.info.height === srcHeight) {
    // trim removed nothing: either the whole frame is product (edge-cropped)
    // or the alpha is solid; both are unusable.
    throw new Error('the product is cut off at the photo edge; pick a photo showing the whole piece')
  }
  const left = -(trimmed.info.trimOffsetLeft ?? 0)
  const top = -(trimmed.info.trimOffsetTop ?? 0)
  const { width, height } = trimmed.info
  if (width < 4 || height < 4) throw new Error('cutout found no product in the photo')
  if (left <= 0 || top <= 0 || left + width >= srcWidth || top + height >= srcHeight) {
    throw new Error('the product is cut off at the photo edge; pick a photo showing the whole piece')
  }
  return { png: trimmed.data, bbox: { left, top, width, height }, srcWidth, srcHeight }
}
