// CLI: print the per-model eval report as markdown.
import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })

import { getCatalogDb } from '../src/lib/catalog/instance'
import { computeModelStats, renderMarkdown, computeMatchStats, renderMatchMarkdown } from '../src/lib/evals/stats'

const db = getCatalogDb()
const drafts = db.prepare('SELECT model, status, generated_json, final_json, cost_usd FROM drafts').all() as never[]
const events = db.prepare("SELECT payload FROM events WHERE type = 'draft.approved'").all() as never[]
console.log('# Kemuma Studio eval report\n')
console.log(renderMarkdown(computeModelStats(drafts, events)))
const matchEvents = db.prepare("SELECT payload FROM events WHERE type = 'match.confirmed'").all() as never[]
console.log('\n## Matcher\n')
console.log(renderMatchMarkdown(computeMatchStats(matchEvents)))
console.log('\nGenerated from the local catalog; every row is a real listing draft judged by the seller.')
