import Link from 'next/link'
import { getCatalogDb } from '@/lib/catalog/instance'
import { listDesigns } from '@/lib/catalog/catalog'
import { createDesignAction } from './actions'

export const dynamic = 'force-dynamic'

export default function DesignsPage() {
  const designs = listDesigns(getCatalogDb())
  return (
    <main style={{ fontFamily: 'system-ui', padding: 40, maxWidth: 720 }}>
      <h1>Designs</h1>
      <ul>
        {designs.map((d) => (
          <li key={d.design_id}>
            <Link href={`/designs/${d.design_id}`}>{d.name}</Link>{' '}
            ({d.family}) — {d.piece_count} pieces, qty {d.total_quantity}
          </li>
        ))}
      </ul>
      <h2>New design</h2>
      <form action={createDesignAction} style={{ display: 'grid', gap: 8, maxWidth: 360 }}>
        <input name="name" placeholder="Name (e.g. Eternity Love Knot)" required />
        <input name="family" placeholder="Family (e.g. love knot, bowl, elephant)" required />
        <button type="submit">Create</button>
      </form>
    </main>
  )
}
