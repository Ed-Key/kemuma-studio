import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const ALLOWED = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic'])

export function photoDiskPath(dataDir: string, pieceId: number, position: number, originalName: string): string {
  const ext = path.extname(originalName).toLowerCase()
  if (!ALLOWED.has(ext)) throw new Error('unsupported photo type')
  return path.join(dataDir, 'photos', String(pieceId), `${position}${ext}`)
}

export async function savePhotoFile(diskPath: string, bytes: Buffer): Promise<void> {
  await mkdir(path.dirname(diskPath), { recursive: true })
  await writeFile(diskPath, bytes, { flag: 'wx' }) // wx: fail if exists; originals are immutable
}
