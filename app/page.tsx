import Link from 'next/link'

export default function Home() {
  return (
    <div>
      <div className="page-head">
        <h1>Kemuma Studio</h1>
        <p className="eyebrow">Catalog vintage Kisii soapstone and push listings to Etsy.</p>
      </div>

      <div className="stat-row">
        <Link href="/designs" className="card">
          <div className="card-title">Catalog</div>
          <p className="muted">Browse designs, add pieces, write and approve listings.</p>
        </Link>
        <Link href="/intake" className="card">
          <div className="card-title">Intake</div>
          <p className="muted">Drop photos of a new piece and let the matcher place it.</p>
        </Link>
        <a className="card" href="/api/etsy/connect">
          <div className="card-title">Connect to Etsy</div>
          <p className="muted">Authorize the shop so drafts can be pushed.</p>
        </a>
      </div>
    </div>
  )
}
