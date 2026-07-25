import sharp from 'sharp'

// Fixed scale shared by every card so pieces render at true relative size.
// Set so the tallest piece in the catalog (the 8 inch Lovers Embrace) still
// clears the header. At the previous 160 anything 8 inches or over started
// above the subtitle baseline and the carving printed straight through
// "HAND-CARVED KISII SOAPSTONE". Raising this again means re-checking that.
export const PX_PER_IN = 146

const CANVAS = 2000
const GROUND = 1520
// Lowest y the product may start at. The subtitle sits on a 282 baseline in a
// 38px face, so this leaves room for descenders plus breathing space.
const HEADER_CLEAR = 348
const INK = '#3f3e3b'
const SOFT = '#97948e'

/** Where the product's top edge lands, and the scale used to get it there.
 *  Exported so the header-clearance rule can be tested as arithmetic rather
 *  than by eyeballing a rendered PNG. */
export function productLayout(heightIn: number): { scalePerIn: number; topY: number } {
  const scalePerIn = Math.min(PX_PER_IN, (GROUND - HEADER_CLEAR) / heightIn)
  return { scalePerIn, topY: GROUND - Math.round(heightIn * scalePerIn) }
}

export async function composeDimensionCard(input: {
  cutout: Buffer
  title: string
  heightIn: number
  widthIn: number
}): Promise<Buffer> {
  if (input.heightIn <= 0 || input.widthIn <= 0) {
    throw new Error('dimensions must be positive to render a card')
  }
  const meta = await sharp(input.cutout).metadata()
  // The shared scale is what makes two cards comparable, so it wins whenever it
  // fits. A piece taller than the catalog has ever held shrinks to clear the
  // header rather than printing through it; if this ever fires, lower
  // PX_PER_IN instead so the whole set stays at one honest scale.
  const { scalePerIn } = productLayout(input.heightIn)
  const targetH = Math.round(input.heightIn * scalePerIn)
  const scale = targetH / meta.height!
  const targetW = Math.round(meta.width! * scale)
  const product = await sharp(input.cutout).resize(targetW, targetH).png().toBuffer()
  const px = Math.round((CANVAS - targetW) / 2) + 60 // nudge right for arrow room
  const py = GROUND - targetH
  const cx = px + targetW / 2

  const cm = (n: number) => (n * 2.54).toFixed(1)
  const ax = px - 74
  const wy = GROUND + 118
  const svg = `
  <svg width='${CANVAS}' height='${CANVAS}' xmlns='http://www.w3.org/2000/svg'>
    <defs>
      <linearGradient id='bg' x1='0' y1='0' x2='0' y2='1'>
        <stop offset='0' stop-color='#f6f4f0'/>
        <stop offset='0.72' stop-color='#f2efe9'/>
        <stop offset='1' stop-color='#e7e3db'/>
      </linearGradient>
      <radialGradient id='shAmbient'>
        <stop offset='0' stop-color='#2a251f' stop-opacity='0.30'/>
        <stop offset='0.6' stop-color='#2a251f' stop-opacity='0.14'/>
        <stop offset='1' stop-color='#2a251f' stop-opacity='0'/>
      </radialGradient>
      <radialGradient id='shCore'>
        <stop offset='0' stop-color='#221d18' stop-opacity='0.36'/>
        <stop offset='1' stop-color='#221d18' stop-opacity='0'/>
      </radialGradient>
    </defs>
    <rect width='${CANVAS}' height='${CANVAS}' fill='url(#bg)'/>
    <ellipse cx='${cx}' cy='${GROUND + 8}' rx='${targetW * 0.72}' ry='36' fill='url(#shAmbient)'/>
    <ellipse cx='${cx}' cy='${GROUND + 4}' rx='${targetW * 0.48}' ry='18' fill='url(#shCore)'/>

    <line x1='${ax}' y1='${py}' x2='${ax}' y2='${GROUND}' stroke='${INK}' stroke-width='3.5'/>
    <line x1='${ax - 20}' y1='${py}' x2='${ax + 20}' y2='${py}' stroke='${INK}' stroke-width='3.5'/>
    <line x1='${ax - 20}' y1='${GROUND}' x2='${ax + 20}' y2='${GROUND}' stroke='${INK}' stroke-width='3.5'/>
    <path d='M ${ax} ${py + 2} l -10 22 l 20 0 z' fill='${INK}'/>
    <path d='M ${ax} ${GROUND - 2} l -10 -22 l 20 0 z' fill='${INK}'/>
    <text x='${ax - 38}' y='${(py + GROUND) / 2}' font-family='Helvetica, Arial, sans-serif' font-size='46' letter-spacing='1' fill='${INK}' text-anchor='middle' transform='rotate(-90 ${ax - 38} ${(py + GROUND) / 2})'>approx. ${input.heightIn} in · ${cm(input.heightIn)} cm</text>

    <line x1='${px}' y1='${wy}' x2='${px + targetW}' y2='${wy}' stroke='${INK}' stroke-width='3.5'/>
    <line x1='${px}' y1='${wy - 20}' x2='${px}' y2='${wy + 20}' stroke='${INK}' stroke-width='3.5'/>
    <line x1='${px + targetW}' y1='${wy - 20}' x2='${px + targetW}' y2='${wy + 20}' stroke='${INK}' stroke-width='3.5'/>
    <path d='M ${px + 2} ${wy} l 22 -10 l 0 20 z' fill='${INK}'/>
    <path d='M ${px + targetW - 2} ${wy} l -22 -10 l 0 20 z' fill='${INK}'/>
    <text x='${cx}' y='${wy + 74}' font-family='Helvetica, Arial, sans-serif' font-size='46' letter-spacing='1' fill='${INK}' text-anchor='middle'>approx. ${input.widthIn} in · ${cm(input.widthIn)} cm</text>

    <text x='1000' y='218' font-family='Georgia, serif' font-size='64' fill='${INK}' text-anchor='middle'>${input.title}</text>
    <text x='1000' y='282' font-family='Helvetica, Arial, sans-serif' font-size='38' letter-spacing='3' fill='${SOFT}' text-anchor='middle'>HAND-CARVED KISII SOAPSTONE</text>
  </svg>`

  return sharp(Buffer.from(svg))
    .composite([{ input: product, left: px, top: py }])
    .jpeg({ quality: 92 })
    .toBuffer()
}
