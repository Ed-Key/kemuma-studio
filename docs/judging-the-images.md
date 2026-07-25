# Judging the images

A design for making the approve and reject clicks worth something. Written
from the conversation of 2026-07-25, on top of the jobs work in
`docs/jobs-and-the-rail.md`.

## Why

`rejectStagedImage` records one bit: this image is out. That bit cannot
answer any question worth asking, because every different failure lands in
the same bucket. All of these are "rejected" today:

- the dish looks like a different object than the one being sold
- the carved bands are smoothed away
- six coasters came back as five
- a prop is touching the piece, which the plan forbade
- it is a perfectly good image and the owner only needed one

The first four are faults and each one indicts a different part of the
pipeline. The fifth is not a fault at all. A batch of four where the owner
needed one produces three rejections that mean nothing about the model, and
today they are indistinguishable from three failures. Any rate computed
from the current data is wrong in the same direction every time.

## The reasons

Six, fixed, no free text in this version.

| stored | shown | what it indicts |
|---|---|---|
| `wrong_object` | wrong piece | image model, reference photos |
| `lost_detail` | lost carving | image model, source photo quality |
| `wrong_count` | wrong count | the plan's `subject_and_count` |
| `broke_plan` | broke the plan | director's plan, prompt validator |
| `looks_fake` | looks fake | the scene template |
| `not_wanted` | just not it | nothing, and that is the point |

`not_wanted` is the one that makes the rest trustworthy. Without somewhere
to put surplus and preference, they pile into the fault categories and the
numbers lie. It is expected to be the most-clicked reason and must never be
counted as a failure.

Free text is deliberately left out. A note field on every card in a
four-across grid is clutter, and the owner's stated problem is that judging
is already too slow to bother with. If the six prove insufficient, the
column takes a note later; the reverse, stripping a field nobody filled in,
is the harder cleanup.

## What it buys

Every staged image already stores its exact prompt, scene, source photo,
model and cost, and every job now stores its own tool calls. A reason on
the reject is the missing join. It makes these answerable from rows alone:

- **Which scene templates fail?** Eight of them. If one draws twice the
  `looks_fake` rate of the others, retire it. Available after roughly forty
  images.
- **Does `variance` earn its cost?** Today it is a checkbox toggled blind.
- **Do director plans beat the preset scenes?** `chat` against named scenes,
  same categories.
- **Is a reference photo poisoning the batch?** If the rejects concentrate
  on one `source_photo_id`, the problem is a photograph, not a model.
- **Do plans the validator rejected four times produce worse images?**
  `job_logs` has the rejections and `staged_images` has the outcome. This
  join did not exist before this week.

And the one that changes spending rather than quality: if the first
approved image is usually in position one or two, four per batch is paying
for images that will never be used.

## How it feeds back into the agent

Each category points at a different lever, which is the whole reason for
splitting them:

- `wrong_count` is a prompt fix. The director writes `subject_and_count`
  and the validator does not check it against the catalog, which knows the
  piece has six coasters. That check is writable today.
- `broke_plan` is a validator fix. The plan said props well apart and the
  image ignored it, so either the prompt is not carrying the constraint
  hard enough or the exclusions need to be stronger.
- `looks_fake` is a scene fix, editable in `scenes.ts` without touching any
  model.
- `wrong_object` and `lost_detail` are reference fixes: more angles,
  `variance` on, a better source photo.

Grouping the rejects by category and reading the stored prompts of the
worst group is the loop. It is a person reading twenty prompts with a
reason attached, not an automated optimiser, and that is enough to move the
system.

## Not yet

**No rating scale.** A 1-5 per image demands a mental scale held steady
across weeks and still does not say why. Approve-with-destination plus
reject-with-reason is a half-second judgment that means the same thing in a
month.

**No model judge.** Tempting and premature: there is nothing to check it
against. Collect a few hundred owner labels first, then a judge can be
built and measured against them. The labels are the ground truth; the judge
is the thing under evaluation.

**No backfill.** Existing rejects stay unlabelled rather than guessed at.
The ship date is day zero.

## The change

**Schema.** `staged_images` gains `reject_reason TEXT`, additive migration
in the existing `PRAGMA table_info` style. No CHECK constraint; the list is
enforced in the writer so adding a reason later does not need a table
rebuild.

**Writer.** `rejectStagedImage(db, stagedId, reason)` validates against the
six and throws on anything else. `logEvent('stage.rejected', ...)` carries
the reason. Approving clears any previous reason, since an image can be
rejected and later approved.

**UI.** The candidate card's action block becomes one column of equal-width
controls, which also settles the ragged sizing the owner flagged: the
destination select and Approve both full width, then the six reasons in a
grid that fits two per row in a four-across card and three when there is
room. Each reason is one click and rejects immediately. No confirmation
step, because rejecting is reversible and a confirm would double the cost
of the most common action on the page.

## Verification

`npm test -- --run` and `npm run build`, plus a look in the browser: a
four-across grid of candidates with the new block, and one reject of each
kind checked in the database.
