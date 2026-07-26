import Link from 'next/link'
import { getCatalogDb } from '@/lib/catalog/instance'
import { listDesigns, getDesignDetail } from '@/lib/catalog/catalog'
import { latestDraftForDesign } from '@/lib/catalog/drafts'
import type { ListingDraftRecord } from '@/lib/catalog/drafts'
import { listStagedForDesign } from '@/lib/catalog/staged'
import { listDimensionCardsForDesign } from '@/lib/catalog/dimcards'
import {
  catalogDisplayName,
  compareCardPriority,
  hrefFor,
  nextAction,
  parsePushWarnings,
  statusFor,
  verbFor,
} from '@/lib/catalog/card-state'
import { SHOP_DRAFTS_URL, SHOP_LISTINGS_URL, SHOP_URL } from '@/lib/etsy/urls'
import { createDesignAction, syncEtsyStatesAction } from './actions'
import PendingSubmit from '../components/PendingSubmit'
import ActionForm from '../components/ActionForm'

export const dynamic = 'force-dynamic'

const COLUMNS = 4

// Order matches the real job: catalog, write, approve, push, review images, publish.
// The dot answers "where is this on Etsy", so it reads statusFor's vocabulary
// rather than starting a second one. The word beside it answers "what now",
// which is nextAction's job. The two are deliberately independent: a live
// listing can still be waiting on something.
const DOT: Record<string, 'live' | 'draft' | 'off'> = {
  published: 'live',
  'etsy draft': 'draft',
  cataloged: 'off',
  empty: 'off',
}

// A live listing always reads "live", even when it still has candidate scenes
// sitting in staging. Polishing the photography on something already selling is
// not the critical path, and on real inventory nearly every live design has a
// candidate or two: verbs there would put the accent on 15 of 16 cards and the
// accent would stop meaning anything. The staging tab still carries the count.
// The card links to the tool the work happens in, not to the design's front
// page. Landing on the pieces tab when the outstanding job is image review
// costs a page load and a click on every card in the sheet. A live listing has
// no outstanding tool, so it opens on the design itself.
// Price is not a column anywhere; it lives inside the draft JSON. An unapproved
// draft still has one, and it is a guess the model made, so the caller is told
// which kind it got and renders the two differently.
function priceFrom(draft: ListingDraftRecord | null): { usd: number | null; approved: boolean } {
  if (!draft) return { usd: null, approved: false }
  const raw = draft.final_json ?? draft.generated_json
  try {
    const parsed = JSON.parse(raw) as { price_usd?: unknown }
    const usd =
      typeof parsed.price_usd === 'number' && Number.isFinite(parsed.price_usd) ? parsed.price_usd : null
    return { usd, approved: draft.status === 'approved' && draft.final_json != null }
  } catch {
    return { usd: null, approved: false }
  }
}

function money(n: number): string {
  const rounded = Math.round(n * 100) / 100
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2)
  return '$' + text.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

// Colorways run long ("assorted (pink blue tan magenta)") and a design can hold
// several. One name is worth showing; a join would overflow the line and say
// nothing, so several collapse to the word the shop already uses for it.
function colorwayLabel(pieces: Array<{ colorway: string }>): string | null {
  const names = new Set(
    pieces.map((p) => p.colorway.replace(/\s*\(.*\)\s*$/, '').trim()).filter(Boolean)
  )
  if (names.size === 0) return null
  if (names.size === 1) return [...names][0]
  return 'assorted'
}

type Card = {
  design_id: number
  name: string
  displayName: string
  family: string
  total_quantity: number
  cover: number | null
  colorway: string | null
  published: boolean
  dot: 'live' | 'draft' | 'off' | 'attn'
  attention: boolean
  stage: number
  verb: string
  href: string
  price: number | null
  priceApproved: boolean
}

