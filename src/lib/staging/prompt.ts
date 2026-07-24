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
  'No text, labels, logos, or packaging.',
  'No hands or people.',
]

export function assembleStagingPrompt(scene: SceneTemplate, direction: ArtDirection): string {
  const exclusions = [...direction.extra_exclusions, ...BASE_EXCLUSIONS].join(' ')
  return [
    `SCENE - ${scene.scene}`,
    `SUBJECT AND COUNT - ${direction.subject_and_count}`,
    `COMPOSITION - ${direction.composition}`,
    `LIGHTING AND INTEGRATION - ${scene.lighting}`,
    `PRODUCT LOCK - ${direction.product_lock}`,
    `EXCLUSIONS - ${exclusions}`,
  ].join('\n\n')
}

// Guards the empirically load-bearing phrases: exact counts stopped the
// duplication hallucinations, the relight language stopped the composite
// look, and the lock sentences hold artwork fidelity near its ceiling.
export function validateStagingPrompt(prompt: string): string[] {
  const errors: string[] = []
  if (!/\bexactly\b/i.test(prompt)) {
    errors.push('SUBJECT AND COUNT must state exact piece counts using the word "exactly"')
  }
  if (!prompt.includes('never composited')) {
    errors.push('LIGHTING AND INTEGRATION must keep the "never composited" instruction')
  }
  if (!/relight/i.test(prompt)) {
    errors.push('LIGHTING AND INTEGRATION must tell the model to relight the product to the scene')
  }
  if (!prompt.includes('Use the exact physical product from Image 1.')) {
    errors.push('PRODUCT LOCK must open with "Use the exact physical product from Image 1."')
  }
  if (!prompt.includes('Do not restyle, redraw, smooth, or symmetrize.')) {
    errors.push('PRODUCT LOCK must end with the mandatory lock sentence')
  }
  if (!prompt.includes('No duplicate product')) {
    errors.push('EXCLUSIONS must keep the duplicate-product ban')
  }
  return errors
}
