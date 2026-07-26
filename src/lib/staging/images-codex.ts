import { execFile, type ExecFileException } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import {
  createOpenAIImageGenerator,
  type ImageGenerator,
  type ImagesUsage,
  type StagedImageInput,
} from './images-api'

// The slowest batch that ever finished took 466s for four images in parallel,
// so no single call has a reason to run past this. Cutting it short is cheap
// now that a timed-out attempt costs a retry rather than the batch.
const CODEX_TIMEOUT_MS = 10 * 60 * 1000

// Codex reports no token usage, so there is nothing to price with
// computeImageCostUsd. Zero would be literally true (the subscription already
// paid) but it would quietly erase staging from the shop's cost picture.
// Instead we record what the same image would have cost on the API, measured
// from the 36 images this studio generated through gpt-image-2 before the
// switch: mean $0.2126, range $0.1894 to $0.2419. Rows written by this
// generator carry the label "codex:image_generation" in staged_images.model,
// so notional spend stays separable from money that actually left the account.
export const NOTIONAL_IMAGE_COST_USD = 0.2126
const NO_TOKEN_USAGE: ImagesUsage = { input_tokens: 0, output_tokens: 0 }

function trimOneTrailingNewline(value: Buffer): Buffer {
  if (value.at(-1) !== 0x0a) return value
  return value.at(-2) === 0x0d ? value.subarray(0, value.length - 2) : value.subarray(0, value.length - 1)
}

function unifiedDiff(expected: Buffer, actual: Buffer): string {
  const before = expected.toString('utf8').split('\n')
  const after = actual.toString('utf8').split('\n')
  return [
    '--- staging-prompt.txt',
    '+++ passed.txt',
    `@@ -1,${before.length} +1,${after.length} @@`,
    ...before.map((line) => `-${line}`),
    ...after.map((line) => `+${line}`),
  ].join('\n')
}

function instructionFor(tmp: string, referencePaths: string[]): string {
  const promptPath = path.join(tmp, 'staging-prompt.txt')
  const passedPath = path.join(tmp, 'passed.txt')
  const outPath = path.join(tmp, 'out.png')
  return [
    `Read the validated staging prompt from ${promptPath}.`,
    'Call image_generation ONCE.',
    `Set referenced_image_paths to exactly these absolute paths: ${JSON.stringify(referencePaths)}.`,
    'Set prompt to the EXACT, COMPLETE, UNMODIFIED contents of staging-prompt.txt.',
    'The prompt is final and validated. Do NOT augment, rewrite, summarize, shorten, or reorder it.',
    `Write the exact string passed as the prompt parameter to ${passedPath}.`,
    `Copy the generated image to ${outPath}.`,
    'Be efficient and do not retry.',
  ].join(' ')
}

// Returns Codex's stdout. When Codex exits 0 but skips a step, its transcript
// is the only record of what it decided to do, so callers fold it into the
// error rather than discarding it.
function runCodex(
  execFileFn: typeof execFile,
  cwd: string,
  instruction: string
): Promise<string> {
  const args = [
    'exec',
    '--enable',
    'image_generation',
    '-c',
    'model_reasoning_effort="high"',
    '--dangerously-bypass-approvals-and-sandbox',
    '--',
    instruction,
  ]
  return new Promise((resolve, reject) => {
    // execFile leaves the child's stdin open. `codex exec` reads stdin looking
    // for a prompt even when one was passed positionally, so it blocks forever
    // and emits nothing until the timeout kills it, with no error to explain
    // why. Closing stdin is the whole difference between a hang and a run:
    // measured 90s-and-empty versus 9s-and-correct (2026-07-25).
    const child = execFileFn(
      'codex',
      args,
      { cwd, timeout: CODEX_TIMEOUT_MS, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (!error) {
          resolve(String(stdout))
          return
        }
        const commandError = error as ExecFileException
        if (commandError.killed || commandError.signal === 'SIGTERM' || commandError.code === 'ETIMEDOUT') {
          reject(new Error('Codex image generation timed out after 20 minutes'))
          return
        }
        const detail = String(stderr).trim()
        reject(new Error(`Codex image generation failed: ${detail || commandError.message}`))
      }
    )
    child?.stdin?.end()
  })
}

/* Codex disobeying the prompt and the network dropping are different kinds of
   failure and only one of them is worth trying again. A passed.txt mismatch
   means the validated prompt was not the one used, which is the boundary this
   provider exists to hold; retrying would launder it. A missing out.png is a
   network error or an overloaded upstream, and retrying is the whole point. */
class PromptFidelityError extends Error {}

const ATTEMPTS = 3
const BACKOFF_MS = 2000

