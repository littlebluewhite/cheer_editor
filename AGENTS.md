## Agent skills

### Issue tracker

GitHub Issues, via `gh`. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical labels, names unchanged. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `GLOSSARY.md` plus `docs/adr/`. See `docs/agents/domain.md`.

## Reference docs

- **流程檔** format (`flow.json`, `src/lib/core/flow-file.ts`, `FORMAT_VERSION`): `docs/flow-file-format.md`. A format change updates this doc in the same commit.
- **使用說明** (`src/routes/guide/`) and its diagrams; an editor UI change also retakes the guide screenshots: `docs/guide-diagrams/README.md`.
- `server/` (run, test, `server/migrations/`, generated `src/lib/api-types/`, logs), deploy, secrets, rollback, R2 music, link or asset paths (`BASE_PATH`), offline, app icons, licences: `docs/deploy.md`.
- Research behind a decision: cheerleading facts (rules, roles, floor sizes, beat cues), backend choices (hosting, auth, sharing, concurrent edits, ops), browser limits, UX findings: `docs/research/`.
