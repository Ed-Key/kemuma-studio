/*
 * The chain behind one design's staged images, end to end.
 *
 *   npx tsx scripts/story.ts <design_id>
 *
 * Three things produced each picture and they are stored in three places: what
 * the director was asked to do, the prompt the assembler built from its answer,
 * and the file that came back. Read separately they explain nothing. A bad
 * image could be a bad plan, an assembler that mangled a good plan, or an image
 * model that ignored a correct prompt, and those have different fixes.
 */
import path from 'node:path'
import { existsSync, statSync } from 'node:fs'
import { openDb } from '../src/lib/catalog/db'
import { getDesignDetail } from '../src/lib/catalog/catalog'

const DB = process.env.KEMUMA_DB ?? path.join(process.cwd(), 'data', 'catalog.sqlite')

type Row = {
  staged_id: number
  scene_key: string
  status: string
  destination: string | null
  reject_reason: string | null
  reject_note: string | null
  prompt: string
  prompt_version: string | null
  plan_json: string | null
  file_path: string
  cost_usd: number | null
  created_at: string
}

const indent = (text: string, pad = '      ') =>
  text
    .trim()
    .split('\n')
    .map((line) => pad + line)
    .join('\n')

function section(prompt: string, name: string): string | null {
  // The assembler writes "NAME - body" blocks separated by blank lines.
  const match = prompt.split(/\n\s*\n/).find((block) => block.trimStart().startsWith(name))
  return match ? match.trim().slice(name.length).replace(/^\s*-\s*/, '') : null
}

function main() {
  const designId = Number(process.argv[2])
  if (!Number.isFinite(designId)) throw new Error('usage: tsx scripts/story.ts <design_id>')

  const db = openDb(DB)
  const detail = getDesignDetail(db, designId)
  if (!detail) throw new Error(`design ${designId} not found`)

  const rows = db
    .prepare(`
      SELECT staged_id, scene_key, status, destination, reject_reason, reject_note,
             prompt, prompt_version, plan_json, file_path, cost_usd, created_at
      FROM staged_images WHERE design_id = ? ORDER BY staged_id
    `)
    .all(designId) as Row[]

  console.log(`\n${detail.name}  (${detail.family}, design ${designId})`)
  console.log(`${rows.length} staged image${rows.length === 1 ? '' : 's'}\n`)

  /* One plan makes four images, so group rather than repeat it four times.
     Keyed on the stamp the writer puts in every filename of a batch, because
     two runs of the same scene produce byte-identical prompts and grouping on
     those silently merges them into one batch that never existed. */
  const batches = new Map<string, Row[]>()
  for (const row of rows) {
    const stamp = path.basename(row.file_path).match(/-(\d{10,})-\d+\./)?.[1]
    const key = stamp ?? `${row.scene_key}|${row.created_at}`
    batches.set(key, [...(batches.get(key) ?? []), row])
  }

  let n = 0
  for (const batch of batches.values()) {
    const first = batch[0]
    n += 1
    console.log(`${'─'.repeat(72)}`)
    console.log(`batch ${n}  ${first.scene_key}  ${first.created_at}  prompt ${first.prompt_version ?? '(unversioned)'}`)

    if (first.plan_json) {
      const plan = JSON.parse(first.plan_json)
      console.log('\n  1. what the director asked for')
      if (Array.isArray(plan.counts)) {
        console.log(`      counts: ${plan.counts.map((c: { n: number; what: string }) => `${c.n} ${c.what}`).join(', ')}`)
      }
      for (const field of ['arrangement', 'scene', 'lighting'] as const) {
        if (plan[field]) console.log(`      ${field}: ${String(plan[field]).slice(0, 150)}`)
      }
    } else {
      console.log('\n  1. what the director asked for')
      console.log('      not recorded (this batch predates plan_json)')
    }

    console.log('\n  2. the prompt the assembler built')
    for (const name of ['SUBJECT AND COUNT', 'COMPOSITION', 'PRODUCT LOCK']) {
      const body = section(first.prompt, name)
      if (body) console.log(indent(`${name}: ${body.slice(0, 190)}`))
    }

    console.log('\n  3. what came back')
    for (const row of batch) {
      const exists = existsSync(row.file_path)
      const size = exists ? `${(statSync(row.file_path).size / 1e6).toFixed(1)} MB` : 'file missing'
      const verdict =
        row.status === 'rejected'
          ? `rejected: ${row.reject_reason ?? 'unlabelled'}${row.reject_note ? ` (${row.reject_note})` : ''}`
          : row.status === 'approved'
            ? `approved -> ${row.destination ?? 'no destination'}`
            : 'not judged yet'
      console.log(`      ${path.basename(row.file_path).padEnd(34)} ${size.padEnd(12)} ${verdict}`)
    }
    console.log()
  }

  db.close()
}

main()
