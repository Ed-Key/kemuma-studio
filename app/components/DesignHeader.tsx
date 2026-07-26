import Link from 'next/link'
import { getCatalogDb } from '@/lib/catalog/instance'
import { latestDraftForDesign } from '@/lib/catalog/drafts'
import { listStagedForDesign } from '@/lib/catalog/staged'
import { listDimensionCardsForDesign } from '@/lib/catalog/dimcards'
import { listingEditorUrl } from '@/lib/etsy/urls'
import { describeDesign } from '@/lib/catalog/card-state'

type DesignDetail = {
  design_id: number
  family: string
  name: string
  notes: string | null
  etsy_listing_id: number | null
  published_at?: string | null
  pieces: Array<{ status: string }>
}

type Tab = 'pieces' | 'draft' | 'staging' | 'bakeoff'

/**
 * The one place that renders what a design IS and where it stands. Mounted on
 * every design-scoped page so the Etsy link and per-tab state never depend on
 * which step the user happens to be looking at.
 */
export default function DesignHeader({
  detail,
  current,
  children,
}: {
  detail: DesignDetail
  current: Tab
  children?: React.ReactNode
}) {
  const db = getCatalogDb()
  const draft = latestDraftForDesign(db, detail.design_id)
  const staged = listStagedForDesign(db, detail.design_id)
  const cards = listDimensionCardsForDesign(db, detail.design_id)

  const published = Boolean(detail.published_at)
  const draftState = draft ? (draft.status === 'approved' ? 'approved' : 'generated') : 'none'
  const toReview =
    staged.filter((s) => s.status === 'candidate').length +
    cards.filter((c) => c.status === 'candidate').length
  const approvedImages =
    staged.filter((s) => s.status === 'approved').length +
    cards.filter((c) => c.status === 'approved').length
  const stagingState =
    toReview > 0 ? `${toReview} to review` : approvedImages > 0 ? `${approvedImages} approved` : 'none'

  const tabs: Array<{ key: Tab; label: string; href: string; state?: string }> = [
    { key: 'pieces', label: 'Pieces', href: `/designs/${detail.design_id}` },
    {
      key: 'draft',
      label: 'Listing draft',
      href: `/designs/${detail.design_id}/draft`,
      state: draftState,
    },
    {
      key: 'staging',
      label: 'Staging',
      href: `/designs/${detail.design_id}/staging`,
      state: stagingState,
    },
  ]

  return (
    <div className="page-head">
      <div className="between">
        <div>
          <h1>{detail.name}</h1>
        {/* Facts about the design sit with its name. They used to share the row
            with the tabs, which put a listing id, a published flag and three
            destinations in one line and made all five read as offers. */}
          <p className="head-facts">
            <span>{detail.family}</span>
            {describeDesign(detail.notes) ? (
              <>
                <span className="sep">·</span>
                <span>{describeDesign(detail.notes)}</span>
              </>
            ) : null}
            <span className="sep">·</span>
            {detail.etsy_listing_id != null ? (
              <a href={listingEditorUrl(detail.etsy_listing_id)} target="_blank" rel="noreferrer">
                Etsy listing {detail.etsy_listing_id}
              </a>
            ) : (
              <span>not on Etsy</span>
            )}
            {published ? (
              <>
                <span className="sep">·</span>
                <span className="head-fact--live">live</span>
              </>
            ) : null}
          </p>
        </div>
        <div className="row">{children}</div>
      </div>
      <nav className="segmented segmented--full">
        {tabs.map((t) => (
          <Link key={t.key} href={t.href} aria-current={t.key === current ? 'page' : undefined}>
            {t.label}
            {/* "approved", "3 to review" and "none" are words about where the
                work stands, not machine values, so they are not set in mono. */}
            {t.state ? <span className="tab-state">{t.state}</span> : null}
          </Link>
        ))}
      </nav>
    </div>
  )
}
