// Scene template library for AI staging. Each family stages in rooms where a
// buyer would actually use the piece; every template shares one house style
// (warm window light, soft neutrals) so the output reads as one photographer.
// The lighting sections carry the integration language validated 2026-07-24
// (relight-to-scene, directional contact shadows) that killed the
// copy-pasted composite look. Texts are taste-locked; edit only with Ed.

export type StagingSize = '1536x1024' | '1024x1536'

export interface SceneTemplate {
  key: string
  label: string
  families: string[]
  size: StagingSize
  scene: string
  lighting: string
}

export const FAMILIES = [
  'coaster set', 'trinket dish', 'jewelry box', 'bowl', 'heart dish', 'figure', 'sculpture',
]

export const SCENES: SceneTemplate[] = [
  {
    key: 'coffee-table',
    label: 'Living room coffee table',
    families: ['coaster set', 'trinket dish'],
    size: '1536x1024',
    scene:
      'Photorealistic editorial product photograph in a warm minimalist living room. The product rests on a light-oak coffee table with a softly blurred cream linen sofa and an ivory plaster wall behind it. One small cream ceramic mug sits apart from the product as the only prop.',
    lighting:
      "The product must look photographed inside this scene, never composited. Relight it fully to the scene's illumination: warm late-afternoon window light from camera left wraps its surfaces with soft highlights and gently shaded far sides, matching color temperature throughout. Ground it with directionally consistent contact shadows on the table and a faint warm bounce from the oak onto its lower edges. Polished stone picks up one soft window reflection.",
  },
  {
    key: 'bar-cart',
    label: 'Evening bar cart',
    families: ['coaster set'],
    size: '1536x1024',
    scene:
      'Photorealistic editorial product photograph on a dark walnut bar cart against a deep olive-green wall, quiet evening-host mood. One amber glass tumbler and a folded natural-linen napkin sit apart from the product as the only props.',
    lighting:
      "The product must look photographed inside this scene, never composited. Relight it fully to the scene's illumination: warm low lamplight from camera right gives its surfaces soft amber highlights and deeper shading on the far side, matching color temperature. Ground it with directionally consistent contact shadows on the walnut and a subtle warm bounce from the wood onto its lower edges. Polished stone catches one soft lamp reflection.",
  },
  {
    key: 'dining-table',
    label: 'Oak dining table',
    families: ['coaster set', 'bowl'],
    size: '1536x1024',
    scene:
      'Photorealistic editorial product photograph on a solid oak dining table with a rumpled natural-linen runner, a bright airy dining room softly blurred behind it. One small stoneware cup sits well apart from the product as the only prop.',
    lighting:
      "The product must look photographed inside this scene, never composited. Relight it fully to the scene's illumination: broad diffused daylight from a tall window at camera left, soft neutral fill, matching color temperature. Ground it with directionally consistent contact shadows on the table and a faint warm bounce from the oak onto its lower edges. Polished stone shows one restrained window reflection.",
  },
  {
    key: 'entry-console',
    label: 'Entryway console',
    families: ['trinket dish', 'bowl', 'heart dish'],
    size: '1536x1024',
    scene:
      'Photorealistic editorial product photograph on a pale travertine entryway console against a warm ivory wall. A matte off-white vase holding a few dried grass stems stands to one side, clearly apart from the product; calm welcome-home mood.',
    lighting:
      "The product must look photographed inside this scene, never composited. Relight it fully to the scene's illumination: soft warm daylight raking from camera right across the travertine, gentle neutral fill, matching color temperature. Ground it with directionally consistent contact shadows on the stone surface and a faint warm bounce onto its base. Polished stone carries one quiet highlight from the doorway light.",
  },
  {
    key: 'dresser-morning',
    label: 'Dresser in morning light',
    families: ['jewelry box', 'heart dish'],
    size: '1536x1024',
    scene:
      'Photorealistic editorial product photograph on a light ash-wood dresser in a serene bedroom, the edge of a round mirror and a soft ivory wall blurred behind it. One small folded linen cloth sits apart from the product as the only prop.',
    lighting:
      "The product must look photographed inside this scene, never composited. Relight it fully to the scene's illumination: cool-leaning morning light through a sheer curtain at camera left, softened with warm neutral fill, matching color temperature. Ground it with directionally consistent contact shadows on the ash surface and a faint bounce from the pale wood onto its lower edges. Polished stone holds one soft diffused window reflection.",
  },
  {
    key: 'nightstand',
    label: 'Warm nightstand',
    families: ['jewelry box', 'trinket dish'],
    size: '1024x1536',
    scene:
      'Photorealistic editorial product photograph on a small warm walnut nightstand beside a bed with rumpled ivory linen bedding softly blurred behind it. A short stack of two linen-bound books sits apart from the product as the only prop.',
    lighting:
      "The product must look photographed inside this scene, never composited. Relight it fully to the scene's illumination: intimate warm lamplight from above camera right, soft falloff into the room, matching color temperature. Ground it with directionally consistent contact shadows on the walnut and a subtle warm bounce from the wood onto its base. Polished stone catches one small lamp highlight.",
  },
  {
    key: 'bookshelf',
    label: 'Oak bookshelf',
    families: ['figure', 'sculpture'],
    size: '1024x1536',
    scene:
      'Photorealistic editorial product photograph on a warm oak floating bookshelf against a soft ivory plaster wall, a few linen-bound books with muted spines blurred at the left edge, quiet reading-nook mood.',
    lighting:
      "The product must look photographed inside this scene, never composited. Relight it fully to the scene's illumination: soft warm window light from camera right wraps its carved forms with gentle highlights and shaded far surfaces, matching color temperature. Ground it with an accurate directional contact shadow on the shelf and a faint warm bounce from the oak onto its base. Polished stone catches one soft window reflection along its curves.",
  },
  {
    key: 'reading-nook',
    label: 'Reading nook side table',
    families: ['figure', 'sculpture'],
    size: '1024x1536',
    scene:
      'Photorealistic editorial product photograph on a pale travertine side table beside the arm of a natural-linen armchair in a calm reading nook, warm ivory wall behind. One closed linen-bound book lies apart from the product as the only prop.',
    lighting:
      "The product must look photographed inside this scene, never composited. Relight it fully to the scene's illumination: broad soft window light from camera left with gentle neutral fill, matching color temperature across its carved surfaces. Ground it with directionally consistent contact shadows on the travertine and a faint warm bounce onto its base. Polished stone shows one understated window reflection.",
  },
  {
    key: 'windowsill',
    label: 'Deep windowsill',
    families: ['heart dish', 'figure'],
    size: '1024x1536',
    scene:
      'Photorealistic editorial product photograph on a deep white-painted windowsill with a sheer curtain drawn to one side and an out-of-focus green garden beyond the glass, quiet morning mood with no other props.',
    lighting:
      "The product must look photographed inside this scene, never composited. Relight it fully to the scene's illumination: bright diffused backlight from the window softened by the sheer curtain, with the camera-facing surfaces lifted by gentle neutral fill, matching color temperature. Ground it with directionally consistent contact shadows on the sill and a soft cool bounce from the white paint onto its base. Polished stone glows subtly at its rim edges against the light.",
  },
]

export function getScene(key: string): SceneTemplate {
  const scene = SCENES.find((s) => s.key === key)
  if (!scene) throw new Error(`unknown scene "${key}"`)
  return scene
}

export function scenesForFamily(family: string): SceneTemplate[] {
  const scenes = SCENES.filter((s) => s.families.includes(family))
  if (scenes.length === 0) throw new Error(`no scenes for family "${family}"`)
  return scenes
}

// Least-used-first rotation so repeated staging of one design varies its
// rooms instead of reprinting the same background.
export function pickScene(family: string, usage: Record<string, number>): SceneTemplate {
  const scenes = scenesForFamily(family)
  return scenes.reduce((best, s) => ((usage[s.key] ?? 0) < (usage[best.key] ?? 0) ? s : best), scenes[0])
}
