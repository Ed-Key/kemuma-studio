import { describe, it, expect } from 'vitest'
import { listingEditorUrl, listingPublicUrl, SHOP_DRAFTS_URL } from '@/lib/etsy/urls'

describe('etsy urls', () => {
  it('builds the editor url for a listing', () => {
    expect(listingEditorUrl(4543559779)).toBe(
      'https://www.etsy.com/your/shops/me/listing-editor/edit/4543559779'
    )
  })

  it('builds the public url for a published listing', () => {
    expect(listingPublicUrl(4543559779)).toBe('https://www.etsy.com/listing/4543559779')
  })

  it('exposes the shop drafts url', () => {
    expect(SHOP_DRAFTS_URL).toMatch(/^https:\/\/www\.etsy\.com\/your\/shops\/me\/tools\/listings/)
  })
})
