# Gitdeck fork — backlog

Personal-fork backlog for `Noisyink/gitdeck`. Running on the home server at `:8766`.

## Done (2026-06-11 sweep)
- [x] Fixed the 4 pre-existing upstream `tsc` errors — `npm run typecheck` and the
      test suite now pass clean.
- [x] Hid the Notifications (Inbox) nav tab — it 403s without a `notifications`
      token; the view code and `/inbox` route remain, only the button is gone.
- [x] **Summary caching** — the last Claude summary per (repo, number, model) is
      cached server-side (`summaries.json`); re-opening a thread is free, and
      "Regenerate" (`fresh`) is the only path that re-bills.
- [x] Long-timeline handling — `fetchThread` flags `truncated` at 100 events and
      the thread shows "Showing the first 100 events. Open in GitHub." (Full
      append-pagination was judged disproportionate; the Open-in-GitHub button is
      the escape hatch for very long threads.)
- [x] Ownership toggle now persists (localStorage) so your owned/non-owned/both
      choice is the default across reloads.
- [x] Clear/rotate the Anthropic key from Preferences (Clear button + server clear
      path). GitHub-token rotation is still via the existing add-token flow.

## Open
- [ ] Check whether debba's inherited `.github/workflows` CI runs (and fails)
      noisily on the fork; remove them if so — **needs a `workflow`-scoped token**
      to push the change.
- [ ] Broaden thread timeline coverage (more event types; inline review-comment
      threads), currently a curated set + top-level comments/reviews.
- [ ] Progressive **hand rewrite** to de-AI-slop the upstream scaffolding (the fork
      notice flags this). Do it in slices; keep `upstream-mirror` as the baseline.

## New server / migration (cross-ref `../migration/TODO.md`, blocked on K8 Plus hardware)
- [ ] Fold gitdeck into the **services-guest** stack behind **Caddy** (+ likely
      **Authentik**) instead of exposing raw `:8766`.
- [ ] Move both secrets — the write-capable **GitHub token** and the **Anthropic
      key** — out of `.env` / `settings.json` into the **SOPS/OpenBao** pattern.

## Security posture note
A no-login LAN app holding a write-capable GitHub token + an Anthropic key that
performs public writes. Fine on the trusted LAN; gate behind Caddy/Authentik before
any wider exposure.
