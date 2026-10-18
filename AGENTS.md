# AGENTS.md

Shared operating instructions for Cursor Cloud Agents, Codex, ChatGPT Work, and Muse (Jack) working in this repository.

GitHub pull requests are the review and approval boundary. Do not merge, deploy, or change production configuration unless a human explicitly approves that step.

## What this project is

- Production website for **Maestros Services**, a Vancouver Island landscaping / property-services business owned by Josh Heslop. Live site: https://maestrosservices.com
- Stack: **Astro 5 + TypeScript + Tailwind CSS**, with structured service/location content, schema.org JSON-LD, and local-SEO page generation.
- App code lives at the **repo root**: `src/` (pages, components, content data), `public/`, and `functions/` (Cloudflare Pages Functions). Growth / Google Business Profile / Google Ads tooling lives under `scripts/`.
- Package manager: **npm** (`package-lock.json`).

## Verified commands

All commands run from the repo root and come from `package.json` verbatim:

| Purpose | Command |
| --- | --- |
| Dev server | `npm run dev` |
| Production build | `npm run build` |
| Preview the build | `npm run preview` |
| Route smoke tests | `npm run smoke` |
| Build + smoke | `npm run build:smoke` |
| Full test suite | `npm test` |

`npm test` runs the `node --test` suites for GBP, growth, growth-weekly, growth-ci, growth-diagnostics, reporting-config, growth-drafts, review-watch, lead-ops, and site-copy checks.

## Deployment

- Cloudflare **Pages** project `maestrosservices`, connected to this repo: pushes to `main` auto-deploy via the Cloudflare Git integration.
- A failed build never replaces live production — the previous deployment keeps serving.
- "Deployed" means a deployment record tying the live version to the exact commit, plus one runtime check of the changed behaviour. Anything less is "reported", not deployed.

## Team conventions (bind every agent here)

1. Before merging any PR, fetch its **reviews AND review comments** and disposition every finding. Codex review triggers when a draft PR is marked ready or on "@codex review" — it does not run on drafts, so mark ready and wait for that window before merging.
2. Verify code from **source bytes** in the repo — never from another agent's transcription or summary of code.
3. Evidence discipline: "reviewed" names the exact commit; "deployed" requires the deployment record + runtime check described above.
4. Small, focused, reversible changes. No drive-by refactors. No PRs beyond the assigned task.
5. PR bodies and commit messages must not include a "Do not merge" line unless a human explicitly asks for one.

## Owner's hard constraints

- **No customer or third-party sends or posts without David's approval.** This includes the `gbp:create-post` and `ads:create:*` / `ads:launch-*` scripts — never run mutating GBP/Ads scripts as routine validation.
- **No spending.** Free tiers only.
- **Never publish David's home address** — it is private; hidden verification-only fields at most. Josh's street address is likewise never published.
- **Truthful marketing only** — no invented claims, prices, reviews, or clients. Canonical business facts: hours Mon–Fri 8–6, Sat 9–4, Sun closed; quotes email quotes@maestrosservices.com; phone (250) 858-1781.
- **EuroPools is a separate, gated business** (David's father's company) and is NOT a EuroDigital client. Take no EuroPools actions from this repo and never list it as a client or portfolio entry.
- Never commit secrets, `.env` contents, API keys, or customer data.
