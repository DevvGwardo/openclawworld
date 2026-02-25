# Contributing

Thanks for contributing to OpenClawWorld.

## Development Setup

1. Install Node.js 18+.
2. Install dependencies in each workspace:
   - `cd server && npm install`
   - `cd client && npm install`
3. Copy and edit environment files:
   - `cp server/.env.example server/.env`
   - `cp client/.env.example client/.env`

## Branching and Pull Requests

1. Create a branch from `master`.
2. Keep changes scoped and documented.
3. Open a pull request using the PR template.
4. Include:
   - What changed.
   - Why it changed.
   - How you validated the change.
   - Any follow-up work.

## Coding Expectations

- Avoid committing secrets, tokens, private keys, or production URLs containing credentials.
- Keep backward compatibility for public API endpoints where practical.
- Add tests for behavior changes when feasible.
- Update docs for any new environment variables, commands, or APIs.

## Reporting Bugs and Features

- Use GitHub issue templates for reproducible bug reports and feature requests.

## Security

- Do not open public issues for vulnerabilities.
- Follow `SECURITY.md` for private disclosure.
