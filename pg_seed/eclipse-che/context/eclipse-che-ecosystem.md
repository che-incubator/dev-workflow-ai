# Eclipse Che Ecosystem — AI Knowledge Base

Pre-loaded context for the dev-workflow-ai bot. Describes the structure, purpose, and key design decisions of every Eclipse Che subproject. Load this file at the start of every session before working on any subproject.

**Last snapshot date:** 2026-09-06

---

## che-dashboard

| Property | Value |
|---|---|
| GitHub | eclipse-che/che-dashboard |
| Stack | TypeScript, React 18, PatternFly 5, Redux Toolkit, Webpack, Fastify, Yarn workspaces |
| Last commit | `2b372aea73` · 2026-09-04 · test(workspace-details): improve coverage for Change Editor feature |
| Key dirs | `packages/common/`, `packages/dashboard-backend/`, `packages/dashboard-frontend/` |
| Why PatternFly 5 | Red Hat design system; enterprise accessibility compliance built-in |
| Why monorepo | Avoids publishing overhead; shared types in `common/` used by both frontend and backend |
| Why Fastify | Lightweight Node.js server for proxying k8s API calls; plugin ecosystem for auth |

**Role:** Web UI — workspace management, factory flows (create workspace from Git repo), user preferences (git config, SSH keys, PATs, container registries, AI provider keys, device auth tokens), AI tools integration, workspace backup/restore, DevWorkspace API client.

**Backend:** Fastify server proxies all Kubernetes API calls. Uses `@kubernetes/client-node` for DevWorkspace CRDs, Core V1 (Secrets, ConfigMaps, Pods), and Custom Objects (CheCluster, DevWorkspaceTemplates). WebSocket relay for real-time workspace status and logs.

**Frontend state:** Redux Toolkit slices: `workspaces`, `devWorkspaces`, `preferences`, `aiTools`, `branding`, `infrastructureNamespaces`, `gitConfig`, `sshKeys`, `personalAccessTokens`, `containerRegistries`.

---

## che-server

| Property | Value |
|---|---|
| GitHub | eclipse-che/che-server |
| Stack | Java 17, Quarkus, Maven |
| Last commit | `cb5afc8de1` · 2026-07-24 · feat(oauth): expose clientId in OAuthAuthenticatorDescriptor |
| Key dirs | `wsmaster/` (workspace lifecycle), `core/` (common infra), `infrastructures/` (k8s/openshift), `deploy/` (operator templates) |
| Why Quarkus | Fast container startup; CDI injection; enterprise Java with low memory footprint |
| Why Maven | Established Java build tool; checkstyle integration; multi-module support |

**Role:** Che API server — user authentication, OAuth flows, workspace lifecycle backend, Kubernetes infrastructure integration. Exposes REST API consumed by che-dashboard and CLI tools.

---

## che (umbrella)

| Property | Value |
|---|---|
| GitHub | eclipse-che/che |
| Stack | GitHub Actions, Shell scripts, YAML |
| Last commit | `adf4048f3e` · 2026-04-22 · chore: add Claude CLI install command to devfile |
| Key dirs | `.github/workflows/`, `tests/`, `devfile.yaml` |
| Why umbrella | Central release coordination; cross-repo version alignment; E2E test runner |

**Role:** Umbrella repo for Eclipse Che — release automation, cross-repo CI/CD, E2E test orchestration, devfile for Che development workspace. Issues here often affect multiple subprojects.

---

## che-ai-tool-images

| Property | Value |
|---|---|
| GitHub | che-incubator/che-ai-tool-images |
| Stack | Dockerfile, Shell, GitHub Actions |
| Last commit | `a3b810eb57` · 2026-08-26 · fix: bump AI tool CLI versions to latest |
| Key dirs | One directory per AI tool (e.g., `opencode/`, `gemini/`, `claude/`) |
| Why separate repo | Decouples AI tool versioning from dashboard release cycle; independent update cadence |
| Why multi-arch | Che runs on both amd64 clusters and arm64 Mac/cloud nodes |

**Role:** Container images for AI tools bundled into Che workspaces — OpenCode, Gemini CLI, Claude CLI, etc. Each image pins the tool version explicitly. CI builds and pushes multi-arch images on every tag.

---

## devworkspace-generator

