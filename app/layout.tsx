import './globals.css'
import Sidebar from './components/Sidebar'

export const metadata = { title: 'Kemuma Studio' }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="app-shell">
          <Sidebar />
          <main className="content">{children}</main>
        </div>
      </body>
    </html>
  )
}
