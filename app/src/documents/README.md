# Document engine (`src/documents/`)

Contest record in → file bytes out. A registry of document definitions drives
both the selection checkboxes and the ZIP builder; ported OOXML/theme helpers
build the raw markup; a golden-file harness locks each generator's output.

```
registry.ts    DOCUMENT_REGISTRY — id, label, filename, defaultSelected, build.
               The one source of truth for "which documents exist". Adding a doc
               is one entry here (plus its id in the model's DOCUMENT_TYPES) — no
               UI or packaging edits. build: (contest, ctx?) => bytes | Promise.
generate.ts    buildContestArchive — loops the registry, builds every selected
               doc, drops in the contest file, zips it. Awaits each build, so
               sync placeholders and async real builders both work.
ooxml.ts       THEME + raw WordprocessingML helpers (ooP, ooPHead, ooTable2Col,
               …) + makeDocx. Ported VERBATIM from v12; shared by every .docx.
format.ts      Deterministic date formatters (fmtDate/fmtDateShort/…), ported
               from v12's toLocaleDateString calls without locale/timezone drift.
letter.ts      Director Information Letter (.docx) — the first real generator.
goldenFile.ts  Golden-file test harness (Node fs; imported only by *.test.ts).
__fixtures__/golden/   Approved reference archives.
```

## Async builder contract

A `.docx`/`.xlsx` is itself a ZIP, so its real builder is async (JSZip). The
`DocumentBuilder` type is therefore `(contest, ctx?) => Uint8Array |
Promise<Uint8Array>`, and `buildContestArchive` `await`s every build.
Placeholder/synchronous builders remain valid — `await` on a plain value just
returns it. The optional `ctx` (`DocumentBuildContext`) carries a `now?: Date`
for documents that stamp a "letter date"; it defaults to build time.

## Determinism

Golden comparison needs stable output, so anything that would otherwise read the
clock or the host locale is made injectable/deterministic:

- **Letter date**: v12 stamped `new Date().toLocaleDateString()`. `buildDirectorLetter`
  takes `options.now` (defaulting to now) and formats it via `format.ts`.
- **Date strings**: `format.ts` reproduces v12's en-US output from explicit
  month/weekday tables and local calendar components — no `toLocaleDateString`.
- **ZIP metadata**: JSZip stamps entry timestamps and may reorder entries. That
  is *not* content — the harness ignores it by comparing unzipped parts (below).

## Golden-file harness — the pattern slices 7–9 (#20–#22) reuse

`.docx`/`.xlsx` are ZIP archives. **Never compare raw archive bytes** — ZIP
timestamps and entry ordering cause spurious failures. Instead, compare
CONTENT-NORMALIZED: unzip both archives and compare each inner part as
normalized text, keyed by path. `goldenFile.ts` provides:

- `expectArchiveMatchesGolden(bytes, goldenPath)` — the assertion. Passes and
  writes the file when the golden is missing or `UPDATE_GOLDEN` is set;
  otherwise throws a readable per-part diff (`- golden` / `+ actual`).
- `diffArchives(actual, golden)` / `normalizeArchive(bytes)` — the primitives,
  for finer-grained tests.

### Writing a golden test for a new document

```ts
import { buildMyDoc } from './myDoc';
import { expectArchiveMatchesGolden } from './goldenFile';

const GOLDEN = join(dirname(fileURLToPath(import.meta.url)),
  '__fixtures__', 'golden', 'My Document.docx');

it('matches the approved golden file', async () => {
  const bytes = await buildMyDoc(fixtureContest(), { now: LETTER_DATE });
  await expectArchiveMatchesGolden(bytes, GOLDEN);
});
```

Build from a **fixed** fixture contest and inject any date, so output is stable.
Pair the golden test with a few content-level assertions (unzip
`word/document.xml`, assert the right names/dates/orderings appear) — these
survive golden regeneration and document intent.

### Regenerating / approving a golden

```
UPDATE_GOLDEN=1 npm test        # (PowerShell: $env:UPDATE_GOLDEN=1; npm test)
```

Writes every golden from current output. **Review the resulting archive change
in your diff before committing** — that review is the approval. Commit the
updated `__fixtures__/golden/*` alongside the code change that justifies it.
