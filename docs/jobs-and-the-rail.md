# Jobs and the rail

A plan for making the slow AI operations non-blocking, concurrent, and
visible from anywhere in the app. Written from the design conversation of
2026-07-24. The one-sentence rule the whole plan serves: nothing in the app
ever blocks, anything slower than a beat is a job, and jobs live in the rail.

## Why

Every AI operation today runs inside a server action that the page awaits.
`chatTurnAction` awaits the full agent turn (measured at 65s),
`stageDesignAction` awaits the whole image batch (about 2 minutes), and the
form sits pending until the action returns. Refresh kills the request, and
Next.js serializes server actions per browser session, so a second operation
started from another page queues behind the first. The freeze and the
no-concurrency problem are the same bug: the action does the work instead of
recording that work needs doing.

The fix is enqueue-and-return. The action inserts a job row, starts the work
in the background, and returns a job id in milliseconds. Results were always
persisted to SQLite anyway; now the fact of the job is too.

## Decisions already made

- The app runs day to day under `npm run dev`, so dev-server restarts are
  routine, not rare. A job stranded by a restart is a normal state called
  interrupted, surfaced with a one-click retry, never a spinner that spins
  forever.
- No cap on concurrent image generations. This is deliberate: the runner
  writes one row per generation, so running three batches wide produces real
  timing evidence, and a cap can be added later as a one-line change if the
  machine or the codex subscription objects.
- Operations that become jobs: the staging director chat turn, the planned
  batch, the direct staging batch, and listing copy generation. The intake
  matcher and the dimension card stay synchronous; they take seconds.
- The rail is the home for job visibility. Collapsed at 50px it shows only
  the marks (variant B below); identity waits for hover.
- The mark is the imported `ThinkingOrb`, the same component `WorkingOrb`
  wraps. Running is the orb animating; done is the orb with `paused`.
  Trouble changes shape, not just motion: failed is a solid square in the
  danger color, interrupted is a hollow square in the warn color.
- Motion only ever means running. Orb states change only on real job
  events, never on timers.
- A finished success never expires on its own. It sits until its page is
  visited, however long that takes.
- No duration estimates in the UI. Elapsed time is shown; typical-range
  copy was considered and rejected.
- No summarizer model for the narration line initially. Real tool events
  and streamed plan sections carry it; a small rewriting model is a later
  option only if the raw events read too much like logs.

## Architecture

### The jobs table

A new table in the existing SQLite db. The table is the source of truth and
the executor is an implementation detail behind it, so if in-process
execution ever needs to move to a separate worker, the promotion changes
nothing in the UI.

    jobs (
      job_id       INTEGER PRIMARY KEY,
      kind         TEXT NOT NULL,        -- 'director_turn' | 'staging_batch' | 'planned_batch' | 'listing_copy'
      design_id    INTEGER REFERENCES designs(design_id),
      title        TEXT NOT NULL,        -- "Staging · Leaping Gazelle"
      status       TEXT NOT NULL,        -- 'queued' | 'running' | 'done' | 'failed' | 'interrupted'
      destination  TEXT NOT NULL,        -- path of the page that launched it, e.g. /designs/7/staging
      seen_at      TEXT,                 -- set when the destination is visited after finish
      error        TEXT,
      model        TEXT,                 -- model actually used for the run
      input_tokens  INTEGER,
      output_tokens INTEGER,
      cost_usd     REAL,
      created_at   TEXT NOT NULL,
      started_at   TEXT,
      finished_at  TEXT,
      heartbeat_at TEXT
    )

The token and cost columns are stamped at completion from the usage the
runtime already reports (`computeCostUsd` exists in the writer). They cost
nothing now and are the seed of the eval system later; the reference runner's
`executionAgents` table proved this shape.

Per-generation detail rows (one per image subprocess) hang off the job so
the no-cap experiment produces data. Narration events go into a `job_logs`
table, append-only, one row per observation, following the reference runner's
`agentLogs`: `(job_id, log_type, tool_name, content, created_at)` with
`log_type` in `text | tool_use | tool_result | error`, content truncated to
a couple of thousand characters, and tool inputs redacted before logging.
This is richer than stuffing the shared `events` table and makes any past
run replayable step by step, which the eval work will want.

### Enqueue-and-return

Each converted server action becomes: validate input, insert the job row,
invoke the executor without awaiting it, return `{ ok, jobId }`. The page
is free immediately. The executor is the existing function
(`runAgentTurn`, `runStaging`, `runPlannedBatch`, the writer) wrapped so it
stamps `started_at`, heartbeats every few seconds while running, and stamps
`finished_at` with `done` or `failed` on the way out.

### The live registry and the stale sweep

Mandatory from the first commit, because `npm run dev` restarts strand
in-flight jobs regularly. The mechanism is stolen from the reference runner's
heartbeat sweep, which distinguishes two different sicknesses:

