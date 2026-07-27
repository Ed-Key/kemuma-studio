# Architecture

How the pieces fit and why they are shaped that way. For the reasoning behind
individual decisions, see [jobs-and-the-rail.md](jobs-and-the-rail.md),
[judging-the-images.md](judging-the-images.md) and
[what-the-prompt-cannot-fix.md](what-the-prompt-cannot-fix.md).

## Local-first, on purpose

Everything lives on one machine: a Next.js app, a SQLite file at
`data/catalog.sqlite`, and the images on disk beside it. There is no server to
deploy, no account system, and no upload step. The only traffic that leaves the
machine is model API calls and Etsy.

That is a deliberate constraint rather than an unfinished state. The tool runs
one shop with one operator, so multi-tenancy, auth and hosting would be pure
cost. It also means the camera originals never leave the owner's disk, and the
catalog can be backed up by copying a file.

## The spine

```
photograph  ->  intake  ->  design + pieces  ->  draft  ->  Etsy listing
                              |                              ^
                              +-> staged scenes -> approved --+
                              +-> dimension card -> approved -+
```

**Designs and pieces.** A design is a thing the shop sells. A piece is one
physical object of that design, carrying its own colorway, dimensions, weight,
quantity and status. One design with three colorways is one listing with three
variations, which is exactly how Etsy models it. Photos hang off pieces, and the
camera originals are immutable: every derived image is written beside them
rather than over them.

**Intake.** New photos arrive either from a drop on the desktop or from a phone
at `/capture`. A vision model proposes where the piece belongs, and anything
below high confidence abstains rather than guessing. A repeat therefore comes
back as a new colorway or a quantity bump on an existing design instead of a
duplicate listing. The proposal and what the owner actually chose are both
stored, which makes the matcher's accuracy measurable after the fact.

**Drafts.** A model reads the photos and the measured record and returns a
listing: title, description in a fixed section structure, exactly 13 tags,
materials, colors, a price and the reasoning behind that price. The draft is
schema-checked against Etsy's rules before anyone sees it. Both the generated
draft and the approved final are kept, so the difference between them is a
record of where the model was wrong.

**Staging.** Image generation produces marketing photographs. The prompt locks
the real piece's geometry and asks the model to relight it into a scene rather
than redraw it. Candidates land in a review grid and are approved to a
destination or rejected with one of six reasons, each of which points at a
different part of the pipeline.

**Dimension cards** are the exception: no generated pixels at all. A `rembg`
cutout is composited by `sharp` against the catalog's own measurements. A buyer
asking how big something is deserves an answer the tool cannot hallucinate.

**Push.** An approved draft becomes an Etsy draft listing: create, upload images
in order, set category attributes and dimensions, then set colorway variations
and per-colorway stock. Pushing a design that already has a listing id updates
that listing rather than making a second one. Publishing stays manual in Etsy's
own interface.

## Jobs, because the work is slow

Image generation takes minutes. Nothing that slow can happen inside a request,
so anything slower than a beat becomes a row in a `jobs` table with a status, a
heartbeat and a cost. The page never blocks and a rail shows what is running
from anywhere in the app.

Two failure modes are distinguished, because they need opposite responses. A job
whose executor has died is **interrupted** and retryable, which is what a dev
server restart produces. A job that is alive but has outlived any legitimate
runtime is **stuck** and gets cancelled. Confusing the two either kills real work
or leaves dead rows running forever.

Job operations are named and dispatched from one place, so a run can be repeated
from its row alone without the UI that started it. Narration is stored per step
in `job_logs`, which is what the rail reads and what makes a run replayable.

## Where the judgment lives

The tool is not shop-agnostic and does not pretend to be. Six files hold
everything specific to Kisii soapstone:

| file | what it decides |
|---|---|
| `src/lib/writer/prompt.ts` | provenance facts, voice rules, description structure |
| `src/lib/writer/schema.ts` | draft shape plus the Etsy title and tag rules |
| `src/lib/staging/scenes.ts` | scene templates and their lighting language |
| `src/lib/staging/prompt.ts` | the six-section image prompt and its validator |
| `src/lib/staging/agent.ts` | the staging director's system prompt |
| `src/lib/etsy/taxonomy.ts`, `attribute-vocab.ts` | category and attribute mapping |

Everything underneath them, the catalog, the job runner, the review screens and
the Etsy client, is not shop-specific.

## Models are swappable, and chosen by measurement

No model is hardcoded into the pipeline. Writer, matcher, art director and
staging agent each read a model spec from the environment, and providers sit
behind one interface so a provider can be changed without touching a caller.

Which model to use was decided by running them, not by reading benchmarks. The
bakeoff screen puts drafts from several models side by side under blind labels.
Scene templates are ranked by their measured approval rate within a product
family, never pooled across families, because the same scene performs very
differently on a standing figure and a flat set of coasters.

## What gets measured

Every generated artifact carries the inputs that produced it: the prompt, a hash
of the prompt scaffolding, the model, and the cost. Every human judgment is
stored next to it. That makes two questions answerable that are usually a matter
of opinion:

- Did a prompt change help? Compare approval rates across prompt versions.
- Which scene is worth spending on? Compare yield within family, with intervals
  wide enough to be honest about small samples.

`scripts/outcome-report.ts` writes that as a dated markdown file to
`docs/reports/`, committed, so a change is judged by diffing two reports rather
than by remembering how things felt.

## Data model, briefly

```
designs ──< pieces ──< photos
   │          │
   │          └──< videos
   ├──< drafts            (generated_json + final_json, both kept)
   ├──< staged_images     (prompt, prompt_version, model, cost, status, reject_reason)
   ├──< dimension_cards
   ├──< staging_chats
   └──< jobs ──< job_logs

intakes    pending captures awaiting a confirm
events     append-only log of anything worth reconstructing later
```

Migrations are additive: columns are added by checking `PRAGMA table_info` and
issuing `ALTER TABLE ADD COLUMN`. There is no migration framework because a
single-file database with one user does not need one. The one real constraint is
that CHECK constraints cannot be extended without rebuilding the table, which is
worth knowing before adding a new job kind or status.
