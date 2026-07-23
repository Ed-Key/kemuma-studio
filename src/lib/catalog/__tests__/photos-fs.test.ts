import { describe, it, expect } from 'vitest'
import { mkdtempSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { photoDiskPath, savePhotoFile } from '@/lib/catalog/photos-fs'

describe('photoDiskPath', () => {
  it('builds a per-piece path with a lowercased extension', () => {
    expect(photoDiskPath('/data', 7, 0, 'IMG_1234.JPG')).toBe(path.join('/data', 'photos', '7', '0.jpg'))
    expect(photoDiskPath('/data', 7, 2, 'shot.heic')).toBe(path.join('/data', 'photos', '7', '2.heic'))
  })

  it('rejects unsupported extensions', () => {
    expect(() => photoDiskPath('/data', 7, 0, 'malware.exe')).toThrow('unsupported photo type')
  })
})

describe('savePhotoFile', () => {
  it('writes once and refuses to overwrite', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'kemuma-photos-'))
    const file = path.join(dir, 'photos', '1', '0.jpg')
    await savePhotoFile(file, Buffer.from('abc'))
    expect(existsSync(file)).toBe(true)
    await expect(savePhotoFile(file, Buffer.from('xyz'))).rejects.toThrow()
  })
})
