import { exchangeCode, loadPending, saveTokens } from '@/lib/etsy/tokens'
import { etsyConfig } from '@/lib/etsy/config'

export async function GET(req: Request) {
  const cfg = etsyConfig()
  const params = new URL(req.url).searchParams
  const code = params.get('code')
  const state = params.get('state')
  const pending = await loadPending(cfg.dataDir)

  if (!code || !state || !pending || pending.state !== state) {
    return new Response('oauth state mismatch or missing code; restart at /api/etsy/connect', { status: 400 })
  }

  const tokens = await exchangeCode(fetch, {
    keystring: cfg.keystring,
    redirectUri: cfg.redirectUri,
    code,
    verifier: pending.verifier,
  })
  await saveTokens(cfg.dataDir, tokens)
  return new Response('Connected to Etsy. You can close this tab and run: npm run handshake')
}
