// One-off seed: KEMUMAS CARVINGS album (Aug 2023) -> catalog.
// Dims/weights are Claude's photo-based ESTIMATES (2026-07-23); Ed corrects
// before anything lists. Photo groups were assigned by eye from contact sheets.
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { getCatalogDb, dataDir } from '../src/lib/catalog/instance'
import { createDesign, addPiece, addPhoto, listDesigns } from '../src/lib/catalog/catalog'
import { photoDiskPath, savePhotoFile } from '../src/lib/catalog/photos-fs'

const JPEG_DIR = path.join(dataDir(), 'import', 'jpeg')
const ESTIMATE_NOTE = 'dims/weight ESTIMATED from photos; verify before listing'

interface SeedPiece {
  colorway: string
  h: number
  w: number
  d: number
  lb: number
  qty: number
  photos: number[] // IMG_<n> numbers
}

interface SeedDesign {
  name: string
  family: string
  notes?: string
  pieces: SeedPiece[]
}

const SEED: SeedDesign[] = [
  {
    name: 'Etched Coaster Set',
    family: 'coaster set',
    notes: 'holder + 6 round coasters, etched geometric patterns',
    pieces: [
      { colorway: 'blue', h: 3, w: 4.5, d: 4.5, lb: 3, qty: 1, photos: [9237, 9238, 9239, 9240, 9241, 9242, 9243, 9244] },
      { colorway: 'pink red', h: 3, w: 4.5, d: 4.5, lb: 3, qty: 1, photos: [9245, 9246, 9247, 9248, 9249, 9250, 9251, 9252, 9253, 9254] },
      { colorway: 'olive green', h: 3, w: 4.5, d: 4.5, lb: 3, qty: 1, photos: [9263, 9266, 9269, 9270, 9271, 9272, 9273] },
      { colorway: 'tan gold', h: 3, w: 4.5, d: 4.5, lb: 3, qty: 1, photos: [9277, 9278, 9279, 9280, 9281, 9284, 9285, 9286] },
      { colorway: 'magenta purple', h: 3, w: 4.5, d: 4.5, lb: 3, qty: 1, photos: [9298, 9302, 9304, 9306, 9307] },
    ],
  },
  {
    name: 'Safari Animals Etched Coaster Set',
    family: 'coaster set',
    notes: 'holder + 6 coasters, etched safari animals, dark maroon',
    pieces: [{ colorway: 'maroon', h: 3, w: 4.5, d: 4.5, lb: 3, qty: 1, photos: [9255, 9257, 9259, 9261, 9275, 9276] }],
  },
  {
    name: 'Painted Safari Sunset Coaster Set',
    family: 'coaster set',
    notes: 'holder + 6 coasters, hand-painted safari sunset scenes',
    pieces: [{ colorway: 'sunset', h: 3, w: 4.5, d: 4.5, lb: 3, qty: 1, photos: [9288, 9290, 9294] }],
  },
  {
    name: 'Canoe Trinket Dish',
    family: 'trinket dish',
    notes: 'leaf/canoe shape with handle',
    pieces: [
      { colorway: 'maroon', h: 1.5, w: 6, d: 3, lb: 0.6, qty: 1, photos: [9310, 9312, 9313, 9314] },
      { colorway: 'assorted (pink blue tan magenta)', h: 1.5, w: 6, d: 3, lb: 0.6, qty: 4, photos: [9315, 9319, 9321, 9323, 9324] },
    ],
  },
  {
    name: 'Painted Safari Jewelry Box',
    family: 'jewelry box',
    notes: 'rectangular lidded box, hand-painted safari sunset lid',
    pieces: [{ colorway: 'safari sunset', h: 1.5, w: 4, d: 3, lb: 1.2, qty: 5, photos: [9326, 9327, 9330, 9331, 9332, 9333, 9335] }],
  },
  {
    name: 'Painted Animal Trinket Bowl Set',
    family: 'bowl',
    notes: 'small round bowls with painted animals, photographed as stacks of ~6',
    pieces: [
      { colorway: 'assorted', h: 1, w: 3, d: 3, lb: 1.5, qty: 2, photos: [9338, 9341, 9342, 9343, 9347, 9348, 9349, 9350, 9351, 9352, 9407, 9411, 9412, 9414, 9415, 9416, 9418, 9419, 9420, 9421] },
    ],
  },
  {
    name: 'Painted Safari Heart Dish',
    family: 'heart dish',
    notes: 'heart-shaped dish, hand-painted safari animals on sunset bands',
    pieces: [
      { colorway: 'assorted sunset', h: 1, w: 4, d: 4, lb: 0.5, qty: 8, photos: [9354, 9355, 9357, 9358, 9360, 9361, 9362, 9364, 9365, 9366, 9367, 9368, 9370, 9373, 9374, 9375, 9376, 9377, 9378, 9379, 9380] },
    ],
  },
  {
    name: 'Etched Pattern Heart Dish',
    family: 'heart dish',
    notes: 'heart-shaped dish, etched patterns (zigzag, dots, tribal)',
    pieces: [
      { colorway: 'assorted (pink orange cream tan)', h: 1, w: 3.5, d: 3.5, lb: 0.4, qty: 4, photos: [9381, 9382, 9383, 9384, 9385, 9386, 9387, 9388, 9389, 9390, 9391, 9392] },
    ],
  },
  {
    name: 'Lovers Embrace Figure',
    family: 'figure',
    notes: 'abstract embracing couple, warm brown; cousin of the Eternity Love Knot',
    pieces: [
      { colorway: 'brown, tall', h: 8, w: 3, d: 2, lb: 1.5, qty: 1, photos: [9396, 9401, 9402, 9403, 9404, 9405] },
      { colorway: 'brown, small', h: 6, w: 2.5, d: 2, lb: 1, qty: 1, photos: [9406] },
    ],
  },
  {
    name: 'Lovers Candleholder',
    family: 'figure',
    notes: 'black embracing figures forming a holder; Ed to confirm what it is',
    pieces: [{ colorway: 'black', h: 4, w: 4, d: 4, lb: 2, qty: 1, photos: [9233, 9234, 9235, 9236] }],
  },
  {
    name: 'Sphere and Cradle Set',
    family: 'sculpture',
    notes: 'carved ball nesting in C-shaped cradle stand',
    pieces: [
      { colorway: 'natural', h: 3, w: 4, d: 3.5, lb: 2, qty: 1, photos: [9423, 9424, 9425, 9426, 9427, 9428] },
      { colorway: 'orange zigzag', h: 3, w: 4, d: 3.5, lb: 2, qty: 1, photos: [9432, 9433, 9434] },
      { colorway: 'pink wave', h: 3, w: 4, d: 3.5, lb: 2, qty: 1, photos: [9436, 9437, 9439, 9440] },
      { colorway: 'cream geometric', h: 3, w: 4, d: 3.5, lb: 2, qty: 1, photos: [9441, 9442, 9444] },
    ],
  },
]

