import { describe, it, expect, vi } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  exchangeCode, refreshTokens, saveTokens, loadTokens, getValidAccessToken,
} from '@/lib/etsy/tokens'

const tokenResponse = (access: string) => ({
  ok: true,
  status: 200,
  json: async () => ({ access_token: access, refresh_token: 'rt1', expires_in: 3600 }),
}) as unknown as Response

describe('exchangeCode', () => {
  it('posts a form-encoded authorization_code grant', async () => {
    const fetchFn = vi.fn(async () => tokenResponse('at1'))
    const tokens = await exchangeCode(fetchFn as unknown as typeof fetch, {
      keystring: 'k123', redirectUri: 'http://localhost:3000/api/etsy/callback', code: 'c0de', verifier: 'v3rf',
    })
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.etsy.com/v3/public/oauth/token')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/x-www-form-urlencoded')
    const body = new URLSearchParams(init.body as string)
    expect(body.get('grant_type')).toBe('authorization_code')
    expect(body.get('client_id')).toBe('k123')
    expect(body.get('redirect_uri')).toBe('http://localhost:3000/api/etsy/callback')
    expect(body.get('code')).toBe('c0de')
    expect(body.get('code_verifier')).toBe('v3rf')
    expect(tokens.access_token).toBe('at1')
    expect(tokens.refresh_token).toBe('rt1')
    expect(tokens.expires_at).toBeGreaterThan(Date.now())
  })

  it('throws with etsy error text on failure', async () => {
    const fetchFn = vi.fn(async () => ({
      ok: false, status: 400, text: async () => '{"error":"invalid_grant"}',
    }) as unknown as Response)
    await expect(
      exchangeCode(fetchFn as unknown as typeof fetch, {
        keystring: 'k', redirectUri: 'r', code: 'c', verifier: 'v',
      })
    ).rejects.toThrow(/400.*invalid_grant/s)
  })
})

describe('refreshTokens', () => {
  it('posts a refresh_token grant', async () => {
    const fetchFn = vi.fn(async () => tokenResponse('at2'))
    const tokens = await refreshTokens(fetchFn as unknown as typeof fetch, { keystring: 'k123', refreshToken: 'rt0' })
    const [, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit]
    const body = new URLSearchParams(init.body as string)
    expect(body.get('grant_type')).toBe('refresh_token')
    expect(body.get('refresh_token')).toBe('rt0')
    expect(tokens.access_token).toBe('at2')
  })
})

describe('store + getValidAccessToken', () => {
  it('round-trips tokens through the file store', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'kemuma-'))
    const t = { access_token: 'a', refresh_token: 'r', expires_at: Date.now() + 3600_000 }
    await saveTokens(dir, t)
    expect(await loadTokens(dir)).toEqual(t)
  })

  it('returns the stored token when fresh, without calling fetch', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'kemuma-'))
    await saveTokens(dir, { access_token: 'fresh', refresh_token: 'r', expires_at: Date.now() + 3600_000 })
    const fetchFn = vi.fn()
    expect(await getValidAccessToken(fetchFn as unknown as typeof fetch, dir, 'k')).toBe('fresh')
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('refreshes and persists when the token is near expiry', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'kemuma-'))
    await saveTokens(dir, { access_token: 'old', refresh_token: 'r', expires_at: Date.now() + 30_000 })
    const fetchFn = vi.fn(async () => tokenResponse('new'))
    expect(await getValidAccessToken(fetchFn as unknown as typeof fetch, dir, 'k')).toBe('new')
    expect((await loadTokens(dir))!.access_token).toBe('new')
  })

  it('throws when never connected', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'kemuma-'))
    await expect(getValidAccessToken(fetch, dir, 'k')).rejects.toThrow('not connected to etsy')
  })
})
