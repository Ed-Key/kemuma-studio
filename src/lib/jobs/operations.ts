import { revalidatePath } from 'next/cache'
import type { Db } from '@/lib/catalog/db'
import { dataDir } from '@/lib/catalog/instance'
import type { JobUsage } from '@/lib/catalog/jobs'
import { narrator, type JobStep } from './narrate'
import { computeCostUsd } from '@/lib/writer/prices'

type Say = (step: JobStep) => void

/**
 * What each kind of job actually does, named rather than closed over.
 *
 * These used to be anonymous callbacks inside the server actions that started
 * them, which meant the work only existed for as long as the click that
 * launched it. A retry has to be able to say "run that again" a day later from
 * a different page, so the operation has to be reachable from the job row
 * alone: kind picks the function, input_json supplies the arguments.
 *
 * The same shape is what makes a run replayable, which is what the eval work
 * in the plan will want. Storing the call was the missing half of storing the
 * result.
 */
export type JobInput =
  | {
      kind: 'staging_batch'
      designId: number
      sceneKey?: string
      sourcePhotoId?: number
      variance: boolean
    }
  | { kind: 'director_turn'; designId: number; chatId: number; userText: string }
  | { kind: 'planned_batch'; designId: number; chatId: number; plan: unknown }
  | { kind: 'listing_copy'; designId: number }

function stagingDestination(designId: number): string {
  return `/designs/${designId}/staging`
}

async function runStagingBatch(
  db: Db,
  input: Extract<JobInput, { kind: 'staging_batch' }>,
  say: Say
): Promise<JobUsage> {
  const { defaultArtDirector } = await import('@/lib/staging/direct-openai')
  const { defaultImageGenerator } = await import('@/lib/staging/images-codex')
  const { runStaging } = await import('@/lib/staging/stage')
  const { getStagedImage } = await import('@/lib/catalog/staged')

  const artDirector = defaultArtDirector()
  const imageGenerator = defaultImageGenerator()
  const ids = await runStaging(
    db,
    { artDirector, imageGenerator },
    {
      designId: input.designId,
      dataDir: dataDir(),
      sceneKey: input.sceneKey,
      sourcePhotoId: input.sourcePhotoId,
      variance: input.variance,
      onPhase: (text) => say({ kind: 'phase', text }),
    }
  )
  const cost = ids.reduce((sum, id) => sum + (getStagedImage(db, id)?.cost_usd ?? 0), 0)
  revalidatePath(stagingDestination(input.designId))
  return {
    model: `${artDirector.label} + ${imageGenerator.label}`,
    cost_usd: cost,
  }
}

async function runDirectorTurn(
  db: Db,
  input: Extract<JobInput, { kind: 'director_turn' }>,
  say: Say
): Promise<JobUsage> {
  const call = { designId: input.designId, chatId: input.chatId, userText: input.userText }
  const destination = stagingDestination(input.designId)
  const spec = process.env.STAGING_AGENT_MODEL ?? ''

  if (spec.startsWith('claude-sub:')) {
    const { runAgentTurnViaClaudeSdk } = await import('@/lib/staging/agent-claude-sdk')
    // The stream was already being reported frame by frame and dropped on the
    // floor by every caller. This is the listener it was built for.
    const result = await runAgentTurnViaClaudeSdk(db, call, { onStep: say })
    const model = `claude-sub:${spec.slice('claude-sub:'.length) || 'default'}`
    revalidatePath(destination)
    return {
      ...result,
      model,
      cost_usd: computeCostUsd(model, result.input_tokens, result.output_tokens),
    }
  }

  const { agentModel, runAgentTurn } = await import('@/lib/staging/agent')
  const { defaultAgentClient } = await import('@/lib/staging/agent-openai')
  const result = await runAgentTurn(db, defaultAgentClient(), call)
  const model = agentModel()
  revalidatePath(destination)
  return {
    ...result,
    model,
    cost_usd: computeCostUsd(model, result.input_tokens, result.output_tokens),
  }
}

