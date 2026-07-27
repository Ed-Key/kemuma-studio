import type { Db } from '@/lib/catalog/db'
import { appendLog, countToolCalls } from '@/lib/catalog/jobs'

/**
 * What a job reports about itself while it runs.
 *
 * `tool` and `say` come from the agent loop, which already emits both; `phase`
 * is for the work that has no loop, where the honest structure is a handful of
 * real boundaries (directing, then generating) rather than a stream.
 */
export type JobStep =
  | { kind: 'tool'; name: string; input: unknown }
  | { kind: 'say'; text: string }
  | { kind: 'writing'; section: string }
  | { kind: 'phase'; text: string }
  /* Carries the tool result, not the tool call. The narrator otherwise only
     ever sees calls, which is why eight looping runs recorded that the plan
     was rejected and never once which rule did it. */
  | { kind: 'rejected'; reason: string; gaveUp?: boolean }
  | { kind: 'done'; turns?: number }

/**
 * The plan's sections in the owner's words.
 *
 * Only the ones worth watching. size, n and reference_photo_ids are decided
 * long before they are typed, so announcing them would be narrating the
 * director's typing speed rather than its thinking.
 */
const PLAN_SECTIONS: Record<string, string> = {
  scene: 'writing the scene',
  lighting: 'writing the lighting',
  subject_and_count: 'writing what is in frame',
  composition: 'writing the composition',
  product_lock: 'writing the product lock',
  extra_exclusions: 'writing the exclusions',
}

function photoList(input: unknown): string | null {
  if (typeof input !== 'object' || input === null) return null
  const ids = (input as { photo_ids?: unknown }).photo_ids
  if (!Array.isArray(ids) || ids.length === 0) return null
  const numbers = ids.filter((id): id is number => typeof id === 'number')
  if (numbers.length === 0) return null
  return numbers.join(', ')
}

/**
 * A tool call in the owner's language.
 *
 * The names are the agent's, not the owner's, and "view_photos" with a JSON
 * argument tells them nothing they wanted to know. An unknown tool falls
 * through to null rather than printing its raw name, because a line the owner
 * cannot read is worse than the elapsed timer they already had.
 */
export function describeStep(step: JobStep, alreadyCalled = 0): string | null {
  switch (step.kind) {
    case 'phase':
      return step.text.trim() || null
    case 'writing':
      return PLAN_SECTIONS[step.section] ?? null
    case 'rejected':
      return step.gaveUp
        ? `gave up after repeated rejections: ${step.reason}`
        : `the plan was rejected: ${step.reason}`
    case 'say':
      // Stored, deliberately not shown. The plan's rule is tool events first:
      // the director's prose is written for the chat, and a half-formed
      // sentence torn out of it and put in a status line reads like a leak.
      return null
    case 'done':
      return null
    case 'tool':
      switch (step.name) {
        case 'view_design':
          return 'reading the design'
        case 'view_photos': {
          const ids = photoList(step.input)
          return ids ? `looking at photos ${ids}` : 'looking at the photos'
        }
        case 'list_scenes':
          return 'looking through the scenes'
        case 'review_history':
          return 'reviewing what has been staged before'
        case 'save_staging_note':
          return 'saving a note about this piece'
        case 'plan_batch':
          // The director is told to call plan_batch again when the validator
          // rejects its plan, so a second call is a rejection and nothing else.
          // Saying "writing the plan" four times running made a turn that was
          // failing look like a turn that was stuck, which is the opposite of
          // what the owner needs to know.
          if (alreadyCalled === 0) return 'writing the plan'
          if (alreadyCalled === 1) return 'the plan was rejected, writing it again'
          return `the plan was rejected ${alreadyCalled} times, writing it again`
        default:
          return null
      }
  }
}

/**
 * Give a job a way to say what it is doing.
 *
 * Everything is stored, including the text blocks describeStep declines to
 * show, because the plan wants past runs replayable step by step and that is
 * cheaper to have than to add later. What the rail displays is a separate
 * decision, made in describeStep.
 *
 * Narration must never be able to break the work it narrates, so a failed
 * write is swallowed. A job that finishes without its commentary is a smaller
 * problem than a two minute batch lost to a logging error.
 */
export function narrator(db: Db, jobId: number): (step: JobStep) => void {
  return (step) => {
    try {
      if (step.kind === 'done') return

      // The log_type is what tells a reader whether a row was written for the
      // owner. 'tool_use' means the job did a discrete thing and content is
      // already phrased for them, so the narration line is the latest of those
      // and needs no other rule. Phases are tool_use with no tool name, since
      // "the job did a discrete thing" is exactly what they report. 'text' is
      // the agent's own prose: kept for replay, never shown.
      if (step.kind === 'say') {
        appendLog(db, { job_id: jobId, log_type: 'text', content: step.text })
        return
      }
      const seen = step.kind === 'tool' ? countToolCalls(db, jobId, step.name) : 0
      // A rejection is the one row written from a tool result rather than a
      // call, so it gets the log type that says so and stays out of the
      // tool-call counts the narration reads.
      const content = describeStep(step, seen)
      if (!content) return
      appendLog(db, {
        job_id: jobId,
        log_type: step.kind === 'rejected' ? 'tool_result' : 'tool_use',
        tool_name: step.kind === 'tool' ? step.name : null,
        content,
      })
    } catch {
      // See above: the run matters, the commentary does not.
    }
  }
}
