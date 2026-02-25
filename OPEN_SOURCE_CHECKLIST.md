# Open Source Readiness Checklist

This checklist tracks the minimum work needed to publish this repository safely and maintainably.

## 1. Repository Governance and Legal

- [x] Add root `LICENSE` (project license).
- [x] Add `CODE_OF_CONDUCT.md`.
- [x] Add `CONTRIBUTING.md`.
- [x] Add `SECURITY.md` with vulnerability reporting path.

## 2. Safe Configuration and Secrets Hygiene

- [x] Add root `.env.example` (if needed) with placeholders only.
- [x] Add `server/.env.example` with all required keys.
- [x] Add `client/.env.example` with all required keys.
- [x] Confirm no real secrets are committed in tracked files.
- [x] Document a pre-release secret rotation step (tokens, API keys, DB creds).

## 3. Documentation and Developer Onboarding

- [x] Replace root `README.md` with project overview, architecture, and local setup.
- [x] Document required runtime versions (Node, npm/yarn).
- [x] Document development workflow for `server` and `client`.
- [x] Document deployment/environment behavior and defaults.

## 4. Community and Contribution Workflow

- [x] Add GitHub issue templates (bug report, feature request).
- [x] Add pull request template.

## 5. Verification Before Publish

- [x] Verify all checklist artifacts exist and are linked from `README.md`.
- [x] Record remaining manual tasks that must be completed before making repository public.

### Remaining Manual Tasks Before Public Launch

- Complete source/license attribution review for third-party assets under `client/public/` (tracked in `client/public/ASSET_PROVENANCE.md`).
- Enable and verify private GitHub security advisories for vulnerability intake.

### Completed Verification (2026-02-25)

- Passed local working-tree secret scan: `gitleaks detect --source . --no-git`.
- Passed git-history secret scan: `gitleaks git`.
- Passed dependency vulnerability audits (`npm audit`) in `server` and `client`.
- Git history rewritten: commit author email replaced with `noreply@openclawworld.dev`.

## Status

- `Completed for repository scaffolding`: docs/templates/checklist work is done in this branch.
