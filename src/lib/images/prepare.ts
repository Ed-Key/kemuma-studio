import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

export const PREPARED_MAX_EDGE = 2000
export const PREPARED_QUALITY = 90
const API_MAX_EDGE = 1100
const API_QUALITY = 80

export async function prepareImage(
  srcPath: string,
  destPath: string,
  opts: { maxEdge: number; quality: number }
): Promise<{ width: number; height: number }> {
  await mkdir(path.dirname(destPath), { recursive: true })
  const info = await sharp(srcPath, { failOn: 'none' })
    .rotate() // honor EXIF orientation
    .resize({ width: opts.maxEdge, height: opts.maxEdge, fit: 'inside', withoutEnlargement: true })
    .toColorspace('srgb')
    .jpeg({ quality: opts.quality })
    .toFile(destPath)
  return { width: info.width, height: info.height }
}

export async function imageToApiBlock(srcPath: string): Promise<{
  type: 'image'
  source: { type: 'base64'; media_type: 'image/jpeg'; data: string }
}> {
  const buf = await sharp(srcPath, { failOn: 'none' })
    .rotate()
    .resize({ width: API_MAX_EDGE, height: API_MAX_EDGE, fit: 'inside', withoutEnlargement: true })
    .toColorspace('srgb')
    .jpeg({ quality: API_QUALITY })
    .toBuffer()
  return { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: buf.toString('base64') } }
}
