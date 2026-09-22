---
name: pr-test-section
description: Write the "Is it tested? How?" section of a che-ai-tool-images PR description. Invoke when filling in the test section — Dockerfile changes, tool version bumps, or CI/build changes.
---

# Write "Is it tested? How?"

Pick the template that matches the change, then fill in the specifics.

## Choose by change type

| Change type | Template |
|---|---|
| Tool version bump | Container build + version verify |
| Dockerfile change | Container build + smoke test |
| CI / GitHub Actions change | Workflow run verification |
| Multi-arch change | Per-arch build verification |

---

## Template 1 — Tool version bump

```
- Container image builds successfully: `podman build -f <Dockerfile> .`
- Tool version verified inside container: `podman run --rm <image> <tool> --version` returns `<expected-version>`.
- No new hadolint warnings.
```

---

## Template 2 — Dockerfile change

```
1. Build the image: `podman build -f <Dockerfile> -t <image-name>:test .`
2. Run a smoke test: `podman run --rm <image-name>:test <command>`.
3. Verify: <expected output or behavior>.
```

---

## Template 3 — CI / GitHub Actions change

```
- Workflow runs successfully on this branch (see Actions tab).
- <Specific check>: <what was verified>.
```

---

## Template 4 — Multi-arch build

```
Tested on both architectures:
- **amd64**: `podman build --platform linux/amd64 -f <Dockerfile> .` — builds successfully.
- **arm64**: `podman build --platform linux/arm64 -f <Dockerfile> .` — builds successfully.
- `podman inspect` confirms correct `OS/Arch` for each image.
```

---

## Template 5 — N/A

Use only for README updates, comment changes, or .gitignore tweaks:

```
N/A
```

---

## What NOT to write

- "Tested" with no specifics
- What the Dockerfile does — describe what the reviewer should DO and SEE
- Passive voice ("it was verified that") — write in imperative ("verify", "confirm", "run")
