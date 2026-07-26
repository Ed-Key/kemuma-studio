import { open, stat } from 'node:fs/promises'
import path from 'node:path'
import { getCatalogDb } from '@/lib/catalog/instance'

/* iPhone clips arrive as .mov holding H.264 in ISO base media format, which is
   the same container MP4 uses. Chrome refuses to decode anything labelled
   video/quicktime, so the honest label for these bytes is also the one that
   plays. */
const TYPES: Record<string, string> = {
  '.mov': 'video/mp4',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.webm': 'video/webm',
}

/**
 * Safari will not play a clip served as a single 200. It asks for bytes and
 * expects 206 with a Content-Range, and the phone is where these are shot and
 * reviewed, so partial responses are the whole feature rather than a nicety.
 */
export async function GET(req: Request, { params }: { params: Promise<{ videoId: string }> }) {
  const { videoId } = await params
  const row = getCatalogDb()
    .prepare('SELECT file_path FROM videos WHERE video_id = ?')
    .get(Number(videoId)) as { file_path: string } | undefined
  if (!row) return new Response('not found', { status: 404 })

  const type = TYPES[path.extname(row.file_path).toLowerCase()] ?? 'application/octet-stream'
  let size: number
  try {
    size = (await stat(row.file_path)).size
  } catch {
    return new Response('file missing', { status: 404 })
  }

  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get('range') ?? '')
  const start = range && range[1] ? Number(range[1]) : 0
  const end = range && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1
  if (start >= size || end < start) {
    return new Response('bad range', { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
  }

  const handle = await open(row.file_path, 'r')
  const buffer = Buffer.alloc(end - start + 1)
  await handle.read(buffer, 0, buffer.length, start)
  await handle.close()

  return new Response(new Uint8Array(buffer), {
    status: range ? 206 : 200,
    headers: {
      'Content-Type': type,
      'Content-Length': String(buffer.length),
      'Accept-Ranges': 'bytes',
      ...(range ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}),
    },
  })
}