async function main() {
  const db = getCatalogDb()
  if (listDesigns(db).length > 0) {
    throw new Error('catalog is not empty; refusing to seed on top of existing data')
  }
  let photosAttached = 0
  let photosMissing = 0
  for (const design of SEED) {
    const designId = createDesign(db, {
      family: design.family,
      name: design.name,
      notes: [design.notes, ESTIMATE_NOTE].filter(Boolean).join('; '),
    })
    for (const piece of design.pieces) {
      const pieceId = addPiece(db, {
        design_id: designId,
        colorway: piece.colorway,
        height_in: piece.h,
        width_in: piece.w,
        depth_in: piece.d,
        weight_lb: piece.lb,
        quantity: piece.qty,
        condition_notes: ESTIMATE_NOTE,
      })
      let position = 0
      for (const num of piece.photos) {
        const src = path.join(JPEG_DIR, `IMG_${num}.jpg`)
        if (!existsSync(src)) {
          photosMissing += 1
          console.warn(`missing: IMG_${num}.jpg`)
          continue
        }
        const dest = photoDiskPath(dataDir(), pieceId, position, `IMG_${num}.jpg`)
        await savePhotoFile(dest, await readFile(src))
        addPhoto(db, { piece_id: pieceId, file_path: dest, position })
        position += 1
        photosAttached += 1
      }
    }
    console.log(`seeded: ${design.name} (${design.pieces.length} pieces)`)
  }
  console.log(`done: ${SEED.length} designs, ${photosAttached} photos attached, ${photosMissing} missing`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