- The executor keeps an in-process registry (a `Set` of running job ids,
  removed in a `finally`). The sweep compares `running` rows against the
  registry. A row with no live entry is an orphan (the server restarted
  mid-job) and flips to `interrupted` after 90 seconds.
- A row that is live but has run absurdly long (15 minutes covers our
  slowest batch several times over) is stuck: abort its controller and
  mark it `failed`.

The `heartbeat_at` column backs this up as a plain timestamp the executor
refreshes, so the sweep still works if the registry logic ever regresses.
The sweep runs whenever the jobs endpoint is read. Interrupted jobs offer
one-click retry, which re-runs the stored kind and inputs; retry is cheap
because every result persists.

### The rail's feed

A `/api/jobs` route returns open jobs (anything running, plus finished ones
not yet seen). The rail polls it every few seconds; polling is correct for
one user, no websockets. Visiting a job's destination after it finishes
stamps `seen_at`, which is what clears the mark.

## The stages

One intent per stage, so each round knows what it is judging.

### Stage one: trust

Jobs table, heartbeats, stale sweep, enqueue-and-return for the four
converted operations, and a plain job list in the open rail: title, ticking
elapsed time, done or failed. No collapsed marks, no orb, no click
behavior, no narration. The only question this stage answers is whether the
rail ever lies, and it soaks through real restarts and real batches until
the answer is no. In-page pending states switch from awaiting the action to
watching the job row, so the chat shows the user's message immediately with
a pending reply row.

### Stage two: presence (variant B)

The collapsed 50px column gets the marks: a 22px hairline below the nav
glyphs, then the stack, newest first. Orbs at 15px, the failed square at
13px. Nothing but marks at 50px; hover opens the rail as it already does
and the marks gain names. Reduced motion inherits `WorkingOrb`'s dot
fallback. Mock reference: the round-one artifact, variant B, with the open
state as shown there.

### Stage three: the switchboard

Marks and rows become links. Clicking any job navigates to its destination;
for a finished success, arriving is what clears it, and normal navigation
clears it the same way. Failed jobs navigate but do not clear on arrival;
they clear on an explicit tap at the destination, because a half-failed
push is the one case where reaching the page is not proof of seeing the
problem. Interrupted jobs navigate to a retry affordance. Slot-style hover
targets from the round-one variant D graft onto B's layout here.

### Stage four: voice

The narration line. Each tool call in the agent loop writes an event
("reading photos 45, 46, 47"), and the running job's row shows the latest
one with the shimmer treatment in the third text color. Then the streaming
piece: the agent API call switches to streaming, and the partial JSON of
the `plan_batch` call reveals which of the six plan sections is being
written, so the long compose gap honestly reads "writing the product lock"
instead of nothing. A validator rejection surfaces as "plan rejected,
rewriting", which is real information about why a turn ran long.

## What we studied and chose not to copy

the reference runner (its author's iMessage agent, local copy in
`~/Projects/the reference runner`) is the reference for the run-storage and
observability design above. Two of its choices we deliberately do not
import:

- Convex as the store. Its reactive queries push updates to the dashboard
  automatically, which is elegant, but Kemuma already lives in SQLite and
  one user polling every few seconds needs no push infrastructure. The
  lesson we keep is the separation: durable rows are the only truth, and
  any push channel (his WebSocket `broadcast`) is just a hint to re-read,
  never a second source of state.
- The dispatcher-and-workers agent topology. Kemuma's operations are
  already well-factored single-purpose functions; they need run records,
  not a spawning hierarchy.

## Foundations for evals, not a stage yet

The eval system, if we build it, stands on rows this plan already writes:
`jobs` carries model, tokens, cost, duration, and outcome per run
(the reference runner's `usageRecords` pattern, collapsed into the job row since
every Kemuma job is one model call chain); `job_logs` makes any run
replayable step by step; `plan_batch` validator rejections are
machine-graded failures; and the approve and reject clicks on staged
scenes are human labels the db already stores. When an eval design is
worth writing, it gets its own doc; nothing in this plan needs to change
for it, which is the point of writing these columns down now.

## Guardrails

What would make this worse than the freeze it replaces, and the rule that
prevents it:

- A rail that lies. One job stuck on running after a dead server destroys
  trust in the whole surface. Heartbeats and the stale sweep are not
  optional and ship in stage one.
- Fake progress. No timer-driven orb states, no rotating status verbs, no
  percentages. Text and states change only on real events.
- A noisy island. The rail never auto-opens on job events. State changes
  appear in the collapsed marks; the drawer opens only for hover or focus,
  as today.
- False memory. `seen_at` is stamped only when the destination page renders
  with the result present, not when any navigation happens nearby.
- Contradiction. Poll lag of a few seconds between page and rail is
  tolerable; the two surfaces disagreeing on a job's outcome is not. Both
  read the same rows.
