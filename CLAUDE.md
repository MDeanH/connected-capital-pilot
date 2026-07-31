---
project: ai-diligence-platform
title: AI Due-Diligence Tool
cluster: diligence
status: verified
wiki: ~/wiki/wiki/projects/web/ai-diligence-tool-project.md
hub: ~/Claude/hub/ai-diligence-tool/
updated: 2026-06-28
---

# AI Due-Diligence Tool

AI investment due-diligence platform (real-estate MVP): a de-smoothed Monte Carlo engine with analyst weights, in Streamlit + React/Netlify builds. The private **Connected Capital** pilot deploys from the `pilot` branch (remote `pilotrepo` = `MDeanH/connected-capital-pilot`); the public origin is `MDeanH/ai-diligence-platform`.

## Status
Wiki `status: verified` (`verified_by: user-confirmed`, against the confidential README/HANDOFF — not re-auditable from the wiki alone; re-confirm on material change). Local checkout is currently on branch `pilot`.

## Key paths in this repo
- `.gitignore`
- `.netlify/`
- `.node-local/`
- `HANDOFF.md`
- `README-NETLIFY.md`
- `README.md`
- `app.py`
- `configs/`
- `data/`
- `dist/`

## Conventions
See `.claude/rules/project-rules.md` for the hard rules (pilot Basic-Auth secret, confidential files, remotes). Spine rule: **verified-on-hardware beats spec**.

## Related
- Wiki node: `[[ai-diligence-tool-project]]`
- Sibling: `[[connected-capital-pilot]]` (the private pilot remote of THIS repo), `Client prediction model` (feeder scorer)
- Cross-link: `[[usa-crime-3d-game-project]]` (the "Market Quest 3D" tab)

## Where things you might expect AREN'T
- Personal memory + dated notes → `~/Claude/hub/ai-diligence-tool/agent/` (NOT in this repo)
- Synthesis / verified facts → `~/wiki/` (but `HANDOFF.md` / `*-SETUP-NOTES.md` are deliberately NOT ingested — confidential)
- Research logs → `~/Documents/AI_Backup_Analysis/RESEARCH_LOG.md` + `~/wiki/raw/inbox/`

---

<!-- ─── Existing hand-authored repo notes (preserved below) ─── -->

# CLAUDE.md — ai-diligence-tool

**Canonical project knowledge lives in the LLM wiki at `~/wiki`.**

- Project page: `~/wiki/wiki/projects/web/ai-diligence-tool-project.md`
- Operating manual: `~/wiki/WIKI.md`

## Notes
- AI investment due-diligence platform (real-estate MVP): de-smoothed Monte Carlo engine, analyst weights; Streamlit + React/Netlify builds.
- Cross-link: [[usa-crime-3d-game-project]] (the "Market Quest 3D" tab).
- **`HANDOFF.md` and `ai-diligence-platform-SETUP-NOTES.md` are confidential (Connected Capital pilot) — excluded from the wiki, do not ingest.**

## Operate
- `/wiki-query <q>` to ask, `/wiki-ingest <path>` to add verified findings, `/wiki-lint` for health.

<!-- research-record-pointer:start -->

## External research

Scans of Hugging Face and GitHub for work adjacent to this project are recorded at
`~/Claude/hub/research/by-project/ai-diligence-tool.md`. Read it before searching the web for a
library, model, or prior art — it may already be answered there, with the licence and
maintenance state checked.

Everything in that file is `{status: unverified}` — READMEs, model cards and vendor claims,
none of it run on this hardware. Treat it as leads, never as fact.

To check whether anything there has changed: `python3 ~/Claude/hub/research/bin/check_updates.py`

<!-- research-record-pointer:end -->
