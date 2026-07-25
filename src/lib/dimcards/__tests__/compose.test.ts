import { describe, it, expect } from 'vitest'
import sharp from 'sharp'
import { composeDimensionCard, productLayout, PX_PER_IN } from '@/lib/dimcards/compose'

async function syntheticCutout(w: number, h: number): Promise<Buffer> {
  return sharp({
    create: { width: w, height: h, channels: 4, background: { r: 90, g: 60, b: 40, alpha: 1 } },
  }).png().toBuffer()
}

describe('composeDimensionCard', () => {
  it('produces a 2000x2000 jpeg', async () => {
    const card = await composeDimensionCard({
      cutout: await syntheticCutout(250, 600),
      title: 'Lovers Loop Figure',
      heightIn: 6,
      widthIn: 2.5,
    })
    const meta = await sharp(card).metadata()
    expect(meta.width).toBe(2000)
    expect(meta.height).toBe(2000)
    expect(meta.format).toBe('jpeg')
  })

  it('scales the product to the fixed pixels-per-inch', async () => {
    expect(PX_PER_IN).toBe(146)
    // An 8-inch product must render taller than a 4-inch one on the shared scale.
    const tall = await composeDimensionCard({
      cutout: await syntheticCutout(200, 800), title: 'Tall', heightIn: 8, widthIn: 2,
    })
    const short = await composeDimensionCard({
      cutout: await syntheticCutout(200, 800), title: 'Short', heightIn: 4, widthIn: 2,
    })
    // Compare dark-pixel counts as a scale proxy: the 8-inch render covers
    // roughly four times the area of the 4-inch render.
    async function darkPixels(buf: Buffer): Promise<number> {
      const { data } = await sharp(buf).resize(200, 200).greyscale().raw().toBuffer({ resolveWithObject: true })
      return Array.from(data).filter((v) => v < 100).length
    }
    expect(await darkPixels(tall)).toBeGreaterThan((await darkPixels(short)) * 2.5)
  })

  it('rejects non-positive dimensions', async () => {
    await expect(
      composeDimensionCard({ cutout: await syntheticCutout(10, 10), title: 'x', heightIn: 0, widthIn: 2 })
    ).rejects.toThrow(/positive/)
  })
})

describe('productLayout', () => {
  // The 8 inch Lovers Embrace printed straight through the subtitle at the old
  // 160 px/in, because nothing checked that the carving cleared the header.
  it('keeps every catalog height clear of the subtitle', () => {
    for (const heightIn of [1, 3, 4, 6, 7, 8]) {
      expect(productLayout(heightIn).topY, `${heightIn}in`).toBeGreaterThan(300)
    }
  })

  it('holds one shared scale across the catalog so two cards stay comparable', () => {
    expect(productLayout(3).scalePerIn).toBe(PX_PER_IN)
    expect(productLayout(8).scalePerIn).toBe(PX_PER_IN)
  })

  it('shrinks a piece taller than the card rather than overprinting the header', () => {
    expect(productLayout(12).scalePerIn).toBeLessThan(PX_PER_IN)
    expect(productLayout(12).topY).toBeGreaterThan(300)
  })
})
