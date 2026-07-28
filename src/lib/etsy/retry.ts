import { EtsyApiError } from './gateway'

/**
 * Whether an Etsy failure is worth asking again.
 *
 * The same split the Codex image path draws: retry the transient thing, never
 * retry a refusal that means something. A dropped connection or an overloaded
 * upstream says nothing about the request, so asking again is the whole point.
 * A 400 means Etsy looked at what was sent and declined it, and asking twice
 * more only spends the shop's rate limit to hear the same answer.
 *
 * 429 sits with the transient ones deliberately. It is an instruction to wait,
 * not a judgement about the upload.
 */
export function isTransient(error: unknown): boolean {
  if (error instanceof EtsyApiError) return error.status === 429 || error.status >= 500
  // Anything that never became an HTTP response: DNS, socket, TLS, abort. This
  // is what "image failed to upload: fetch failed" was.
  return true
}

export const ATTEMPTS = 3
export const BACKOFF_MS = 1000

/**
 * One Etsy call, with the transient failures tried again.
 *
 * A recorded push put a listing live with two of its four photos because two
 * uploads hit "fetch failed" and the loop moved on. Nothing in the Etsy client
 * retried anything.
 */
export async function withRetry<T>(
  run: () => Promise<T>,
  opts: { attempts?: number; backoffMs?: number } = {}
): Promise<T> {
  const attempts = opts.attempts ?? ATTEMPTS
  const backoffMs = opts.backoffMs ?? BACKOFF_MS
  let last: unknown
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await run()
    } catch (error) {
      if (!isTransient(error)) throw error
      last = error
      if (attempt < attempts) await new Promise((r) => setTimeout(r, backoffMs * attempt))
    }
  }
  throw last
}
