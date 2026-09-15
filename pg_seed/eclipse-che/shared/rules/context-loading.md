# Context Loading Rules — Minimize Token Usage

## The Rule

**Always load pre-built context files instead of reading source code.**

Context files contain everything needed to start implementing. Reading source files wastes tokens and produces worse results (incomplete picture). The context files are the single source of truth for AI implementation sessions.

---

## Loading Order (mandatory)

1. **Ecosystem context** (always first):
   ```
   Read: context/eclipse-che-ecosystem.md
   ```

2. **Project context** (always second):
   ```
   Read: projects/<name>/context.md
   ```

3. **UI context** (only for che-dashboard frontend work):
   ```
   Read: projects/che-dashboard/context-patternfly.md
   ```

4. **Project rules** (before implementing):
   ```
   Read: projects/<name>/rules/dev.md
   ```

5. **Rules.json** (for issue filtering/scoring):
   ```
   Read: pg_seed/eclipse-che/projects.json
   ```

Load with the `Read` tool — do NOT use `Bash(cat ...)` or `Bash(find ...)`.

---

## What NOT to Do

| Forbidden | Use instead |
|---|---|
| `find src/ -name "*.ts"` | `Read projects/che-dashboard/context.md` — dir structure is already there |
| `cat packages/dashboard-frontend/src/store/*/index.ts` | Redux slices are listed in context.md |
| `ls packages/dashboard-backend/src/routes/api/` | Backend routes are listed in context.md |
| `grep -r "createSlice" packages/` | Redux slice names are in context.md |
| Traverse `node_modules/`, `vendor/`, `target/` | Never — always gitignored/generated |
| Re-read a file you just read this session | Already in context window |

---

## When Source Reading IS Allowed

Only read source files when:

1. **Implementing a specific fix** — you know exactly which file from context.md:
   ```
   Read: packages/dashboard-frontend/src/store/SshKeys/index.ts
   ```

2. **Verifying a detail** not covered in context.md (type signature, exact prop name):
   ```
   Read: packages/dashboard-frontend/src/components/SomeComponent/index.tsx
   ```

3. **A test file** for the component you're modifying:
   ```
   Read: packages/dashboard-frontend/src/components/SomeComponent/__tests__/index.spec.tsx
   ```

**Rule:** Read the minimum necessary — context.md tells you WHICH file; read that file, not the directory.

---

## Token Budget Targets

| Phase | Context files loaded | Source files read |
|---|---|---|
| Issue analysis | ecosystem.md + project/context.md | 0 |
| Implementation | ecosystem.md + context.md + rules/dev.md | 2–5 specific files |
| Review | ecosystem.md + context.md + rules/dev.md | diff only |

---

## Keeping Context Files Current

Context files go stale when the codebase changes. Update them when:

- A new Redux slice is added → update `projects/che-dashboard/context.md` (Store Slices table)
- A new backend route is added → update backend routes table
- A new component is added → update component list
- Stack version changes (PatternFly, Java, Go) → update context file header

To update: read the file, apply the change with the Edit tool — do NOT rewrite from scratch.

---

## Completion Marker Pattern (prevent redundant re-loading)

After loading context, output a marker so downstream commands know it's done:

```
CONTEXT_LOADED: che-dashboard · 2b372aea73
```

Commands that depend on context loaded (implement, review) check for this marker before running. If absent → load context first.
