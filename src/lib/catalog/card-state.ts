export function statusFor(
  pieceStatuses: string[],
  onEtsy: boolean,
  published: boolean
): { label: string; cls: string } {
  if (pieceStatuses.length === 0) return { label: 'empty', cls: 'pill pill--none muted' }
  if (published) return { label: 'published', cls: 'pill pill--ok' }
  if (onEtsy) return { label: 'etsy draft', cls: 'pill pill--warn' }
  return { label: 'cataloged', cls: 'pill' }
}

export function nextAction(d: {
  pieceCount: number
  draftStatus: 'none' | 'generated' | 'approved'
  onEtsy: boolean
  published: boolean
  toReview: number
  pushWarnings: string[]
}): { stage: number; label: string } {
  if (d.pushWarnings.length > 0) return { stage: 7, label: 'last push had problems' }
  if (d.pieceCount === 0) return { stage: 0, label: 'add a piece' }
  if (d.draftStatus === 'none') return { stage: 1, label: 'needs copy' }
  if (d.draftStatus === 'generated') return { stage: 2, label: 'approve the copy' }
  if (!d.onEtsy) return { stage: 3, label: 'ready to push' }
  if (d.toReview > 0) return { stage: 4, label: `${d.toReview} to review` }
  if (!d.published) return { stage: 5, label: 'publish it' }
  return { stage: 6, label: '' }
}

export function compareCardPriority(
  a: { stage: number; name: string },
  b: { stage: number; name: string }
): number {
  return b.stage - a.stage || a.name.localeCompare(b.name)
}

function money(n: number): string {
  const rounded = Math.round(n * 100) / 100
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2)
  return '$' + text.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

export function verbFor(d: {
  stage: number
  toReview: number
  published: boolean
  pushWarnings: string[]
  price: number | null
  totalQuantity: number
}): string {
  if (d.pushWarnings.length > 0) {
    const failedImages = d.pushWarnings.filter((warning) =>
      /^image \d+ failed to upload:/i.test(warning)
    ).length
    if (failedImages > 0) {
      return `Re-upload ${failedImages} image${failedImages === 1 ? '' : 's'}`
    }
    if (
      d.pushWarnings.some((warning) =>
        /attribute|category|property|not available/i.test(warning)
      )
    ) {
      return 'Retry Etsy attributes'
    }
    return 'Re-push to Etsy'
  }
  if (d.published) return 'live'
  switch (d.stage) {
    case 0:
      return 'Add the first piece'
    case 1:
      return 'Write copy and set a price'
    case 2:
      return d.price == null ? 'Review the unpriced draft' : `Review the ${money(d.price)} draft`
    case 3:
      return `Push ${d.totalQuantity} piece${d.totalQuantity === 1 ? '' : 's'} to Etsy`
    case 4:
      return `Review ${d.toReview} image${d.toReview === 1 ? '' : 's'}`
    case 5:
      return `Publish ${d.totalQuantity}-piece Etsy draft`
    default:
      return 'live'
  }
}

export function hrefFor(designId: number, stage: number, published: boolean): string {
  if (stage === 7) return `/designs/${designId}/draft`
  if (published) return `/designs/${designId}`
  if (stage >= 1 && stage <= 3) return `/designs/${designId}/draft`
  if (stage === 4) return `/designs/${designId}/staging`
  return `/designs/${designId}`
}

export function parsePushWarnings(value: string | null): string[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) && parsed.every((warning) => typeof warning === 'string')
      ? parsed
      : []
  } catch {
    return []
  }
}

export function catalogDisplayName(name: string): string {
  return name.replace(/\s+\([^()]+\)\s*$/, '').trim()
}

/**
 * The notes field carries two different things separated by semicolons: a
 * description of the piece ("holder plus 6 round coasters, etched geometric
 * patterns") and the owner's own measurement bookkeeping ("dims/weight
 * ESTIMATED from photos; verify before listing"). Only the first is a subtitle.
 * The bookkeeping is already surfaced where it can be acted on, as the
 * "estimated" pill against the measurements themselves, so repeating it under
 * the design name gave a fix-me scribble the same rank as the shop's own copy.
 */
export function describeDesign(notes: string | null | undefined): string {
  if (!notes) return ''
  const described = notes
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part && !/\b(verified|estimated|verify before listing)\b/i.test(part))
  return described.join('; ')
}
