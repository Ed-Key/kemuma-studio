# Kemuma Studio

Cataloging pipeline for [Kemuma Carvings](https://www.etsy.com/shop/KemumaCarvings), a
collection of vintage soapstone carvings hand-carved by my grandfather and grandmother in
Tabaka, Kisii, Kenya in the 1990s.

Photos of a piece go in. What comes back out: images prepared for Etsy (orientation fixed,
capped at 2000px, sRGB JPEG), drafted listing copy (title, description, 13 tags, materials,
a price with its reasoning), Etsy attributes
(category, colors, art style, dimensions), AI-staged scene images for marketing, a dimension
card drawn at true scale, and a draft listing on Etsy carrying all of it.

## One shop's tool

This runs one shop, daily, on its real inventory. It is not packaged for anyone else to
install. The judgment in it is specific to Kisii soapstone and lives in a handful of files:

- `src/lib/writer/prompt.ts`: the provenance facts, the voice rules, and the description
  structure every listing follows.
- `src/lib/writer/schema.ts`: the shape of a listing draft plus the Etsy title and tag rules
  checked before anyone sees it.
- `src/lib/staging/scenes.ts`: fourteen scene templates (rooms a buyer would use the piece
  in, and studio backdrops) with the lighting language that makes a generated scene stop
  looking composited.
- `src/lib/staging/prompt.ts`: assembles the six-section image prompt and validates the
  phrases that turned out to be load-bearing.
- `src/lib/staging/agent.ts`: the staging director's system prompt.
- `src/lib/etsy/taxonomy.ts` and `src/lib/etsy/attribute-vocab.ts`: which Etsy category and
  attribute vocabulary each design family maps to.

Pointing this at another shop means rewriting those. The catalog, the job runner, the review
screens, and the Etsy client underneath them are not shop-specific.

## What it does

**Catalog.** Designs, their pieces (colorway, dimensions, weight, quantity, status), and
photos, in SQLite with the camera originals kept immutable on disk. Intake takes a drop of
new photos and asks a vision model where the piece belongs, so a repeat comes back as a new
colorway or a quantity bump on an existing design instead of a duplicate listing.

**Write.** A model reads the photos and the measured record and returns the listing: title,
description in the fixed section structure, exactly 13 tags, materials, colors, price, and
the reasoning behind that price. The draft is schema-checked against Etsy's rules, then
lands on a review screen where every field is editable and nothing proceeds without
approval. The bakeoff screen puts drafts from several models side by side under blind
labels, which is how the default writer was picked.

**Stage.** Image generation produces marketing photographs and never redraws the sculpture:
the prompt locks the real piece's geometry and asks the model to relight it into the scene.
Candidates arrive in a grid to be approved to a destination (social, Pinterest, storefront,
shoot storyboard) or rejected with one of six reasons that each point at a different part of
the pipeline. Dimension cards are separate and deterministic: a `rembg` cutout composited by
`sharp` against the catalog's own measurements, no generated pixels. Approved scenes and
cards can be attached to a listing's gallery.

**Push.** An approved draft becomes an Etsy draft listing: create it, upload the images in
order, set the category attributes and dimensions, then set colorway variations and
per-colorway stock. Pushing a design that already has a listing id updates that listing
instead of making a second one. Publishing is manual in Etsy's own interface. Etsy requires
a person there, and this tool only ever writes drafts, which are invisible to buyers until
the owner publishes them by hand.

Anything slower than a beat runs as a job with a row in the database, so the page never
blocks and the rail shows what is running from anywhere in the app.

## Design notes

- [docs/superpowers/specs/2026-07-23-kemuma-studio-design.md](docs/superpowers/specs/2026-07-23-kemuma-studio-design.md):
  the system design, the pipeline stages, and the review gate.
- [docs/jobs-and-the-rail.md](docs/jobs-and-the-rail.md): why the slow operations became
  jobs, and the rules that keep the rail honest about them.
- [docs/judging-the-images.md](docs/judging-the-images.md): the six reject reasons and what
  each one indicts.
- [docs/what-the-prompt-cannot-fix.md](docs/what-the-prompt-cannot-fix.md): two images from a
  byte-identical prompt, one kept and one rejected, and what that rules out.
- [docs/reports/](docs/reports/): dated outcome reports, so a prompt change can be judged by
  a diff rather than by memory.

`docs/superpowers/plans/` holds the per-step build plans and `docs/superpowers/research/`
the landscape and image-model research behind them.

## Running it

Node 24.

```
npm install
cp .env.example .env.local
npm run dev
```

`.env.local` takes the Etsy keystring and shared secret, plus API keys for whichever models
you run: the writer defaults to Gemini, staging and intake use OpenAI models, and
`ANTHROPIC_API_KEY` covers the Claude paths. Connect the shop once from the home page, which
runs the OAuth handshake and stores the tokens under `data/`. Dimension cards shell out to
`rembg` through `uvx`, so they need `uv` on the machine.

The catalog is a SQLite file at `data/catalog.sqlite` and the images sit on disk beside it.
Neither is in the repo, so a fresh clone starts empty and builds its own.

## Working on it

```
npm test -- --run
npm run build
```

Outcomes are measured rather than assumed:

```
npx tsx scripts/outcome-report.ts
```

That writes a dated markdown file to `docs/reports/`, committed, so a change to
a prompt can be judged by diffing two reports rather than by remembering how
things felt before.

No separate lint step, because the build type-checks. Branch, commit and PR conventions are
in [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT. See [LICENSE](LICENSE).
