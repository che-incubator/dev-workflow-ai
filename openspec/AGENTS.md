# AI Agent Guidelines

See the main [AGENTS.md](../AGENTS.md) file in the project root for AI agent guidelines.

This directory (`openspec/`) contains project specifications and documentation for features under development.

## Contents

| File | Purpose |
|---|---|
| [`project.md`](project.md) | Feature list, architecture, API endpoints, database schema, security notes |

Keep `project.md` current when adding a route, a table, or a feature. It is the reference an
agent reads before touching an unfamiliar area.

## Where documentation goes

`openspec/` is for specifications — what the system should do, and designs not yet built. It is
not the user-facing manual.

| Audience | Location | Format |
|---|---|---|
| Users and operators | `docs/modules/**/pages/*.adoc` | AsciiDoc, Antora — built with `./docs/build.sh`, served at `/docs/` |
| Agents working in this repo | `AGENTS.md`, `.claude/rules/` | Markdown |
| Specifications and in-progress designs | `openspec/` | Markdown |

When a design in `openspec/` ships, fold the resulting behaviour into the Antora docs and the
root `AGENTS.md`, and update `project.md`. Do not leave shipped behaviour documented only here.
