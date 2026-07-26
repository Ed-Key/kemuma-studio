import { execFile } from 'node:child_process'
import { copyFile, mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

/**
 * Write a captured clip somewhere it can actually be played back.
 *
 * An iPhone clip is H.264 inside a QuickTime container whose ftyp brand is
 * `qt  `. Chrome's demuxer rejects that brand whatever the Content-Type says,
 * so a clip filmed in the garage was unplayable on the desk even though the
 * bytes were fine and Etsy accepted them. Remuxing rewrites the container to
 * `isom` and moves the index to the front; the video stream is copied, not
 * re-encoded, so nothing is lost and a five second clip takes milliseconds.
 *
 * ffmpeg is not a hard dependency. Without it the original file is kept, which
 * is what the pipeline did before and still plays on the phone.
 */
export async function saveClip(srcPath: string, destWithoutExt: string): Promise<string> {
  await mkdir(path.dirname(destWithoutExt), { recursive: true })
  const mp4 = `${destWithoutExt}.mp4`
  try {
    await run('ffmpeg', ['-v', 'error', '-y', '-i', srcPath, '-c', 'copy', '-movflags', '+faststart', mp4])
    return mp4
  } catch {
    await rm(mp4, { force: true })
    const fallback = `${destWithoutExt}${path.extname(srcPath)}`
    await copyFile(srcPath, fallback)
    return fallback
  }
}
