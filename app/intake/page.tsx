import Link from 'next/link'
import { getCatalogDb } from '@/lib/catalog/instance'
import { listPendingIntakes } from '@/lib/catalog/intakes'
import { createIntakeAction } from './actions'
import PendingSubmit from '../components/PendingSubmit'

export const dynamic = 'force-dynamic'

export default function IntakePage() {
  const pending = listPendingIntakes(getCatalogDb())
  return (
    <div>
      <div className="page-head">
        <h1>Intake</h1>
        <p className="eyebrow">
          Photograph a piece, drop the photos here, and the matcher proposes where it belongs.
        </p>
      </div>

      <div className="card" style={{ maxWidth: 560 }}>
        <div className="card-title">New intake</div>
        <form action={createIntakeAction} className="stack-sm">
          <label className="drop-zone">
            Drop photos or click to choose
            <input type="file" name="photos" accept=".jpg,.jpeg,.png,.webp,.heic" multiple required />
          </label>
          <div className="action-row">
            <PendingSubmit pendingLabel="Matching..." orbState="solving" variant="primary">
              Match it
            </PendingSubmit>
          </div>
        </form>
      </div>

      {pending.length > 0 && (
        <div className="section">
          <div className="card-title">Pending</div>
          <div className="design-grid">
            {pending.map((i) => (
              <Link key={i.intake_id} href={`/intake/${i.intake_id}`} className="card">
                <div className="design-name">Intake {i.intake_id}</div>
                <div className="mono muted">{i.created_at}</div>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