function stockValue(cards: Card[]): { value: number; priced: number } {
  const priced = cards.filter((c) => c.price != null)
  return {
    value: priced.reduce((sum, c) => sum + (c.price as number) * c.total_quantity, 0),
    priced: priced.length,
  }
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

function Sheet({ cards }: { cards: Card[] }) {
  // A real inventory rarely divides by the column count. The gap is the
  // hairline here, so an unfinished last row would show the grid ground as two
  // solid blocks; page-coloured frames finish the row as empty frames instead.
  const gap = cards.length % COLUMNS === 0 ? 0 : COLUMNS - (cards.length % COLUMNS)
  return (
    <div className="contact-sheet">
      {cards.map((c) => (
        <Link key={c.design_id} href={c.href} className="sheet-cell">
          {c.cover ? (
            <div className="sheet-shot">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/api/photos/${c.cover}`} alt="" loading="lazy" decoding="async" />
            </div>
          ) : (
            <div className="sheet-shot sheet-shot--empty">No photo yet</div>
          )}
          <div className="sheet-body">
            <div className="sheet-name">{c.displayName}</div>
            <div className="sheet-meta">
              <span>
                {c.family}
                {c.colorway ? ` · ${c.colorway}` : ''}
              </span>
              <span className="sheet-count">{plural(c.total_quantity, 'pc')}</span>
            </div>
            <div className="sheet-foot">
              <span
                className={`status-word status-word--${c.dot}${
                  c.published && !c.attention ? ' status-word--done' : ''
                }`}
              >
                <i />
                {c.verb}
              </span>
              {c.price == null ? (
                <span className="sheet-price sheet-price--none">unpriced</span>
              ) : (
                <span className={`sheet-price${c.priceApproved ? '' : ' sheet-price--draft'}`}>
                  {money(c.price)}
                </span>
              )}
            </div>
          </div>
        </Link>
      ))}
      {Array.from({ length: gap }, (_, i) => (
        <div key={`gap-${i}`} className="sheet-filler" aria-hidden="true" />
      ))}
    </div>
  )
}

export default function DesignsPage() {
  const db = getCatalogDb()
  const designs = listDesigns(db)

  const cards: Card[] = designs.map((d) => {
    const detail = getDesignDetail(db, d.design_id)
    const draft = latestDraftForDesign(db, d.design_id)
    const staged = listStagedForDesign(db, d.design_id)
    const dimCards = listDimensionCardsForDesign(db, d.design_id)
    const pieces = detail?.pieces ?? []
    const onEtsy = detail?.etsy_listing_id != null
    const published = detail?.published_at != null
    const pushWarnings = parsePushWarnings(detail?.push_warnings_json ?? null)
    const toReview =
      staged.filter((s) => s.status === 'candidate').length +
      dimCards.filter((c) => c.status === 'candidate').length
    const status = statusFor(
      pieces.map((p) => p.status),
      onEtsy,
      published
    )
    const next = nextAction({
      pieceCount: pieces.length,
      draftStatus: draft?.status ?? 'none',
      onEtsy,
      published,
      toReview,
      pushWarnings,
    })
    const price = priceFrom(draft)
    return {
      design_id: d.design_id,
      name: d.name,
      displayName: catalogDisplayName(d.name),
      family: d.family,
      total_quantity: d.total_quantity,
      cover: pieces.flatMap((p) => p.photos)[0]?.photo_id ?? null,
      colorway: colorwayLabel(pieces),
      published,
      dot: pushWarnings.length > 0 ? 'attn' : DOT[status.label] ?? 'off',
      attention: pushWarnings.length > 0,
      stage: next.stage,
      verb: verbFor({
        stage: next.stage,
        toReview,
        published,
        pushWarnings,
        price: price.usd,
        totalQuantity: d.total_quantity,
      }),
      href: hrefFor(d.design_id, next.stage, published),
      price: price.usd,
      priceApproved: price.approved,
    }
  })

  // A damaged push outranks the ordinary path. Within that path, stage
  // descending still puts the design closest to live first.
  const needsYou = cards
    .filter((c) => !c.published || c.attention)
    .sort(compareCardPriority)
  const liveOnEtsy = cards.filter((c) => c.published && !c.attention)
  const publishedCards = cards.filter((c) => c.published)
  const notPublished = cards.filter((c) => !c.published)

  const totalQty = designs.reduce((n, d) => n + d.total_quantity, 0)
  const pushedNotLive = notPublished.filter((c) => c.dot === 'draft').length
  const unlisted = stockValue(notPublished)
  const listed = stockValue(liveOnEtsy)
  const focus = needsYou[0] ?? null

  return (
    <div>
      <div className="page-head page-head--tight between">
        <div>
          <h1>Catalog</h1>
          <p className="eyebrow">Vintage Kisii soapstone, catalogued for Etsy.</p>
        </div>
        {/* Etsy's logotype with the borrowed "Et" crossed out and faded, so what
            you read is Edsty. The pieces are hidden from screen readers and the
            label carries the name, or it is announced as "Ed Et sty". */}
        <span className="edsty" aria-label="Edsty">
          <span aria-hidden="true">Ed</span>
          <span className="edsty-struck" aria-hidden="true">Et</span>
          <span aria-hidden="true">sty</span>
        </span>
      </div>

      {/* Sync and create are page utilities, not the job. Sync stays in the page
          body because its banner carries immediate per-listing details, while
          the catalog keeps the latest failed push visible after navigation. */}
      <div className="catalog-tools">
        <a href={SHOP_URL} target="_blank" rel="noreferrer">
          Storefront
        </a>
        <a href={SHOP_LISTINGS_URL} target="_blank" rel="noreferrer">
          Listings
        </a>
        <a href={SHOP_DRAFTS_URL} target="_blank" rel="noreferrer">
          Drafts
        </a>
        <ActionForm action={syncEtsyStatesAction} className="tools-do">
          <PendingSubmit pendingLabel="Asking Etsy...">Sync from Etsy</PendingSubmit>
        </ActionForm>
        <details className="new-design tools-do">
          <summary>New design</summary>
          <form action={createDesignAction} className="card form-grid">
            <label className="field">
              <span className="field-label">Name</span>
              <input className="input" name="name" placeholder="Eternity Love Knot" required />
            </label>
            <label className="field">
              <span className="field-label">Family</span>
              <input className="input" name="family" placeholder="love knot, bowl, elephant" required />
            </label>
            <div className="action-row">
              <PendingSubmit pendingLabel="Creating..." orbState="working" variant="primary">
                Create design
              </PendingSubmit>
            </div>
          </form>
        </details>
      </div>

      {/* One sentence, one design, one move. When there is nothing outstanding
          the line keeps its frame and gives back the accent edge, so finishing
          the last job does not make the page jump. */}
      <div className={`action-line${focus ? '' : ' action-line--clear'}`}>
        {focus ? (
          <>
            <div>
              <b>{plural(needsYou.length, 'design')} need{needsYou.length === 1 ? 's' : ''} you.</b>{' '}
              First priority is the {focus.name}, waiting on you to{' '}
              {focus.verb.charAt(0).toLowerCase() + focus.verb.slice(1)}.
            </div>
            <Link href={focus.href}>Start there →</Link>
          </>
        ) : designs.length === 0 ? (
          <>
            <div>
              <b>Nothing catalogued yet.</b> Drop photos in Intake to have a piece matched, or add a
              design by hand.
            </div>
            <Link href="/intake">Go to Intake →</Link>
          </>
        ) : (
          <>
            <div>
              <b>Nothing is waiting on you.</b> All {plural(designs.length, 'design')} are live on Etsy.
            </div>
            <a href={SHOP_LISTINGS_URL} target="_blank" rel="noreferrer">
              See the shop →
            </a>
          </>
        )}
      </div>

      <div className="stat-strip">
        <div className="stat">
          <div className="stat-value">
            {publishedCards.length}
            <span className="stat-unit">live</span>
          </div>
          <div className="stat-note">
            {pushedNotLive === 0
              ? 'nothing else pushed to Etsy'
              : `${pushedNotLive} more pushed as draft${pushedNotLive === 1 ? '' : 's'}`}
          </div>
        </div>
        <div className="stat">
          <div className="stat-value">
            {totalQty}
            <span className="stat-unit">{totalQty === 1 ? 'piece' : 'pieces'}</span>
          </div>
          <div className="stat-note">across {plural(designs.length, 'design')}</div>
        </div>
        <div className="stat">
          <div className="stat-value">{money(unlisted.value)}</div>
          {/* A design with no draft has no price anywhere, so this total can
              only ever be a floor. It says how much of the shelf it counted
              rather than undercounting in silence. */}
          <div className="stat-note">
            unlisted at drafted prices
            {unlisted.priced === notPublished.length
              ? ''
              : `, ${unlisted.priced} of ${notPublished.length} priced`}
          </div>
        </div>
      </div>

      {needsYou.length > 0 ? (
        <>
          <div className="section-head">
            <h2>Needs you</h2>
            <span className="hint">
              {plural(needsYou.length, 'design')}, push problems first, then closest to live
            </span>
          </div>
          <Sheet cards={needsYou} />
        </>
      ) : null}

      {liveOnEtsy.length > 0 ? (
        <>
          <div className="section-head">
            <h2>Live on Etsy</h2>
            <span className="hint">
              {plural(liveOnEtsy.length, 'listing')}
              {listed.priced === 0
                ? ''
                : `, ${money(listed.value)} of stock${
                    listed.priced === liveOnEtsy.length ? '' : `, ${listed.priced} priced`
                  }`}
            </span>
          </div>
          <Sheet cards={liveOnEtsy} />
        </>
      ) : null}
    </div>
  )
}
