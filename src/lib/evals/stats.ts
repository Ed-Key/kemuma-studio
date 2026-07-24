export interface ModelStats {
  model: string
  drafts: number
  approved: number
  acceptedUntouched: number
  fieldEdits: Record<string, number>
  avgCostUsd: number | null
  priceCalibration: number | null
}

interface DraftRow {
  model: string
  status: string
  generated_json: string
  final_json: string | null
  cost_usd: number | null
}

export function computeModelStats(drafts: DraftRow[], _approvedEvents: Array<{ payload: string }>): ModelStats[] {
  const byModel = new Map<string, DraftRow[]>()
  for (const d of drafts) {
    const list = byModel.get(d.model) ?? []
    list.push(d)
    byModel.set(d.model, list)
  }

  return Array.from(byModel, ([model, rows]) => {
    const approvedRows = rows.filter((r) => r.status === 'approved' && r.final_json)
    let acceptedUntouched = 0
    const fieldEdits: Record<string, number> = {}
    const priceDeltas: number[] = []
    for (const row of approvedRows) {
      const gen = JSON.parse(row.generated_json) as Record<string, unknown>
      const fin = JSON.parse(row.final_json!) as Record<string, unknown>
      const edited = Object.keys(gen).filter((k) => JSON.stringify(gen[k]) !== JSON.stringify(fin[k]))
      if (edited.length === 0) acceptedUntouched += 1
      for (const k of edited) fieldEdits[k] = (fieldEdits[k] ?? 0) + 1
      const genPrice = Number(gen.price_usd)
      const finPrice = Number(fin.price_usd)
      if (genPrice > 0 && Number.isFinite(finPrice)) priceDeltas.push((finPrice - genPrice) / genPrice)
    }
    const costs = rows.map((r) => r.cost_usd).filter((c): c is number => c != null)
    return {
      model,
      drafts: rows.length,
      approved: approvedRows.length,
      acceptedUntouched,
      fieldEdits,
      avgCostUsd: costs.length ? costs.reduce((a, b) => a + b, 0) / costs.length : null,
      priceCalibration: priceDeltas.length ? priceDeltas.reduce((a, b) => a + b, 0) / priceDeltas.length : null,
    }
  }).sort((a, b) => a.model.localeCompare(b.model))
}

export function renderMarkdown(stats: ModelStats[]): string {
  const lines = [
    '| model | drafts | approved | accepted untouched | edited fields | avg cost | price calibration |',
    '|---|---|---|---|---|---|---|',
  ]
  for (const s of stats) {
    const edits = Object.entries(s.fieldEdits).map(([k, n]) => `${k}:${n}`).join(', ') || 'none'
    lines.push(
      `| ${s.model} | ${s.drafts} | ${s.approved} | ${s.acceptedUntouched} | ${edits} | ${
        s.avgCostUsd != null ? `$${s.avgCostUsd.toFixed(3)}` : 'n/a'
      } | ${s.priceCalibration != null ? `${(s.priceCalibration * 100).toFixed(1)}%` : 'n/a'} |`
    )
  }
  return lines.join('\n')
}
