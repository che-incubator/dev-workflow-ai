# dev-workflow-ai Development Conventions

---

## 1. Commit Trailers

Only these trailers are permitted:

```
Assisted-by: {AGENT_NAME}
Signed-off-by: {AUTHOR_NAME} <{AUTHOR_EMAIL}>
```

`{AGENT_NAME}` — specific agent name, e.g. `Claude Sonnet 4.6`.  
`{AUTHOR_NAME}` / `{AUTHOR_EMAIL}` — from `git config user.name` / `git config user.email`.

**Do NOT add:** `Made-with`, `Co-authored-by`, or duplicate trailers.  
**Do NOT add** AI explanation comments inside source code.  
**On amend:** always pass the full message with `-m "..."` so trailers are not stacked.

### Commit message format

- Subject line ≤ 50 chars, conventional commits: `type(scope): short description`
- Common types: `fix`, `feat`, `chore`, `refactor`, `test`, `docs`

### Example

```
fix(ui): prevent error message from overflowing the ErrorReporter widget

Assisted-by: Claude Sonnet 4.6
Signed-off-by: Jane Developer <jane@example.com>
```

---

## 2. Pre-commit Checks

**Before each commit** (fast — run every time):

```bash
yarn lint:fix
yarn format:fix
```

**Before pushing / opening a PR** (full suite):

```bash
yarn build
yarn test
```

**This is mandatory for ALL branches, including pure dependency upgrades.** Dep upgrades routinely cause test suite failures (new API shapes, changed exports, peer dep mismatches) that only appear in CI if not caught locally first. Always run `yarn build && yarn test` before any `git push`.

Follow the Surgical Change Workflow in `AGENTS.md` — targeted test runs before commit, full suite before push.

---

## 3. Dependency Changes — License Regeneration

When `package.json` or `yarn.lock` changes:

```bash
yarn license:generate
```

If it exits with **"UNRESOLVED dependencies"**, add the missing package to `.deps/EXCLUDED/dev.md` (dev dep) or `.deps/EXCLUDED/prod.md` (runtime dep):

```markdown
| `package-name@X.Y.Z` | [clearlydefined](https://clearlydefined.io/definitions/npm/npmjs/-/package-name/X.Y.Z) |
```

Then re-run `yarn license:generate`. Remove entries for packages no longer in `yarn.lock`.

---

## 4. CSS Property Ordering

This project uses `stylelint-config-clean-order`. Follow these group conventions:

| Group | Properties |
|-------|-----------|
| Layout | `position`, `z-index`, `overflow`, `overflow-x`, `overflow-y`, `display`, `flex-*`, `grid-*` |
| Box/Size | `box-sizing`, `width`, `min-width`, `max-width`, `height`, `margin`, `padding` |
| Typography | `font-*`, `color`, `text-*`, `word-break`, `white-space`, `line-height` |
| Visual | `background`, `background-color`, `border*`, `border-radius`, `box-shadow` |
| Animation | `transition`, `animation` |

- Empty lines **between groups** when rule has ≥ 5 properties
- **No empty lines within a group**

---

## 5. Project Specification Updates

When implementing new features or API changes:

1. **After code changes are committed**, update `openspec/project.md` to reflect the new feature:
   - Add feature to the "Core Features" section if it's a major capability
   - Update API Endpoints section if new routes are added
   - Update Database Schema section if new tables or fields are introduced
   - Update Architecture section if new modules or components are added
   - Add new features to "Features Under Development" section if they're planned/in-progress

2. **Specification is the source of truth** for feature documentation, so keep it current as the codebase evolves:
   - New database table → add table name and purpose to schema section
   - New API endpoint → add endpoint path, method, and description
   - New backend node → add to Architecture → Backend section
   - New frontend page → add to Architecture → Frontend section

3. **Before closing a work item**, verify that `openspec/project.md` accurately reflects the completed feature. Out-of-date specs create confusion for future contributors.

---
