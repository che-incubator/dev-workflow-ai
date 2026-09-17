---
name: analyze-issue
description: Analyze a devworkspace-generator issue. Maps to Devfile parsing, component handling, or output generation.
argument-hint: "[issue-number]"
---

# Analyze devworkspace-generator Issue

## Required input

An issue number or URL. Parse from `$ARGUMENTS`.

## Workflow

### 1. Fetch the issue

```bash
ISSUE_NUM=<parse from $ARGUMENTS>
gh issue view ${ISSUE_NUM} --repo devfile/devworkspace-generator \
  --json number,title,body,labels,assignees,comments,state
```

Check labels. Stop if `wontfix`, `duplicate`, or `stale`.

### 2. Identify the area

Map issue symptoms to source directories:

| Symptom | Directory |
|---|---|
| Devfile v2 parsing incorrect | `src/devfile/` |
| Component type not handled | `src/devfile/` — component-specific file |
| JSON schema validation error | `src/devfile-schema/` |
| Bitbucket parent resolution | `src/bitbucket/` or `src/bitbucket-server/` |
| Public API / TypeScript types | `src/api/` |

### 3. Find affected TypeScript files

```bash
cd "$LOCAL_PATH"

# Search by component type or function name
grep -r "componentTypeName\|functionName" src/ --include="*.ts" -l

# For schema-related issues
grep -r "Devfile\|schema" src/devfile-schema/ --include="*.json" -l
```

### 4. Check if JSON schema must be updated

If the issue requires supporting a new field or component:
- JSON schemas are in `src/devfile-schema/2.0.0/` and `src/devfile-schema/2.1.0/`
- Schema changes require TypeScript type updates in `src/api/`
- Set story points ≥ 3

### 5. Estimate story points

- **1**: single function fix, no schema change
- **2**: component type fix + update existing test
- **3**: new component type, new schema field, or significant new test cases

## Output

```
## Issue Analysis: #NNNN — <title>

**Area:** devfile parsing / schema / SCM integration / public API
**Type:** bug / enhancement / new component type

**Affected files:**
- src/devfile/component-handler.ts
- src/devfile/component-handler.spec.ts

**Root cause hypothesis:** <what is broken>

**Fix scope:** <what needs to change>

**Story points:** 2

**IMPLEMENT_READY: devfile/devworkspace-generator#NNNN**
```
