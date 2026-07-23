import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const TOKEN_URL = 'https://api.etsy.com/v3/public/oauth/token'

export interface EtsyTokens {
  access_token: string
  refresh_token: string
  expires_at: number
}

async function postForm(fetchFn: typeof fetch, params: Record<string, string>): Promise<EtsyTokens> {
  const res = await fetchFn(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  })
  if (!res.ok) {
    throw new Error(`etsy token endpoint ${res.status}: ${await res.text()}`)
  }
  const json = (await res.json()) as { access_token: string; refresh_token: string; expires_in: number }
  return {
    access_token: json.access_token,
    refresh_token: json.refresh_token,
    expires_at: Date.now() + json.expires_in * 1000,
  }
}

export function exchangeCode(
  fetchFn: typeof fetch,
  opts: { keystring: string; redirectUri: string; code: string; verifier: string }
): Promise<EtsyTokens> {
  return postForm(fetchFn, {
    grant_type: 'authorization_code',
    client_id: opts.keystring,
    redirect_uri: opts.redirectUri,
    code: opts.code,
    code_verifier: opts.verifier,
  })
}

export function refreshTokens(
  fetchFn: typeof fetch,
  opts: { keystring: string; refreshToken: string }
): Promise<EtsyTokens> {
  return postForm(fetchFn, {
    grant_type: 'refresh_token',
    client_id: opts.keystring,
    refresh_token: opts.refreshToken,
  })
}

const tokensFile = (dir: string) => path.join(dir, 'etsy-tokens.json')
const pendingFile = (dir: string) => path.join(dir, 'etsy-oauth-pending.json')

async function writeJson(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(value, null, 2))
}

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as T
  } catch {
    return null
  }
}

export const saveTokens = (dir: string, tokens: EtsyTokens) => writeJson(tokensFile(dir), tokens)
export const loadTokens = (dir: string) => readJson<EtsyTokens>(tokensFile(dir))
export const savePending = (dir: string, p: { state: string; verifier: string }) => writeJson(pendingFile(dir), p)
export const loadPending = (dir: string) => readJson<{ state: string; verifier: string }>(pendingFile(dir))

export async function getValidAccessToken(fetchFn: typeof fetch, dir: string, keystring: string): Promise<string> {
  const tokens = await loadTokens(dir)
  if (!tokens) throw new Error('not connected to etsy')
  if (tokens.expires_at - Date.now() > 120_000) return tokens.access_token
  const refreshed = await refreshTokens(fetchFn, { keystring, refreshToken: tokens.refresh_token })
  await saveTokens(dir, refreshed)
  return refreshed.access_token
}
