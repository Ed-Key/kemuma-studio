# Contributing

Conventions for working in this repo. They are short because they are meant to
be read.

## Branching

`dev` is the default branch and the integration target. Feature work merges into
`dev`. Nothing merges into `main` except release PRs from `dev`.

Never commit directly to `main` or `dev`. Branch off `dev`, and keep one branch
and one PR per cohesive change:

```
feat/...    fix/...    style/...    docs/...
```

If a branch is doing two unrelated things, it is two branches.

## Commits

Conventional commits, lowercase after the colon: `type(scope): subject`. The
types in use are `feat`, `fix`, `style`, `docs`, `chore`, `refactor`.

Scopes name the part of the product the change lives in rather than the
directory it touched. The ones already in the log: `staging`, `ui`, `jobs`,
`catalog`, `etsy`, `capture`, `rail`, `writer`, `dimcards`, `providers`, `designs`,
`spec`, `review`, `matcher`, `evals`, `draft`, `css`. Reuse an existing scope
where one fits.

### Subjects

A subject states the decision in the language of the product, not the file
operation that carried it out. Two from the log:

```
fix(etsy): stop treating a normal update push as a problem
feat(rail): make arriving at a job's page the thing that clears it
```

Neither names a file, and neither needs to. "update push.ts" would say less in
the same space.

### Bodies

Add a body of a few sentences whenever the commit encodes a judgment call. It
answers two questions: why this approach, and what the old behaviour got wrong.
The `fix(etsy)` commit above spends its body on exactly that, explaining that a
routine update recorded a warning, that the card reads warnings before it reads
published, and that a listing the owner had already published therefore sat in
"Needs you" forever.

A mechanical commit with no decision in it does not need a body. Most commits
here have one, because most of them chose between options.

## Verification

Before opening a PR:

```
npm test -- --run
npm run build
```

`npm test` runs the Vitest suite once over `src/**/__tests__`. `npm run build`
writes to `.next-build`, so it does not disturb a running dev server. There is
no separate lint step, because the build type-checks.

Anything with a visual surface also needs a look in the browser:

```
npm run dev
```

## Review

Edward Kiboma (GitHub `Ed-Key`) reviews and merges. Contributors do not merge
their own PRs.

Fill in `.github/PULL_REQUEST_TEMPLATE.md` for real: Summary, Risk map, Review
focus, Verification, Media. Verification means what you ran and what it said,
rather than a claim that it passed.

## Prose style

Applies to commit messages, PR text, and docs.

- No em dashes. Use a period, a comma, or parentheses.
- No emojis.
- Plain and direct. No marketing voice, no hedging filler.
