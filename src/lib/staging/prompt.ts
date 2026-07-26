import type { SceneTemplate } from './scenes'

// The art director writes the product-specific sections; scenes.ts owns the
// environment and light. Assembly enforces the validated six-section order.
export interface ArtDirection {
  subject_and_count: string
  composition: string
  product_lock: string
  extra_exclusions: string[]
}

export const BASE_EXCLUSIONS = [
  'No duplicate product and no extra matching pieces.',
  'No other soapstone or carved stone objects.',
  'No readable text anywhere in the image, including book spines, labels, logos, or packaging.',
  'No hands or people.',
]

/* The sentences that hold artwork fidelity. They are fixed text, so the model
   was being asked to reproduce them verbatim and rejected when it did not:
   six real director turns spent 5, 9, 13, 11, 9 and 8 plan attempts mostly on
   retyping these. BASE_EXCLUSIONS was always injected here and its rule never
   once failed, which is the argument for treating the rest the same way. */
export const LIGHTING_LOCK =
  "The product must look photographed inside this scene, never composited. Relight it fully to the scene's illumination:"
export const PRODUCT_LOCK_OPEN = 'Use the exact physical product from Image 1.'
export const PRODUCT_LOCK_CLOSE = 'Do not restyle, redraw, smooth, or symmetrize.'

/** Idempotent: strips any copy the model wrote itself, then states it once. */
function withLightingLock(lighting: string): string {
  const own = lighting.replace(LIGHTING_LOCK, '').trim()
  return own ? `${LIGHTING_LOCK} ${own}` : LIGHTING_LOCK
}

function withProductLock(lock: string): string {
  const own = lock.replace(PRODUCT_LOCK_OPEN, '').replace(PRODUCT_LOCK_CLOSE, '').trim()
  return [PRODUCT_LOCK_OPEN, own, PRODUCT_LOCK_CLOSE].filter(Boolean).join(' ')
}

export function assembleStagingPrompt(scene: SceneTemplate, direction: ArtDirection): string {
  const exclusions = [...direction.extra_exclusions, ...BASE_EXCLUSIONS].join(' ')
  return [
    `SCENE - ${scene.scene}`,
    `SUBJECT AND COUNT - ${direction.subject_and_count}`,
    `COMPOSITION - ${direction.composition}`,
    `LIGHTING AND INTEGRATION - ${withLightingLock(scene.lighting)}`,
    `PRODUCT LOCK - ${withProductLock(direction.product_lock)}`,
    `EXCLUSIONS - ${exclusions}`,
  ].join('\n\n')
}

// Guards the empirically load-bearing phrases: exact counts stopped the
// duplication hallucinations, the relight language stopped the composite
// look, and the lock sentences hold artwork fidelity near its ceiling.
export function validateStagingPrompt(prompt: string): string[] {
  const errors: string[] = []
  // The only rule the writer can still fail. It is a claim about content the
  // model invents (the real piece count), so the assembler cannot supply it
  // without making the check vacuous.
  if (!/\bexactly\b/i.test(prompt)) {
    errors.push('SUBJECT AND COUNT must state exact piece counts using the word "exactly"')
  }
  // Assertions on the assembler, not demands on the model. They cannot fail
  // unless the injection above regresses, which is what they are here to catch.
  if (!prompt.includes('never composited')) {
    errors.push('LIGHTING AND INTEGRATION must keep the "never composited" instruction')
  }
  if (!/relight/i.test(prompt)) {
    errors.push('LIGHTING AND INTEGRATION must tell the model to relight the product to the scene')
  }
  if (!prompt.includes(PRODUCT_LOCK_OPEN)) {
    errors.push(`PRODUCT LOCK must open with "${PRODUCT_LOCK_OPEN}"`)
  }
  if (!prompt.includes(PRODUCT_LOCK_CLOSE)) {
    errors.push('PRODUCT LOCK must end with the mandatory lock sentence')
  }
  if (!prompt.includes('No duplicate product')) {
    errors.push('EXCLUSIONS must keep the duplicate-product ban')
  }
  return errors
}
