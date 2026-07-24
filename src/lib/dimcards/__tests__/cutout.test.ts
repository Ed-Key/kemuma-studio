import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { cutoutProduct, type CutoutRunner } from '@/lib/dimcards/cutout'

// A fake runner that writes a synthetic cutout: transparent canvas with an
// opaque block at the given position.
function fakeRunner(block: { left: number; top: number; width: number; height: number }): CutoutRunner {
  return async (_src, out) => {
    const rect = await sharp({
      create: { width: block.width, height: block.height, channels: 4, background: { r: 90, g: 60, b: 40, alpha: 1 } },
    }).png().toBuffer()
    await sharp({
      create: { width: 400, height: 600, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .composite([{ input: rect, left: block.left, top: block.top }])
      .png()
      .toFile(out)
  }
}

async function makeSrc(): Promise<string> {
  const dir = mkdtempSync(path.join(tmpdir(), 'kemuma-cut-'))
  const src = path.join(dir, 'src.jpg')
  await sharp({ create: { width: 400, height: 600, channels: 3, background: '#dddddd' } }).jpeg().toFile(src)
  return src
}

describe('cutoutProduct', () => {
  it('returns the cutout and its measured bbox', async () => {
    const src = await makeSrc()
    const out = src.replace('.jpg', '.png')
    const result = await cutoutProduct(fakeRunner({ left: 100, top: 150, width: 120, height: 300 }), src, out)
    expect(result.bbox).toEqual({ left: 100, top: 150, width: 120, height: 300 })
    expect(result.srcWidth).toBe(400)
    const meta = await sharp(result.png).metadata()
    expect(meta.hasAlpha).toBe(true)
  })

  it('rejects a product cut off at the photo edge', async () => {
    const src = await makeSrc()
    const out = src.replace('.jpg', '.png')
    await expect(
      cutoutProduct(fakeRunner({ left: 100, top: 300, width: 120, height: 300 }), src, out) // touches bottom
    ).rejects.toThrow(/cut off at the photo edge/)
  })

  it('rejects an empty cutout', async () => {
    const src = await makeSrc()
    const out = src.replace('.jpg', '.png')
    const empty: CutoutRunner = async (_s, o) => {
      await sharp({ create: { width: 400, height: 600, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
        .png()
        .toFile(o)
    }
    await expect(cutoutProduct(empty, src, out)).rejects.toThrow(/no product/)
  })
})
