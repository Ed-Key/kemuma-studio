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
/* Codes for a request that never became a response: DNS, socket, TLS, timeout.
   undici hangs the real cause off error.cause, so both levels are checked. */
const NETWORK_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ECONNABORTED',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EPIPE',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'UND_ERR_SOCKET',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
])

export function isTransient(error: unknown): boolean {
  if (error instanceof EtsyApiError) return error.status === 429 || error.status >= 500
  if (!(error instanceof Error)) return false
  // Someone asked for this to stop. Asking again is the opposite of obeying.
  if (error.name === 'AbortError' || error.name === 'TimeoutError') return false
  // fetch reports everything that never reached a response as a TypeError, and
  // "image failed to upload: fetch failed" was one of these.
  if (error instanceof TypeError) return true
  const code = (error as NodeJS.ErrnoException).code
  const causeCode = (error.cause as NodeJS.ErrnoException | undefined)?.code
  return NETWORK_CODES.has(String(code)) || NETWORK_CODES.has(String(causeCode))
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
      if (attempt >= attempts) break
      // Etsy's own number wins when it gave one: a rate limit is a duration,
      // and waiting less than it asked burns the remaining attempts.
      const asked = error instanceof EtsyApiError ? error.retryAfterMs : null
      await new Promise((r) => setTimeout(r, Math.max(backoffMs * attempt, asked ?? 0)))
    }
  }
  throw last
}
