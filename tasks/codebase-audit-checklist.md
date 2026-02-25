# OpenClawWorld Codebase Audit Checklist

## Objective
Establish a complete, prioritized review of the entire repository and convert findings into actionable fixes.

## Phase 0: Baseline and Guardrails
- [ ] Confirm Node/npm versions used in CI and local dev are pinned and documented.
- [ ] Decide source of truth for package managers (npm vs yarn) per workspace and remove drift.
- [ ] Define severity labels for findings (P0/P1/P2/P3) and expected turnaround.
- [ ] Create an audit log file (`tasks/audit-findings.md`) to record findings with owner and status.

## Phase 1: Repository Hygiene
- [ ] Review repository structure for stale or duplicate files.
- [ ] Verify `.gitignore` covers generated artifacts, logs, and local env files.
- [ ] Validate all docs (`README`, `CONTRIBUTING`, `SECURITY`) match actual runtime behavior.
- [ ] Confirm open-source checklist items are all resolved with evidence.

## Phase 2: Dependency and Supply Chain Review
- [ ] Run dependency vulnerability scans in `server/`, `client/`, and `packages/openclawworld/`.
- [ ] Identify outdated high-risk dependencies and prioritize upgrade order.
- [ ] Remove unused dependencies and lock transitive risk where feasible.
- [ ] Verify lockfile strategy (currently mixed npm + yarn lockfiles) and standardize.
- [ ] Add/verify license compliance review for shipped dependencies and bundled assets.

## Phase 3: Server (`/server`) Deep Audit
- [ ] Trace all HTTP routes for input validation, auth, and rate limiting coverage.
- [ ] Review Socket.IO event handlers for auth checks, authorization boundaries, and abuse controls.
- [ ] Validate DB fallback behavior (with/without `DATABASE_URL`) for correctness and data durability.
- [ ] Confirm error handling does not leak secrets or internals in responses/logs.
- [ ] Stress-test startup/reconnect logic (DB outages, retries, partial service recovery).
- [ ] Review invite, key-rotation, and bot-management endpoints for privilege escalation risks.
- [ ] Verify shared constants are not duplicated in ways that can drift (`shared/` vs `server/shared/`).

## Phase 4: Client (`/client`) Deep Audit
- [ ] Audit state/data flow for multiplayer sync correctness and stale UI risks.
- [ ] Verify all network requests and socket events handle failures and retries gracefully.
- [ ] Review DM/inbox flow end-to-end (badge counts, thread state, bot sender restrictions).
- [ ] Validate 3D asset loading/error boundaries and fallback UX for missing/corrupt models.
- [ ] Check performance hotspots (render loops, heavy components, unnecessary re-renders).
- [ ] Evaluate accessibility basics (keyboard navigation, contrast, focus handling, semantics).
- [ ] Confirm production build size and asset delivery strategy are acceptable.

## Phase 5: Agent API and Identity Deep Audit
- [ ] Review agent/bot API key handling and ensure secrets are never logged.
- [ ] Validate room join/switch/invite flows over REST + Socket.IO.
- [ ] Audit rate limiting and outbound action throttling for abuse prevention.
- [ ] Validate DM reply logic and server-side allowed-sender enforcement.
- [ ] Confirm identity/session persistence and failure behavior.

## Phase 6: Shared Logic and Domain Correctness
- [ ] Review motive/decay systems for consistency between client/server simulations.
- [ ] Verify interaction affordances and completion effects are server-authoritative.
- [ ] Audit room/item catalog consistency and migration safety for newly added assets.
- [ ] Confirm economy actions (quests, transfers, claims) are idempotent and protected.

## Phase 7: Testing and Verification
- [ ] Catalog current automated test coverage (unit/integration/e2e) and identify critical gaps.
- [ ] Convert high-value manual scripts in `tests/manual/` into repeatable automated checks.
- [ ] Add smoke tests for: server boot, client build, agent join, DM flow, invite flow.
- [ ] Add regression tests for recent risk areas (OpenRouter integration churn, DB fallback, DM inbox).
- [ ] Define minimum CI gates for merge (lint, build, tests, audit checks).

## Phase 8: Observability and Operations
- [ ] Review logging format, levels, and sensitive-data redaction across server + agent integrations.
- [ ] Add health/readiness checks where missing and verify failure semantics.
- [ ] Document incident triage steps for core failures (DB down, socket instability, agent auth errors).
- [ ] Verify backup/recovery expectations for persisted data.

## Phase 9: Security Hardening
- [ ] Verify secrets management and environment variable handling across all runtimes.
- [ ] Ensure authentication and authorization are consistently enforced on privileged actions.
- [ ] Validate input sanitization and output encoding for user-provided content.
- [ ] Verify rate limiting and anti-spam controls on chat/DM/public endpoints.
- [ ] Run a lightweight threat-model review focused on agent impersonation and API key abuse.

## Phase 10: Release Readiness
- [ ] Produce a prioritized remediation backlog with effort and risk estimates.
- [ ] Close P0/P1 findings or document accepted risk with owner approval.
- [ ] Re-run full verification after fixes and capture evidence.
- [ ] Update docs/changelog/release notes with behavior changes.
- [ ] Tag a release candidate and define post-release monitoring checks.

## Suggested Execution Order (First Week)
- [ ] Day 1: Baseline + dependency/security scan + repository hygiene.
- [ ] Day 2: Server event/auth audit + route validation.
- [ ] Day 3: Client sync/DM/performance audit.
- [ ] Day 4: Agent API + shared logic consistency checks.
- [ ] Day 5: Test gap closure plan + CI gate proposal + remediation prioritization.
