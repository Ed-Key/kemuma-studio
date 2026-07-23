import Link from 'next/link'
import { getCatalogDb } from '@/lib/catalog/instance'
import { getDesignDetail } from '@/lib/catalog/catalog'
import { addPieceAction, uploadPhotosAction } from '../actions'

export const dynamic = 'force-dynamic'

export default async function DesignDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const detail = getDesignDetail(getCatalogDb(), Number(id))
  if (!detail) return <main style={{ padding: 40 }}>Design not found. <Link href="/designs">Back</Link></main>
  return (
    <main style={{ fontFamily: 'system-ui', padding: 40, maxWidth: 720 }}>
      <p><Link href="/designs">← All designs</Link></p>
      <h1>{detail.name}</h1>
      <p>Family: {detail.family}{detail.etsy_listing_id ? ` · Etsy listing ${detail.etsy_listing_id}` : ''}</p>
      <p><Link href={`/designs/${detail.design_id}/draft`}>Listing draft →</Link></p>

      <h2>Pieces</h2>
      {detail.pieces.map((p) => (
        <div key={p.piece_id} style={{ border: '1px solid #ccc', padding: 12, marginBottom: 12 }}>
          <strong>#{p.piece_id}</strong> {p.colorway} · {p.height_in}"H × {p.width_in}"W × {p.depth_in}"D ·{' '}
          {p.weight_lb} lb · qty {p.quantity} · {p.status}
          <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            {p.photos.map((ph) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={ph.photo_id} src={`/api/photos/${ph.photo_id}`} alt="" style={{ height: 96 }} />
            ))}
          </div>
          <form action={uploadPhotosAction} style={{ marginTop: 8 }}>
            <input type="hidden" name="piece_id" value={p.piece_id} />
            <input type="hidden" name="design_id" value={detail.design_id} />
            <input type="file" name="photos" accept=".jpg,.jpeg,.png,.webp,.heic" multiple required />
            <button type="submit">Add photos</button>
          </form>
        </div>
      ))}

      <h2>Add piece</h2>
      <form action={addPieceAction} style={{ display: 'grid', gap: 8, maxWidth: 360 }}>
        <input type="hidden" name="design_id" value={detail.design_id} />
        <input name="colorway" placeholder="Colorway (e.g. gray, rose)" required />
        <input name="height_in" type="number" step="0.1" placeholder="Height (in)" required />
        <input name="width_in" type="number" step="0.1" placeholder="Width (in)" required />
        <input name="depth_in" type="number" step="0.1" placeholder="Depth (in)" required />
        <input name="weight_lb" type="number" step="0.1" placeholder="Weight (lb)" required />
        <input name="quantity" type="number" min="1" step="1" defaultValue={1} />
        <button type="submit">Add piece</button>
      </form>
    </main>
  )
}
