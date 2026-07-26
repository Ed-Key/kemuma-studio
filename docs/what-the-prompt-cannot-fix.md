# What the prompt cannot fix

A result from 2026-07-26, written down because it changes which lever is worth
pulling and it would otherwise be lost.

## The claim

Two staged images of the same coaster set, generated from a **byte-identical
prompt**. One was approved. One was rejected as `looks_fake`.

```
staged_id 251  approved         prompt sha1 7a3176c717
staged_id 254  rejected         prompt sha1 7a3176c717
```

Same scene text, same lighting section, same lock sentences, same exclusions,
same reference photographs, same model, same batch minute.

## Why it matters

The staging pipeline is built on the assumption that quality is controlled by
instruction. There is a validator that machine-checks five phrases are present,
including `"never composited"` and `"Relight it fully to the scene's
illumination"`. Those sentences were in both prompts. They were verified
present in both prompts.

If the same instruction produces both an acceptable and an unacceptable image,
then for this failure mode:

- rewriting the prompt cannot fix it, because the prompt was not the variable
- the validator cannot catch it, because the validator reads text and the
  failure is in pixels
- the remaining lever is **selection, not instruction**

That last point is worth stating plainly, because it is the opposite of where
effort naturally goes. The instinct on seeing a bad image is to add a sentence
to the prompt. This result says that for compositing-style failures the sentence
is already there and already ignored.

## What the failures actually look like

From reading the pair rather than their prompts. Two images is an anecdote, not
a finding, and this section should be replaced when there are twenty.

- **Light sources that emit nothing.** A lit candle sits in frame while the
  glass, the wall behind it and the object beside it are lit as though it were
  not there. The brightest thing in the picture contributes no illumination.
- **Carving that sits on the surface instead of in it.** The incised bands read
  as a decal applied to a flat disc rather than cut into stone. This is the
  single most product-specific failure: the carving is the thing being sold.
- **Crisp edges with soft blob shadows.** A hard outline against the table
  paired with an undirected contact shadow, which is the classic composite
  tell and what the `never composited` sentence exists to prevent.

## What follows from it

**Generate and select rather than instruct and hope.** The approve and reject
flow is already this. It stops being overhead and becomes the mechanism.

**A judge here should answer narrow physical questions, not "is this good".**
"Does the lit candle illuminate anything near it" and "does the carving sit
below the surface" are checkable, and there are human labels to validate the
answers against. A general quality score has nothing to be measured against and
would inherit exactly the ambiguity this result exposes.

**Do not spend more effort on the lighting sentences.** They are present, they
are enforced, and they did not decide the outcome. Effort belongs in the scene
templates, the reference photographs, and how many candidates are generated per
approved image, which the outcome report already prices.

## How this was nearly missed

The first attempt at explaining these rejections read the prompts and looked
for linguistic patterns that separated approved from rejected. It produced a
plausible story about shadow language that did not survive four examples, and
it could never have worked: the discriminating pair had the same prompt.

The method was wrong, not just the answer. A question about pixels cannot be
answered by reading text, and the check that settled it was hashing the two
prompts, which took one command and should have come first.
