---
name: pr-test-section
description: Write the validation/test checklist items for a che-docs PR description. Invoke when filling in the Pull Request checklist — procedure testing, vale validation, or link redirection checks.
---

# Write Pull Request Checklist — che-docs

The che-docs template uses a checklist instead of a "Is it tested?" section. Fill in the relevant items.

## Choose by change type

| Change type | Checklist items to check |
|---|---|
| New procedure | Successfully tested + builds + vale passes |
| Page/link rename | Redirection added + dashboard branding updated + builds |
| Content update (no procedure) | Builds + vale passes |
| Fix (build, language, links) | Builds + vale passes |
| Version bump / tooling | Builds |

---

## Template 1 — Procedure (must be tested)

```
- Any procedure:
  - [x] Successfully tested.
- [x] Builds on Eclipse Che hosted by Red Hat.
- [x] The *Validate language on files added or modified* step reports no vale warnings.
```

Add a brief description of how the procedure was tested:

```
Tested the procedure on Eclipse Che hosted by Red Hat:
1. <step performed>
2. <outcome verified>
```

---

## Template 2 — Page or link rename

```
- Any page or link rename:
  - [x] The page contains a redirection for the previous URL.
  - Propagate the URL change in:
    - [x] Dashboard default branding data
- [x] Builds on Eclipse Che hosted by Red Hat.
- [x] The *Validate language on files added or modified* step reports no vale warnings.
```

---

## Template 3 — Content update (no procedure)

```
- [x] Builds on Eclipse Che hosted by Red Hat.
- [x] The *Validate language on files added or modified* step reports no vale warnings.
```

---

## Template 4 — N/A (tooling, chore)

```
- [x] Builds on Eclipse Che hosted by Red Hat.
```

---

## What NOT to write

- Unchecked items that don't apply — remove them entirely
- "Tested" without describing what was tested
- The raw template comments
