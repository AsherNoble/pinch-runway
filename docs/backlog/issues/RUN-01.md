## Goal

Verify that the scaffold can be deployed and that all Pinch credentials stay
server-side. This work is partly present in the scaffold; finish and prove it.

**Priority:** P0 · **Lane:** platform · **Size:** S
**Depends on:** none

## Acceptance criteria

- [ ] The Next.js/TypeScript app builds, lints, and deploys to a public preview URL.
- [ ] Pinch credentials exist only in server runtime configuration; no `NEXT_PUBLIC_*`, browser request, or log exposes them.
- [ ] `.env.example` documents Pinch and database values without any secret value.
- [ ] `seed` and `sandbox` are explicit source modes; sandbox mode never falls back to fixtures on API failure.
- [ ] The public preview is recorded for QA-01.

## Notes

The scaffold already includes CI, `.env.example`, readiness handling, and a
read-only `/api/pinch/health` route. Do not treat “credentials are present” as
proof of a live connection; `PIN-01` owns the authenticated evidence.
