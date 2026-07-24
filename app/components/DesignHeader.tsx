import Link from 'next/link'
import { getCatalogDb } from '@/lib/catalog/instance'
import { latestDraftForDesign } from '@/lib/catalog/drafts'
import { listStagedForDesign } from '@/lib/catalog/staged'
import { listDimensionCardsForDesign } from '@/lib/catalog/dimcards'
import { listingEditorUrl } from '@/lib/etsy/urls'

type DesignDetail = {
  design_id: number
  family: string
  name: string
  notes: string | null
  etsy_listing_id: number | null
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
    <div className="between page-head">
      <div>
        <h1>{detail.name}</h1>
        <p className="eyebrow">
          {detail.family}
          {detail.notes ? ` · ${detail.notes}` : ''}
        </p>
      </div>
      <div className="row">
        {detail.etsy_listing_id != null ? (
          <a
            className="pill pill--accent"
            href={listingEditorUrl(detail.etsy_listing_id)}
            target="_blank"
            rel="noreferrer"
          >
            Etsy draft {detail.etsy_listing_id}
          </a>
        ) : (
          <span className="pill pill--none muted">Not on Etsy</span>
        )}
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={t.href}
            className="btn btn--ghost"
            aria-current={t.key === current ? 'page' : undefined}
          >
            {t.label}
            {t.state ? <span className="mono muted"> · {t.state}</span> : null}
          </Link>
        ))}
        {children}
      </div>
    </div>
  )
}
