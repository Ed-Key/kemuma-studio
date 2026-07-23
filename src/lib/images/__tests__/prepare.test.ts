import { describe, it, expect } from 'vitest'
import { mkdtempSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { prepareImage, imageToApiBlock } from '@/lib/images/prepare'

async function makeFixture(dir: string, width: number, height: number): Promise<string> {
  const file = path.join(dir, 'fixture.jpg')
  await sharp({ create: { width, height, channels: 3, background: { r: 200, g: 120, b: 80 } } })
    .jpeg()
    .toFile(file)
  return file
}

describe('prepareImage', () => {
  it('resizes the long edge down to maxEdge and writes a jpeg', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'kemuma-img-'))
    const src = await makeFixture(dir, 4000, 3000)
    const dest = path.join(dir, 'out', 'prepared.jpg')
    const { width, height } = await prepareImage(src, dest, { maxEdge: 2000, quality: 90 })
    expect(existsSync(dest)).toBe(true)
    expect(Math.max(width, height)).toBe(2000)
    const meta = await sharp(dest).metadata()
    expect(meta.format).toBe('jpeg')
  })

  it('never enlarges small images', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'kemuma-img-'))
    const src = await makeFixture(dir, 800, 600)
    const dest = path.join(dir, 'small.jpg')
    const { width } = await prepareImage(src, dest, { maxEdge: 2000, quality: 90 })
    expect(width).toBe(800)
  })
})

describe('imageToApiBlock', () => {
  it('returns a base64 jpeg block capped at 1100px', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'kemuma-img-'))
    const src = await makeFixture(dir, 3000, 2000)
    const block = await imageToApiBlock(src)
    expect(block.type).toBe('image')
    expect(block.source.media_type).toBe('image/jpeg')
    const buf = Buffer.from(block.source.data, 'base64')
    const meta = await sharp(buf).metadata()
    expect(Math.max(meta.width!, meta.height!)).toBeLessThanOrEqual(1100)
  })
})
