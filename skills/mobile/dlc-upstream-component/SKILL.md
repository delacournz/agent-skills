---
name: dlc-upstream-component
description: Bring changes made to a vendored Delacour UI component in a consuming app back upstream into the delacour-ui repo, by writing a patch and a brief, opening a new Orca workspace on the upstream repo and handing the work to an agent there. Keeps the app copy from drifting. Use when an app copy of a component (under src/components/ui, tracked by native-components.json and native-components.lock.json) has bug fixes or new APIs that belong upstream. Triggers on "upstream this component change", "port this fix to delacour-ui", "bring these component changes upstream", "send this to the parent repo", "contribute this component fix back".
metadata:
  author: chris@delacour.co.nz
  version: "0.1.0"
  category: mobile
  tags: [delacour-ui, components, upstream, orca, handoff, workflow]
  argument-hint: "<component> [--agent=claude|codex] [--supervise]"
license: UNLICENSED
---

# Delacour Upstream Component

Send changes made to a vendored Delacour UI component back to the delacour-ui repo. The `delacour` CLI copies component source into the app, so fixes made in the app stay in the app until someone ports them. This skill finds the genuine improvements, writes a patch and a brief, creates an Orca workspace on the upstream repo, and starts an agent there to land a pull request.

The skill is project-agnostic. Never name the consuming app, client or repo in the brief, the patch or anything the upstream agent writes.

## When to Use

- When an app has fixed a bug or added an API in a component under its UI components folder
- When the user says "upstream this component change", "port this fix to delacour-ui" or "send this to the parent repo"
- When the app copy and the registry copy have drifted and the app side is better

Do not use it for app-local adaptations, or for a component that was never vendored from Delacour UI.

## Rules / Steps

### 1. Identify the changed components

Read the app's config and lock to find where components live and which registry ref each file was copied from.

```bash
cat native-components.json
cat native-components.lock.json
```

- `native-components.json` gives the component paths and aliases. `native-components.lock.json` holds a per-file `ref` and `hash`.
- Find the commit that added the component, or the last one that updated it:

```bash
git log --follow --oneline -- <dir>
git diff <added-commit>..HEAD --stat -- <dir>
```

- A file whose current hash differs from the lock `hash` was edited locally. Use that as a second signal next to the git diff.
- List every component folder with changes. Handle each one separately (see Edge Cases).

### 2. Separate local adaptations from improvements

Read the full diff and sort each hunk.

Keep local, do not send upstream:

- Icon set swaps, such as a shim that replaces the registry icon import
- Import alias changes to match the app's tsconfig paths
- Guards added to satisfy the app's own tsconfig strictness
- App copy, branding, tokens or theme values
- Anything that only makes sense with the app's other code

Send upstream:

- Bug fixes
- New props, hooks or APIs
- Accessibility, layout, animation or platform fixes
- Tests that cover the above

If a hunk is unclear, ask the user once with a short list of the unclear hunks and a proposed answer for each. Do not ask about hunks that are clearly one side or the other. If nothing is left after sorting, stop and tell the user nothing needs to go upstream.

### 3. Write the patch and the brief

Save both outside the app repo and outside the upstream repo. The upstream agent cannot read the sender's scratchpad.

```bash
mkdir -p ~/.claude/handoffs
git diff --relative=<component-dir> <from>..<to> -- <component-dir> > ~/.claude/handoffs/<component>-<slug>.patch
```

- Paths in the patch are relative to the component folder, so they do not carry the app's layout.
- Edit the patch down to the upstream-worthy hunks only. Drop the local adaptations from step 2. Check it still reads correctly on its own.
- `<slug>` is a short kebab-case summary of the change, such as `offset-api`.

Write `~/.claude/handoffs/<component>-<slug>-brief.md` with these sections:

1. What changed, one bullet per change
2. Why, the problem each change solves
3. Behaviour, the before and after as the user sees it
4. Tests that cover it, with file names
5. What was verified on a device or simulator, and how
6. What was left out on purpose (the local adaptations) so the agent does not add them back
7. Upstream rules (step 5)
8. The patch path, and the warning that the patch is a guide, not something to `git apply`

### 4. Locate the upstream repo and start the workspace

Find the delacour-ui repo through Orca.

```bash
orca open --json
orca repo list --json
```

- If Orca is not running, `orca open --json` starts it. Run it first.
- Take the repo `id` for delacour-ui from the list. Use `--repo id:<repoId>`. A `--repo path:` of a non-root worktree can fail with `repo_not_found`, so use the registered repo root if you need a path.
- Upstream components live at `packages/react-native-ui/src/components/<name>/`. The PR base is `develop`, not `main`.
- Registry copies differ from upstream source. Import paths are rewritten and `develop` may be newer. The receiving agent must port by meaning and read the whole upstream component folder first.

Create the workspace and the agent in one command:

```bash
orca worktree create \
  --repo id:<repoId> \
  --name <component>-<slug> \
  --base-branch origin/develop \
  --branch <type>/<component>-<slug> \
  --no-parent \
  --agent claude \
  --prompt "Read ~/.claude/handoffs/<component>-<slug>-brief.md and do the task it describes." \
  --json
```

