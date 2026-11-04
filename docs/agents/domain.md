# Domain Docs

Before exploring, read `GLOSSARY.md` and the ADRs in `docs/adr/` that touch the area you're working in.

## Use the glossary's vocabulary

When your output names a domain concept (an issue title, a refactor proposal, a hypothesis, a test name), use the term as `GLOSSARY.md` defines it. Each term's `_Avoid_` line lists the synonyms to leave out.

A concept missing from the glossary is a signal: either you're inventing language the project doesn't use (reconsider), or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

When your output contradicts an ADR, say so explicitly:

> _Contradicts ADR-0004 (走位用出發和到達), but worth reopening because…_