async function runPlanned(
  db: Db,
  input: Extract<JobInput, { kind: 'planned_batch' }>,
  say: Say
): Promise<JobUsage> {
  const { parseStoredPlan } = await import('@/lib/staging/plan')
  const { runPlannedBatch } = await import('@/lib/staging/stage')
  const { defaultImageGenerator } = await import('@/lib/staging/images-codex')
  const { getStagedImage } = await import('@/lib/catalog/staged')
  const { setPendingPlan } = await import('@/lib/catalog/chats')

  // Parsed from the stored copy rather than read back off the chat. The chat's
  // pending plan is cleared the moment a batch succeeds, so a run that reads it
  // live can only ever happen once; the job row is what makes it repeatable.
  const stored = parseStoredPlan(input.plan)
  if (!stored.ok) throw new Error(stored.reason)
  const plan = stored.plan
  const imageGenerator = defaultImageGenerator()
  const ids = await runPlannedBatch(
    db,
    { imageGenerator },
    {
      designId: input.designId,
      dataDir: dataDir(),
      plan,
      onPhase: (text) => say({ kind: 'phase', text }),
    }
  )
  const cost = ids.reduce((sum, id) => sum + (getStagedImage(db, id)?.cost_usd ?? 0), 0)
  setPendingPlan(db, input.chatId, null)
  revalidatePath(stagingDestination(input.designId))
  return { model: imageGenerator.label, cost_usd: cost }
}

async function runListingCopy(
  db: Db,
  input: Extract<JobInput, { kind: 'listing_copy' }>
): Promise<JobUsage> {
  const { generateDraft } = await import('@/lib/writer/generate')
  const { defaultWriter } = await import('@/lib/writer/providers')
  const { getDraft } = await import('@/lib/catalog/drafts')

  const draftId = await generateDraft(db, defaultWriter(), input.designId)
  const record = getDraft(db, draftId)
  const usage = record?.usage_json
    ? (JSON.parse(record.usage_json) as { input_tokens: number; output_tokens: number })
    : undefined
  revalidatePath(`/designs/${input.designId}/draft`)
  return {
    model: record?.model ?? null,
    input_tokens: usage?.input_tokens ?? null,
    output_tokens: usage?.output_tokens ?? null,
    cost_usd: record?.cost_usd ?? null,
  }
}

/**
 * Run one job's work. The single place that maps a kind onto its executor.
 *
 * The job id is here only so the work can say what it is doing. It is optional
 * because the operations are the same work either way, and a run with nobody
 * listening should not have to invent a listener.
 */
export function runJobOperation(db: Db, input: JobInput, jobId?: number): Promise<JobUsage> {
  const step = jobId === undefined ? () => {} : narrator(db, jobId)
  switch (input.kind) {
    case 'staging_batch':
      return runStagingBatch(db, input, step)
    case 'director_turn':
      return runDirectorTurn(db, input, step)
    case 'planned_batch':
      return runPlanned(db, input, step)
    case 'listing_copy':
      return runListingCopy(db, input)
  }
}

/**
 * Read a stored call back off a job row.
 *
 * Rows written before jobs recorded their inputs have nothing to read, and a
 * row whose JSON no longer matches the shape its kind expects is the same
 * problem wearing a disguise. Both come back null, and the caller's job is to
 * offer no retry rather than to guess at the arguments.
 */
export function parseJobInput(kind: string, inputJson: string | null): JobInput | null {
  if (!inputJson) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(inputJson)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const call = parsed as Record<string, unknown>
  if (typeof call.designId !== 'number') return null

  switch (kind) {
    case 'staging_batch':
      return {
        kind,
        designId: call.designId,
        sceneKey: typeof call.sceneKey === 'string' ? call.sceneKey : undefined,
        sourcePhotoId: typeof call.sourcePhotoId === 'number' ? call.sourcePhotoId : undefined,
        variance: call.variance === true,
      }
    case 'director_turn':
      if (typeof call.chatId !== 'number' || typeof call.userText !== 'string') return null
      return { kind, designId: call.designId, chatId: call.chatId, userText: call.userText }
    case 'planned_batch':
      if (typeof call.chatId !== 'number' || call.plan == null) return null
      return { kind, designId: call.designId, chatId: call.chatId, plan: call.plan }
    case 'listing_copy':
      return { kind, designId: call.designId }
    default:
      return null
  }
}
