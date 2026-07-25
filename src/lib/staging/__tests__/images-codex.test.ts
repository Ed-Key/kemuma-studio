import { access, readFile, rm, writeFile } from 'node:fs/promises'
import type { execFile } from 'node:child_process'
import path from 'node:path'
import sharp from 'sharp'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createCodexImageGenerator,
  defaultImageGenerator,
  NOTIONAL_IMAGE_COST_USD,
} from '@/lib/staging/images-codex'

type ExecCallback = (error: Error | null, stdout: string, stderr: string) => void

function fakeExecFile(
  writePassed: (cwd: string) => Promise<void>,
  capture: { file?: string; args?: readonly string[]; cwd?: string }
): typeof execFile {
  return vi.fn(
    (
      file: string,
      args: readonly string[],
      options: { cwd: string },
      callback: ExecCallback
    ) => {
      capture.file = file
      capture.args = args
      capture.cwd = options.cwd
      void (async () => {
        try {
          await writePassed(options.cwd)
          await sharp({
            create: {
              width: 300,
              height: 200,
              channels: 3,
              background: { r: 90, g: 120, b: 150 },
            },
          })
            .png()
            .toFile(path.join(options.cwd, 'out.png'))
          callback(null, '', '')
        } catch (error) {
          callback(error as Error, '', '')
        }
      })()
      return undefined as never
    }
  ) as unknown as typeof execFile
}

describe('createCodexImageGenerator', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('rejects an image when Codex reports a different prompt', async () => {
    const capture: { cwd?: string } = {}
    const execFileFn = fakeExecFile(
      async (cwd) => writeFile(path.join(cwd, 'passed.txt'), 'rewritten prompt\n'),
      capture
    )
    const generator = createCodexImageGenerator({ execFileFn })

    await expect(
      generator.generate({
        references: [Buffer.from('reference')],
        prompt: 'validated prompt\n',
        size: '1536x1024',
        n: 1,
      })
    ).rejects.toThrow(
      /prompt mismatch[\s\S]*--- staging-prompt\.txt[\s\S]*\+\+\+ passed\.txt[\s\S]*-validated prompt[\s\S]*\+rewritten prompt/i
    )
    // A rejected batch is the one case where the working directory is worth
    // more than the disk it costs, so it survives and the error names it.
    await expect(access(capture.cwd!)).resolves.toBeUndefined()
    await rm(capture.cwd!, { recursive: true, force: true })
  })

  it('accepts an exact prompt, resizes the PNG, and cleans its working directory', async () => {
    const capture: { file?: string; args?: readonly string[]; cwd?: string } = {}
    const execFileFn = fakeExecFile(
      async (cwd) => {
        const prompt = await readFile(path.join(cwd, 'staging-prompt.txt'))
        await writeFile(path.join(cwd, 'passed.txt'), prompt)
      },
      capture
    )
    const generator = createCodexImageGenerator({ execFileFn })

    const batch = await generator.generate({
      references: [Buffer.from('reference-a'), Buffer.from('reference-b')],
      prompt: 'validated prompt\nsecond line\n',
      size: '1024x1536',
      n: 1,
    })

    expect(batch.images).toHaveLength(1)
    // The subscription already paid for this image, so no money moved. We still
    // record what it would have cost on the API, per image, so staging keeps
    // showing up in the shop's cost picture.
    expect(batch.cost_usd).toBeCloseTo(NOTIONAL_IMAGE_COST_USD, 6)
    expect(await sharp(batch.images[0]).metadata()).toMatchObject({
      width: 1024,
      height: 1536,
      format: 'png',
    })
    expect(capture.file).toBe('codex')
    expect(capture.args?.slice(0, 7)).toEqual([
      'exec',
      '--enable',
      'image_generation',
      '-c',
      'model_reasoning_effort="high"',
      '--dangerously-bypass-approvals-and-sandbox',
      '--',
    ])
    const instruction = capture.args?.[7] ?? ''
    expect(instruction).toContain(path.join(capture.cwd!, 'reference-1.jpg'))
    expect(instruction).toContain(path.join(capture.cwd!, 'reference-2.jpg'))
    expect(instruction).toContain('EXACT, COMPLETE, UNMODIFIED')
    expect(instruction).toContain('not retry')
    await expect(access(capture.cwd!)).rejects.toThrow()
  })

  it('closes the child stdin so codex exec does not block on it', async () => {
    // Regression guard. Without this, `codex exec` waits on an stdin that
    // execFile never closes: it emits nothing and burns the full 20 minute
    // timeout, then reports a missing passed.txt rather than a hang. The
    // one-line fix looks removable, so pin it.
    const end = vi.fn()
    const execFileFn = vi.fn(
      (_file: string, _args: readonly string[], options: { cwd: string }, callback: ExecCallback) => {
        void (async () => {
          const prompt = await readFile(path.join(options.cwd, 'staging-prompt.txt'))
          await writeFile(path.join(options.cwd, 'passed.txt'), prompt)
          await sharp({ create: { width: 40, height: 40, channels: 3, background: { r: 1, g: 2, b: 3 } } })
            .png()
            .toFile(path.join(options.cwd, 'out.png'))
          callback(null, '', '')
        })()
        return { stdin: { end } } as never
      }
    ) as unknown as typeof execFile

    await createCodexImageGenerator({ execFileFn }).generate({
      references: [Buffer.from('reference')],
      prompt: 'validated prompt\n',
      size: '1536x1024',
      n: 1,
    })

    expect(end).toHaveBeenCalledTimes(1)
  })

  it('selects Codex only when IMAGE_PROVIDER is codex', () => {
    vi.stubEnv('IMAGE_PROVIDER', 'codex')
    expect(defaultImageGenerator().label).toBe('codex:image_generation')

    vi.stubEnv('IMAGE_PROVIDER', 'anything-else')
    expect(defaultImageGenerator().label).toMatch(/^gpt-image-2/)
  })
})
