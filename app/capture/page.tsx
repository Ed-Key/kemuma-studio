import { getCatalogDb } from '@/lib/catalog/instance'
import { listDesigns } from '@/lib/catalog/catalog'
import CaptureForm from './CaptureForm'

export const dynamic = 'force-dynamic'

export default function CapturePage() {
  const colorways = (
    getCatalogDb()
      .prepare('SELECT DISTINCT colorway FROM pieces ORDER BY colorway')
      .all() as Array<{ colorway: string }>
  ).map((r) => r.colorway)
  const designs = listDesigns(getCatalogDb()).length

  return (
    <div className="capture-page">
      <h1>Garage capture</h1>
      <p className="eyebrow">
        One object at a time. Photograph it, measure it, save, next. {designs} designs catalogued so far.
      </p>
      <CaptureForm colorways={colorways} />
    </div>
  )
}
