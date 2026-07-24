import Link from 'next/link'
import { getCatalogDb } from '@/lib/catalog/instance'
import { listPendingIntakes } from '@/lib/catalog/intakes'
import { createIntakeAction } from './actions'

export const dynamic = 'force-dynamic'

export default function IntakePage() {
  const pending = listPendingIntakes(getCatalogDb())
  return (
    <main style={{ fontFamily: 'system-ui', padding: 40, maxWidth: 720 }}>
      <p><Link href="/designs">← Designs</Link></p>
      <h1>Intake</h1>
      <p>Photograph a piece, drop the photos here, and the matcher proposes where it belongs.</p>
      <form action={createIntakeAction}>
        <input type="file" name="photos" accept=".jpg,.jpeg,.png,.webp,.heic" multiple required />
        <button type="submit">Match it</button>
      </form>
      {pending.length > 0 && (
        <>
          <h2>Pending</h2>
          <ul>
            {pending.map((i) => (
              <li key={i.intake_id}>
                <Link href={`/intake/${i.intake_id}`}>Intake {i.intake_id}</Link> · {i.created_at}
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  )
}