- `<type>` is `fix` for bug fixes, `feat` for new API. Follow the upstream repo's branch convention if it differs.
- Use an absolute path in the prompt if the agent might not expand `~`.
- Check `result.launch.prompt.outcome`. It must be `journaled` or `handed-to-terminal`.
- If the reply was lost or the outcome is unclear, retry with the same command plus `--retry-launch <operationId>`.
- This is a full handoff. Report the worktree id and the agent handle. Do not wait for the agent.

### 5. Put the upstream rules in the brief

The brief must tell the upstream agent to:

- Read the upstream `AGENTS.md` or `CLAUDE.md` and the component's own `AGENTS.md` first, and follow them over anything here
- Read the whole upstream component folder before changing it, then port the change by meaning
- Use tabs and double quotes, and follow the package import rules
- Keep pure files pure (no React Native imports in them)
- Write tests first. Render tests are `<name>.render.test.tsx` using the package's `renderWithProviders`. Add unit tests for pure logic.
- Run `bun run test`, `bun run test:render`, typecheck and lint in the package, and fix failures
- Add `.changeset/<slug>.md`: `patch` for fixes, `minor` for a new API
- Use gitmoji conventional commits, such as `🐛 fix(react-native-ui): ...` or `✨ feat(react-native-ui): ...`
- Not sign commits locally, since GitHub signs the squash
- Not add `Co-Authored-By` or any tool attribution, in commits or the PR
- Never mention the consuming app, client or repo anywhere: code, comments, commits, changeset, PR
- Update the component's `AGENTS.md` docs and any playground or preview demo when the change fits there
- Open the PR with `gh pr create --base develop`, follow the PR template, and not merge it

If the upstream rules differ from this list, the upstream files win. Say that in the brief.

### 6. After the upstream PR merges (optional, later)

Run this when the user says the upstream PR is merged and released.

1. In the app, run `delacour update <component>`, or re-add the component, so the lock `ref` moves forward and the copy matches upstream. Use the CLI's behaviour for existing files, and check `git diff` before accepting changes.
2. Reapply only the app-local adaptations from step 2.
3. Run the app's typecheck and tests, then check the component on a device or simulator.
4. Commit the update. The lock file and component folder should show the new `ref` and `hash`.

### 7. Report

- The Orca worktree id and the agent handle
- The brief path and the patch path
- Which changes were sent upstream
- Which changes were kept app-local, with the reason for each
- That the upstream PR is not yet opened or merged, and that step 6 follows the merge

## Edge Cases

| Situation | Action |
| --- | --- |
| Several components changed | One workspace, brief and PR per component. Combine only when the changes are coupled (one needs the other to work). |
| The change also touches shared deps (overlay, pressable) | Include those files in the same brief if the component change needs them. Say which upstream folders to read. Split into a separate PR if the shared change stands alone. |
| Upstream already has the fix | Check `develop` history for the component first (`git log origin/develop -- <path>`). If it is there, skip the handoff and run `delacour update` in the app (step 6). |
| Upstream changed since the lock `ref` | Say so in the brief. The agent reconciles by meaning against current `develop`, not against the old ref. |
| The fix is app-specific | Do not upstream it. Keep it local and tell the user why. |
| Orca is not running | Run `orca open --json`, then `orca repo list --json` again. |
| `repo_not_found` on `--repo path:` | Use `--repo id:<repoId>` from `orca repo list --json`. |
| Prompt outcome is not `journaled` or `handed-to-terminal` | Retry with `--retry-launch <operationId>`. If it still fails, report the error and give the user the brief path to start manually. |
| The user wants codex, not claude | Pass `--agent codex`. Keep the same prompt. |
| The user wants to supervise, not hand off | Create the workspace without `--agent` and `--prompt`, give the user the worktree path and brief path, and stop. |
| delacour-ui is not registered in Orca | Ask the user for the local checkout path, register it with `orca repo add`, then continue. |

## Examples

### Example: toast offset API plus bug fixes

**Before:**

```
app: src/components/ui/toast/
changes since the add commit:
  toast.store.ts        new `offset` option, 3 bug fixes (dismiss timer, queue order, stale ref)
  toast.store.test.ts   tests for each fix
  toast.tsx             imports a local icon shim instead of the registry icons
```

**After:**

```
sent upstream:
  offset API, dismiss timer fix, queue order fix, stale ref fix, tests
kept local:
  icon shim import (app icon set)
files:
  ~/.claude/handoffs/toast-offset-and-fixes.patch
  ~/.claude/handoffs/toast-offset-and-fixes-brief.md
worktree: toast-offset-and-fixes (agent: claude, prompt journaled)
upstream branch: feat/toast-offset-and-fixes, base develop
```

The agent ports the changes by meaning into `packages/react-native-ui/src/components/toast/`, adds a `minor` changeset because of the new API, and opens a PR against `develop`.
