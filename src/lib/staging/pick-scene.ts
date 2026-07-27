import type { Db } from '@/lib/catalog/db'
import { scenesForFamily } from './scenes'

/**
 * Which scene to spend money on when nobody chose.
 *
 * The old rule was least-used, which spreads generations evenly and is exactly
 * wrong once outcomes are known: approval yield across the shipped templates
 * runs from roughly a third to over four fifths at identical cost per image,
 * so an even spread buys the bad ones as often as the good.
 *
 * Rates are counted within the family and never pooled across it. The catalogue
 * already shows why: color-seamless approves at 6 of 8 on sculpture and 4 of 12
 * on coaster sets, so a pooled figure describes neither. A scene that suits a
 * standing carving can be the wrong answer for a flat set of coasters.
 *
 * A scene needs a real history before its rate means anything. Below the
 * threshold this falls back to least-used, because ranking on three reviews is
 * not measurement, it is noise with a decimal point.
 */
const ENOUGH_TO_JUDGE = 8

/**
 * Every scene for this family, best first.
 *
 * Scenes with a real history lead, ranked by their measured approval rate.
 * The rest follow by how little this design has already used them, which is
 * the only sensible order when there is nothing to rank on.
 */
export function rankScenesForFamily(db: Db, designId: number, family: string): string[] {
  const scenes = scenesForFamily(family)
  const keys = scenes.map((s) => s.key)
  const rows = db
    .prepare(`
      SELECT s.scene_key,
             SUM(s.status = 'approved') AS approved,
             SUM(s.status IN ('approved', 'rejected')) AS judged
      FROM staged_images s
      JOIN designs d ON d.design_id = s.design_id
      WHERE d.family = ? AND s.scene_key IN (${keys.map(() => '?').join(', ')})
      GROUP BY s.scene_key
    `)
    .all(family, ...keys) as Array<{ scene_key: string; approved: number; judged: number }>

  const seen = new Map(rows.map((r) => [r.scene_key, r]))
  const judged = keys
    .map((key) => seen.get(key))
    .filter((r): r is { scene_key: string; approved: number; judged: number } => !!r && r.judged >= ENOUGH_TO_JUDGE)

  const ranked = judged
    .sort((a, b) => b.approved / b.judged - a.approved / a.judged)
    .map((r) => r.scene_key)

  const usedHere = db
    .prepare('SELECT scene_key, COUNT(*) AS n FROM staged_images WHERE design_id = ? GROUP BY scene_key')
    .all(designId) as Array<{ scene_key: string; n: number }>
  const counts = new Map(usedHere.map((r) => [r.scene_key, r.n]))
  const rest = keys
    .filter((k) => !ranked.includes(k))
    .sort((a, b) => (counts.get(a) ?? 0) - (counts.get(b) ?? 0))

  return [...ranked, ...rest]
}
