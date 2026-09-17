---
repo: devfile/devworkspace-generator
default_branch: main
stack: [TypeScript, Node.js, Yarn]
description: Converts Devfile v2 specs into DevWorkspace Kubernetes resources
auto_approve_min_priority: major
story_point_budget: 3
local_path: .repos/devfile/devworkspace-generator
commands:
  test: "yarn test 2>&1 | tail -30"
  lint: "yarn lint 2>&1 | tail -20"
  format: "yarn format:fix 2>&1 | tail -10"

---
# devworkspace-generator — AI Context File

> Load this file BEFORE any devworkspace-generator implementation work.
> Also load: context/eclipse-che-ecosystem.md

Last commit: `c7c9ba247` · 2026-03-16 · chore: update devfile and add CONTRIBUTING.md
GitHub: `devfile/devworkspace-generator`

---

## Role

TypeScript library that converts **Devfile v2** YAML into **DevWorkspace Kubernetes resources**. Used by both che-dashboard (via backend) and che-server when resolving factory URLs and creating workspaces.

---

## Directory Structure

```
devworkspace-generator/
└── src/
    ├── api/                    # Public TypeScript API — main entry points for callers
    │   └── index.ts            # Exported public API
    ├── devfile/                # Devfile v2 parsing, validation, and transformation
    │   ├── devfile-context.ts  # Devfile parsing context
    │   └── ...                 # Component resolvers, inheritance, etc.
    ├── devfile-schema/         # JSON schemas for validation
    │   ├── 2.0.0/              # Devfile 2.0.0 JSON schema
    │   └── 2.1.0/              # Devfile 2.1.0 JSON schema
    ├── bitbucket/              # Bitbucket Cloud SCM integration
    │   └── ...                 # Fetch parent Devfiles from Bitbucket
    └── bitbucket-server/       # Bitbucket Server SCM integration
```

---

## Key Concepts

### Input → Output

```
Devfile v2 YAML
    ↓
devworkspace-generator
    ↓
DevWorkspace CR YAML (Kubernetes resource)
```

### Devfile Component Types Handled

| Component type | Description |
|---|---|
| `container` | Development container (the main workspace pod container) |
| `kubernetes` | Inline Kubernetes resource (applied to namespace) |
| `openshift` | OpenShift-specific resource |
| `plugin` | Editor plugin (VS Code extension, Che plugin) |
| `image` | Image build definition |

### Parent Devfile Resolution

Devfiles can extend a parent (inheritance). The generator fetches the parent Devfile from:
- A registry URL
- A Git repository (GitHub, GitLab, Bitbucket, Bitbucket Server)
- An inline definition

The `bitbucket/` and `bitbucket-server/` directories implement SCM-specific fetching.

---

## Build Commands

```bash
yarn install
yarn build        # Compile TypeScript to lib/
yarn test         # Run Jest tests
yarn lint         # Run ESLint
yarn license:generate  # REQUIRED after package.json changes
```

---

## Coding Rules

- **TypeScript strict** — no `any` type
- **`yarn license:generate`** after any `package.json` change
- **Conventional commits** + `Assisted-by:` trailer
- **Unit tests** for new Devfile parsing logic

---

## Common Issue Areas

| Issue type | Start here |
|---|---|
| Devfile parsing bug | `src/devfile/` — find the component type handler |
| Parent resolution bug | `src/devfile/devfile-context.ts` |
| Bitbucket fetch bug | `src/bitbucket/` or `src/bitbucket-server/` |
| Public API change | `src/api/index.ts` |
| JSON schema validation | `src/devfile-schema/` |
