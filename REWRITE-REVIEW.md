# Gitdeck fork — rewrite review

Assessment to guide a progressive, hand-written de-slop rewrite of the
AI-scaffolded upstream code, without breaking a live single-user LAN tool or
losing any fork patch. Produced 2026-06-11 by a Lead → Architect → Reviewer pass.

Decisions baked in (from Jimmy): **cut** the OpenAI digest, the Forgejo/multi-forge
abstraction, and the hidden Inbox/notifications view; **structural change is
welcome** (split the monoliths); per-slice bar is green `tsc --noEmit` + `npm test`,
plus a manual `:8766` smoke-test on high-blast-radius slices.

Baseline facts: React 19 SPA + native-`http`/`fetch` Node/TS backend, **3 runtime
deps**, esbuild + vite, vitest. `server.ts` ~1306 lines / ~40 route branches and
`App.tsx` ~1046 lines are the two monoliths. PORT defaults to 8765 in `config.ts`;
the live `:8766` is a `PORT=` env override — don't hardcode 8766 into tests.
`git diff upstream-mirror` separates fork code (preserve) from upstream slop.

## Per-area verdict

| Area | Verdict | Why |
|---|---|---|
| `src/utils/*` (15 leaf modules) | **keep** | Test-covered, single-purpose, clean. (`inbox.ts` dies with the Inbox cut.) |
| Shared types (`types/github.ts`, `providers/types.ts`) | **refactor-in-place** | Keep shapes; strip forgejo/notification members after cuts. Gates every slice. |
| Auth chain (`authProvider`, `githubClient`, `oauth`, `accountStore`) | **refactor-in-place** | Solid + tested; only de-Forgejo the branches. |
| `tokenStore.ts` | **delete** | Self-labelled `@deprecated`; no prod callers. Dead. |
| OpenAI digest (`openaiDigest.ts`, digest LLM wiring) | **delete** | Explicit cut. `digests.ts` keeps snapshot/record role. |
| Forgejo / multi-forge (`forgejo.ts`, `forgejoData.ts`, registry indirection) | **delete + collapse** | Explicit cut. One real forge → collapse the seam. Biggest slop win (~600 lines). |
| Inbox / notifications (`InboxView`, `notifications.ts`, `utils/inbox.ts`, inbox state) | **delete** | Already hidden; remove the full plumbing (~120 lines of `App.tsx` are inbox-only). |
| `server.ts` router + handlers | **full-rewrite (split)** | The monolith; zero tests; highest blast radius. |
| `App.tsx` | **full-rewrite (split)** | Client monolith; zero tests. |
| `providers/github.ts` | **refactor-in-place** | Carries 4 fork features — do NOT rewrite the fork query/thread code; only shed `Provider` ceremony after the seam collapses. |
| `dashboardData`, `ciHealth`, `repoInsights`, `snapshots`, `securityAlerts` | **keep** | Clean memoize/cache services. |
| Fork summary stack (`anthropicSummary`, `summaryCache`, `settingsStore`) | **keep** | The fork's crown jewels; touch only for moved imports. |
| `http.ts`, `config.ts`, `aliasStore`, `aliasQuery` | **keep** | Tiny, correct. |
| Modals / common components | **keep** | `IssueThread`/`ReplyBox` are fork UI; preserve behaviour. |
| i18n | **keep** | Drop inbox/digest keys if desired; `Partial` typing is a non-gate marker. |

## Slop taxonomy (evidence)

- **S1 — Over-genericised provider seam.** `Provider` (17 members) + `ProviderCapabilities` (8 booleans) built for two forges; one real implementer. Only one capability flag is actually consumed (`useCapability("projects")`, `App.tsx:168,726`). `registry.ts` indirection exists only to pick between two classes.
- **S2 — Dead module shipped.** `tokenStore.ts:5-9` documents itself as deprecated.
- **S3 — Copy-paste route branches.** `/api/repos|issues|prs` are byte-identical 7-line blocks (`server.ts:1246-1269`); same shape at `/api/ci-health`.
- **S4 — Copy-paste parse boilerplate.** The `readJsonBody`+`try/catch 400` dance at 9 sites; `parseRepo || 400` at 8 sites.
- **S5 — Three parallel "auth required" idioms.** `AuthRequiredError`, a second `GitHubAuthRequiredError` (`github.ts:632`), and bare `{ needsAuth: true }`; `needsAuth`/`needsKey`/`needsScope` ad-hoc.
- **S6 — HTML-regex scraper in the hot path** (`parseDependentsHtml`, `server.ts:286-354`) — fragile but backs a real feature; keep-but-fenced.
- **S7 — Silent best-effort `catch {}`** in several stores (mostly legit) + App.tsx `.catch(()=>{})` on secondary fetches hiding real errors.
- **S8 — ~120 lines of inbox-only dead state** in `App.tsx` after the cut.

## Sliced rewrite order

Each slice ships green and is reversible; deletions + leaf work first, monoliths last.