async function attemptOne(
  execFileFn: typeof execFile,
  input: Omit<StagedImageInput, 'n'>,
  keepOnFailure: boolean
): Promise<Buffer> {
  const tmp = await mkdtemp(path.join(tmpdir(), 'kemuma-codex-image-'))
  let keepForDiagnosis = false
  try {
    const promptPath = path.join(tmp, 'staging-prompt.txt')
    await writeFile(promptPath, input.prompt)
    const referencePaths = input.references.map((_, index) => path.join(tmp, `reference-${index + 1}.jpg`))
    await Promise.all(referencePaths.map((file, index) => writeFile(file, input.references[index])))

    const transcript = await runCodex(execFileFn, tmp, instructionFor(tmp, referencePaths))

    // Every failure past this point is Codex doing something we cannot see from
    // its exit code, so keep the working directory and quote its transcript.
    const context = `\nCodex working directory kept for diagnosis: ${tmp}\nCodex transcript:\n${transcript.slice(-4000)}`

    const expected = trimOneTrailingNewline(await readFile(promptPath))
    let passed: Buffer
    try {
      passed = trimOneTrailingNewline(await readFile(path.join(tmp, 'passed.txt')))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      keepForDiagnosis = true
      throw new PromptFidelityError(
        `Codex prompt mismatch: passed.txt is missing\n${unifiedDiff(expected, Buffer.alloc(0))}${context}`
      )
    }
    if (!expected.equals(passed)) {
      keepForDiagnosis = true
      throw new PromptFidelityError(
        `Codex prompt mismatch: passed.txt differs\n${unifiedDiff(expected, passed)}${context}`
      )
    }

    const [width, height] = input.size.split('x').map(Number)
    try {
      return await sharp(await readFile(path.join(tmp, 'out.png')))
        .resize(width, height, { fit: 'cover', position: 'centre' })
        .png()
        .toBuffer()
    } catch (error) {
      // Only the attempt we are not going to repeat is worth keeping. A blip
      // that the next attempt recovers from leaves nothing behind.
      keepForDiagnosis = keepOnFailure
      throw new Error(`Codex produced no usable out.png: ${(error as Error).message}${context}`)
    }
  } finally {
    if (!keepForDiagnosis) await rm(tmp, { recursive: true, force: true })
  }
}

/**
 * One image, with the transient failures tried again.
 *
 * Roughly one staging batch in eight was dying on a network error with no
 * retry attempted, taking the other three images of the batch down with it.
 * Nothing was generated in those runs, so trying again costs a call and no
 * money, while giving up costs the whole batch.
 */
async function generateOne(
  execFileFn: typeof execFile,
  input: Omit<StagedImageInput, 'n'>,
  backoffMs: number
): Promise<Buffer> {
  let last: unknown
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      return await attemptOne(execFileFn, input, attempt === ATTEMPTS)
    } catch (error) {
      if (error instanceof PromptFidelityError) throw error
      last = error
      if (attempt < ATTEMPTS) await new Promise((r) => setTimeout(r, backoffMs * attempt))
    }
  }
  throw new Error(
    `Codex failed to produce an image after ${ATTEMPTS} attempts. Last error:\n${
      last instanceof Error ? last.message : String(last)
    }`
  )
}

/**
 * The image generator on the Codex CLI, billed through the owner's ChatGPT
 * subscription. The passed.txt check makes prompt fidelity a hard boundary:
 * no image leaves this provider unless Codex used the validated prompt.
 */
export function createCodexImageGenerator(opts?: {
  execFileFn?: typeof execFile
  backoffMs?: number
}): ImageGenerator {
  const execFileFn = opts?.execFileFn ?? execFile
  const backoffMs = opts?.backoffMs ?? BACKOFF_MS
  return {
    label: 'codex:image_generation',
    async generate(input) {
      if (input.references.length === 0) throw new Error('staging needs at least one reference image')
      const images = await Promise.all(
        Array.from({ length: input.n }, () =>
          generateOne(
            execFileFn,
            { references: input.references, prompt: input.prompt, size: input.size },
            backoffMs
          )
        )
      )
      return {
        images,
        usage: NO_TOKEN_USAGE,
        cost_usd: NOTIONAL_IMAGE_COST_USD * images.length,
      }
    },
  }
}

/**
 * The studio's image generator. Defaults to the OpenAI API. Set
 * IMAGE_PROVIDER to "codex" to use the ChatGPT subscription instead.
 */
export function defaultImageGenerator(): ImageGenerator {
  return process.env.IMAGE_PROVIDER === 'codex'
    ? createCodexImageGenerator()
    : createOpenAIImageGenerator()
}
