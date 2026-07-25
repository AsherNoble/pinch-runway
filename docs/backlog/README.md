# Pinch Runway GitHub backlog

This is a dependency-aware backlog for a three-person self-assignment team.
Every `P0` issue belongs to tomorrow’s checkpoint; no `P0` Pinch issue is done
until it has real sandbox evidence, not a fixture screenshot.

## Live gates

| Gate | Proof |
| --- | --- |
| G1 | Authenticated Pinch sandbox calls prove the available primitive/field mapping. |
| G2 | A real Payer + Payment snapshot normalises to the shared Runway contract. |
| G3 | Reliability is computed from real paid history/attempt data. |
| G4 | A documented real sandbox Payment Link/payment write is confirmed by Pinch. |
| G5 | The public deployment performs the full read → reason → write rehearsal with fresh sandbox data. |

## Start here

| First | Owner | Then |
| --- | --- | --- |
| `PIN-01` | Lane A — Pinch | `PIN-02`, `PIN-03`, `PIN-04`, `PIN-05` |
| `ENG-01` | Lane B — Engine | `ENG-02` → `ENG-03` → `ENG-04` |
| `UX-01` | Lane C — Frontend | `UX-04` once `PIN-05` is ready; `UX-02`/`UX-03` after checkpoint |

`RUN-01`, `RUN-02`, and `RUN-03` have already been started by the scaffold.
Review their acceptance criteria, close what is satisfied, and do not let that
delay the critical three lanes.

## Publishing to GitHub

The workspace’s saved GitHub session was invalid when this scaffold was made,
so no remote repository or live issues were created. The individual issue
bodies and their labels are ready here; nothing in this folder fakes a GitHub
write.

After creating/pushing the repository and authenticating `gh`, preview the
publication plan:

```bash
npm run publish:issues -- --repo OWNER/pinch-runway
```

Then create labels and issues once:

```bash
npm run publish:issues -- --repo OWNER/pinch-runway --confirm
```

The publisher is deliberately opt-in and creates no issues without `--confirm`.
Run it only against the intended empty/new project, because it does not attempt
to deduplicate existing issues.

## Issue map

| ID | Priority | Lane | Size | Depends on |
| --- | --- | --- | --- | --- |
| [RUN-01](issues/RUN-01.md) | P0 | platform | S | — |
| [RUN-02](issues/RUN-02.md) | P0 | shared | S | — |
| [RUN-03](issues/RUN-03.md) | P0 | engine | S | RUN-02 |
| [PIN-01](issues/PIN-01.md) | P0 / G1 | Pinch | M | RUN-01, RUN-02 |
| [PIN-02](issues/PIN-02.md) | P0 / G2 | Pinch | M | PIN-01, RUN-02 |
| [PIN-03](issues/PIN-03.md) | P0 / G3 | Pinch | M | PIN-01, RUN-02 |
| [PIN-04](issues/PIN-04.md) | P0 / G3 | Pinch | S | PIN-01 |
| [PIN-05](issues/PIN-05.md) | P0 / G4 | Pinch | M | PIN-01, PIN-02 |
| [ENG-01](issues/ENG-01.md) | P0 | engine | S | RUN-02, RUN-03 |
| [ENG-02](issues/ENG-02.md) | P0 | engine | M | ENG-01, RUN-02, RUN-03 |
| [ENG-03](issues/ENG-03.md) | P0 / G3 | engine | M | ENG-02, RUN-02 |
| [ENG-04](issues/ENG-04.md) | P0 | engine | S | ENG-03 |
| [UX-01](issues/UX-01.md) | P0 | frontend | M | RUN-02, RUN-03, ENG-04 |
| [UX-02](issues/UX-02.md) | P1 | frontend | M | RUN-01, RUN-02 |
| [UX-03](issues/UX-03.md) | P1 | frontend | S | UX-02 |
| [UX-04](issues/UX-04.md) | P0 / G4 | frontend | S | PIN-05, UX-01 |
| [QA-01](issues/QA-01.md) | P0 / G5 | shared | M | PIN-02–05, ENG-02–04, UX-01, UX-04 |