1. **Delete `tokenStore.ts`** (+ its test). Bar: tsc+test. No fork patch.
2. **Cut OpenAI digest** — delete `openaiDigest.ts`; drop `maybeGenerateOpenAIDigest` call sites in `digests.ts` (keep snapshot/record). Bar: tsc+test (check `digests.test.ts` doesn't assert on `ai`). No fork patch.
3. **Cut Inbox (frontend)** — delete `InboxView`, `utils/inbox.ts`; strip inbox state/handlers/effects/routes from `App.tsx`, `SidebarControls`; remove `fetchNotifications`/`mark*` from `api/github.ts`. Bar: tsc+test+**smoke**. Fork patch: the App.tsx ownership/stats features share the file — must survive untouched.
4. **Cut Inbox (backend)** — delete `notifications.ts`; remove `/api/notifications*` routes/handlers + `invalidateNotificationsCache` calls. Bar: tsc+test+**smoke** (logout, account switch). No fork patch.
5. **Collapse the provider seam to GitHub-only** — delete forgejo files; reduce `registry.ts` + `Provider` interface; strip `"forgejo"`/`fj`/codeberg seed. Bar: tsc+test+**smoke**. **Highest-risk for fork features**: `createComment`/`fetchThread` must still resolve through whatever replaces `getProviderForAccount`.
6. **Consolidate error/auth idioms + parse helpers** in `server.ts` (pure dedup: merge the two auth-error classes, add `readBody`/`requireRepo`, table-drive the identical cached routes). Bar: tsc+test+**smoke** (byte-identical route shapes).
7. **Split `server.ts`** into a thin router + `src/server/handlers/*.ts` (move handlers verbatim). Bar: tsc+test+**smoke** (full route sweep). Fork handlers (`handleThread/Summary/CreateComment/Settings`) move intact.
8. **Split `App.tsx`** into per-tab view components; keep data-loading + fork-derived values (`mineStars`, `ownedInsights`, `repoOwnership`) in the container/hook. Bar: tsc+test+**smoke** (every tab; ownership toggle; export; modals).

## Fork-patch preservation map

| Fork feature | Source | Slices | Must still behave identically |
|---|---|---|---|
| author:@me Issues/PRs scoping | `github.ts` + `settingsStore.getContribFilter` | 5, 7 | Qualifier resolves UI-setting → `GH_DASH_FILTER` → `author:@me`. |
| Contributed-to repos in grid | `github.ts` `reposContributedTo` | 5 | Grid still includes upstreams you don't own, deduped. |
| Ownership toggle + split stars/forks + owned-only health | `App.tsx`, `utils/dashboard.ts` | 3, 8 | Toggle persists (`gh-dash.repoOwnership`); mine-vs-upstream split; health over owned only. |
| Archived-repo hiding | `github.ts` | 5 | Items on archived repos stay hidden. |
| Inline reply (`/api/comment`) | `handleCreateComment`, `github.createComment`, `ReplyBox` | 5, 7 | Posts a comment, returns `htmlUrl`; 401→needsAuth intact. |
| Inline thread view (`/api/thread`) | `handleThread`, `github.fetchThread`, `IssueThread` | 5, 7 | Body + timeline + PR review comments, sorted, `truncated` at ≥100. |
| Claude summaries + caching (`/api/summary`) | `handleSummary`, `anthropicSummary`, `summaryCache`, `settingsStore` | 5, 7 | Cached per (repo,number,model); `fresh` bypasses; needsKey/disabled gates; bills user key only. |
| Expanded preferences | `handleSettings`, `settingsStore` | 5, 7 | GET never returns raw key; PUT preserves key on empty save; `clearAnthropicKey` wipes. |

## Test-gap gates (characterization tests BEFORE rewriting)

Existing tests cover only `utils/*` + two stores. **Zero coverage** on `server.ts`,
`App.tsx`, and the providers.

- **Before Slice 5 (REQUIRED)** — provider fork methods against recorded fixtures:
  `fetchThread` (timeline normalization, review-comment merge, truncation),
  `createComment` (success + 401), `listIssues`/`listPullRequests` (archived filter,
  contrib-filter query). The single most important gap.
- **Before Slices 6/7 (REQUIRED)** — route-level tests (in-process server + mocked
  provider) asserting status + JSON shape for `/api/repos|issues|prs`, `/api/thread`,
  `/api/summary` (cached vs fresh), `/api/settings` (GET hides key).
- **Before Slice 8 (recommended)** — keep the toggle wiring thin and lean on the
  existing `dashboard.test.ts` coverage of `filterReposByOwnership`.
- Slices 1-4 are deletions of dead/hidden code: existing tests + a smoke pass suffice.

## Reviewer findings (quality + security)

Secret/token/auth handling verdict: **sound** — keys written `0600` (atomic
tmp+rename), never serialized into responses, `GET /api/settings` strips the raw
key, Device Flow OAuth (no `client_secret`), no token in any log/error.

**Fix regardless of rewrite:**
- **F-01 (High)** `anthropicSummary.ts` — stop proxying the raw Anthropic error body to the client; extract only the structured `error.message`, else `HTTP <status>`.
- **F-02 (High)** `anthropicSummary.ts` — no timeout on the Anthropic fetch; add `AbortSignal.timeout(30s)` → 408 on timeout (native http has no default per-request timeout).
- **F-05 (Medium)** `ReplyBox.tsx` — textarea stays editable during the confirm step, so the posted body can differ from what was confirmed; snapshot the body on entering confirm and disable the textarea (or show the body in the confirm prompt).

**Address during rewrite:**
- **F-03** `readJsonBody` has no size cap → add ~1 MB limit, 413 on breach.
- **F-04** top-level catch sends `String(err)` to the browser → generic message + server-side log.
- **F-06** `awaiting-review` preset uses `reviewsCount === 0`, which misses post-push re-reviews → use `reviewDecision === null || "REVIEW_REQUIRED"`.
- **F-07** `startsWith` route matching is fragile → exact-path/real router (folds into Slice 6/7).
- **F-08** `stripHtml` regex is naive (comments/CDATA) → fine for LLM input, note for rewrite.
- **F-09** truncated timeline still fetches all review comments → UI should flag the asymmetry.
- **F-10** summary cache has no TTL → add ~24h TTL (Regenerate already bypasses).
