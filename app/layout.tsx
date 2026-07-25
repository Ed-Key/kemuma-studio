import './globals.css'
import { Fraunces, Instrument_Sans, JetBrains_Mono, Noto_Serif_Display } from 'next/font/google'
import Sidebar from './components/Sidebar'
import { getCatalogDb } from '@/lib/catalog/instance'
import { listDesigns } from '@/lib/catalog/catalog'
import { listPendingIntakes } from '@/lib/catalog/intakes'
import { listApprovedImages } from '@/lib/catalog/staged'

/** What each nav row is a way in to: designs catalogued, intakes still waiting
 *  on a decision, and images approved for marketing. */
function navCounts(): { '/designs': number; '/intake': number; '/marketing': number } {
  const db = getCatalogDb()
  return {
    '/designs': listDesigns(db).length,
    '/intake': listPendingIntakes(db).length,
    '/marketing': listApprovedImages(db).length,
  }
}

const fraunces = Fraunces({
  variable: '--font-fraunces',
  display: 'swap',
  subsets: ['latin'],
  weight: 'variable',
})

const instrumentSans = Instrument_Sans({
  variable: '--font-instrument',
  display: 'swap',
  subsets: ['latin'],
  weight: 'variable',
})

const jetBrainsMono = JetBrains_Mono({
  variable: '--font-jetbrains',
  display: 'swap',
  subsets: ['latin'],
  weight: 'variable',
})

/* The Didone for hero numerals. --font-numeral names Didot first, which macOS
   supplies locally and which cannot be bundled, so this is the cut everyone
   else gets. Only the two light weights are loaded because the face is used at
   large sizes and nowhere else. */
const notoSerifDisplay = Noto_Serif_Display({
  variable: '--font-noto-serif-display',
  display: 'swap',
  subsets: ['latin'],
  weight: ['300', '400'],
})

export const metadata = { title: 'Kemuma Studio' }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${fraunces.variable} ${instrumentSans.variable} ${jetBrainsMono.variable} ${notoSerifDisplay.variable}`}
    >
      <body>
        <div className="app-shell">
          {/* Counted here rather than in Sidebar because the rail is a client
              component (it owns the collapse timers) and cannot reach the db.
              The layout is a server component, so the numbers are read once per
              render and handed down as props. */}
          <Sidebar counts={navCounts()} />
          <main className="content">{children}</main>
        </div>
      </body>
    </html>
  )
}