| Property | Value |
|---|---|
| GitHub | devfile/devworkspace-generator |
| Stack | TypeScript, Node.js |
| Last commit | `c7c9ba2478` · 2026-03-16 · chore: update devfile and add CONTRIBUTING.md |
| Key dirs | `src/` (generator logic), `tests/` |
| Why TypeScript | Type-safe Devfile parsing; shared type definitions with che-dashboard |

**Role:** Converts Devfile v2 specs into DevWorkspace Kubernetes resources. Used by che-dashboard (factory flow) and che-server (workspace creation). Single source of truth for Devfile → DevWorkspace conversion logic.

---

## dash-licenses

| Property | Value |
|---|---|
| GitHub | che-incubator/dash-licenses |
| Stack | Java, Maven |
| Last commit | `1bd84e94f0` · 2026-08-23 · ci: release 2.0.1 |
| Key dirs | `src/` (Eclipse Dash wrapper), `scripts/` |
| Why Java | Wraps Eclipse Dash tooling which is Java-based |

**Role:** Eclipse Dash license checker for npm and Maven dependencies. Validates license compatibility with EPL-2.0. Called by `yarn license:generate` in che-dashboard. Issues here affect all Eclipse Che projects that need license validation.

---

## che-docs

| Property | Value |
|---|---|
| GitHub | eclipse-che/che-docs |
| Stack | AsciiDoc, Antora, Vale linter |
| Last commit | `ede3e33ca5` · 2026-08-13 · procedures: add Device Auth Tokens documentation |
| Key dirs | `modules/` (Antora modules), `antora-playbook.yml` |
| Why Antora | Eclipse Foundation standard docs toolchain; modular versioned docs |
| Why AsciiDoc | Rich formatting; includes; conditionals for product variants (Che vs DevSpaces) |

**Role:** Official Eclipse Che documentation — installation, configuration, user guides, API references. Published at docs.eclipse.org/che. Issues here are documentation gaps or inaccuracies. Max 1 story point per doc-only issue.

---

## devworkspace-operator

| Property | Value |
|---|---|
| GitHub | devfile/devworkspace-operator |
| Stack | Go 1.21+, Operator SDK, kubebuilder, Kubernetes |
| Last commit | `943ae8e461` · 2026-04-15 · fix: fall back to canonical backup auth secret name on restore |
| Key dirs | `controllers/` (reconcilers), `pkg/` (library code), `apis/` (CRD types) |
| Why Go | Native Kubernetes operator language; Operator SDK toolchain |
| Why Operator SDK | Code generation for CRDs; controller-runtime integration |

**Role:** Kubernetes operator for DevWorkspace custom resources — starts/stops workspace pods, manages pod scheduling, handles backup/restore of workspace state. Its CRDs are the API consumed by both che-dashboard (read workspace status) and che-server (create/delete workspaces).

---

## devfile/api

| Property | Value |
|---|---|
| GitHub | devfile/api |
| Stack | Go, JSON Schema |
| Last commit | fetch on clone |
| Key dirs | `pkg/apis/workspaces/` (Go types), `schemas/` (JSON Schema) |
| Why JSON Schema | Language-agnostic Devfile validation; auto-generates Go types and TypeScript interfaces |

**Role:** Devfile v2 specification — defines the schema for Devfile, the CRD types for DevWorkspace, and Go types used by devworkspace-operator and devworkspace-generator. Single source of truth for the Devfile format.

---

## Dependency Graph

```
devfile/api
  └─► devworkspace-operator  (consumes CRD types from api)
  └─► devworkspace-generator (consumes Devfile schema)

devworkspace-operator
  └─► che-server             (che-server creates/reads DevWorkspace CRs)
  └─► che-dashboard          (dashboard reads workspace status via DWO CRDs)

devworkspace-generator
  └─► che-dashboard          (factory flow converts Devfiles → DevWorkspaces)
  └─► che-server             (workspace creation pipeline)

dash-licenses
  └─► che-dashboard          (yarn license:generate calls dash-licenses)
  └─► che-server             (Maven license validation)

che-ai-tool-images
  └─► che-dashboard          (AI tools tab references image tags)
  └─► che (umbrella)         (release coordination)

che-server
  └─► che-dashboard          (dashboard is the UI for che-server API)

che (umbrella)
  └─► all repos              (release coordination, E2E tests)
```

**Key constraint:** Changes to devfile/api schema propagate to devworkspace-operator (Go types), devworkspace-generator (TypeScript types), and ultimately che-dashboard (Devfile editor). Coordinated releases required for API-breaking changes.
