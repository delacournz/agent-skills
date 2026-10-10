---
name: dlc-ship
description: Commit the working tree with gitmoji conventional commit messages, then open a GitHub pull request for the branch in one run. Runs the repo's own pre-commit checks, splits unrelated changes into atomic commits, creates a feature branch when on the base branch, then hands off to the dlc-pr skill for push, PR title and body, and signoff. Use when the user wants to commit and open a PR in one step, ship uncommitted work, or go straight from changes to a pull request. Triggers on "ship it", "commit and PR", "commit and open a PR", "commit then PR", "/ship", "push this up for review", "commit and raise a PR".
metadata:
  author: chris@delacour.co.nz
  version: "0.1.0"
  category: git
  tags: [git, github, commit, pull-request, gh-cli, workflow]
  argument-hint: "[--no-verify] [--style=simple|full] [--type=<type>] [--draft]"
license: UNLICENSED
---

# Delacour Ship

Take uncommitted work all the way to an open pull request in one run. Phase 1 turns the working tree into clean, atomic, gitmoji conventional commits. Phase 2 hands the branch to the `dlc-pr` skill, which pushes it, writes a title and body that match the repo's conventions, and signs it off where the repo gates on signoff.

## When to Use

- When the user has uncommitted changes and wants them committed and opened as a PR
- When the user says "ship it", "commit and PR", or "push this up for review"
- When a task is finished and the next step is review on the base branch

Use `dlc-pr` on its own when the work is already committed. Use a plain commit when no PR is wanted.

## Arguments

| Argument | Effect |
| --- | --- |
| `--no-verify` | Skip the pre-commit checks in step 3. Say so in the final report. |
| `--style=simple` | Default. Single line commit subjects. |
| `--style=full` | Subject, body and footer on every commit. |
| `--type=<type>` | Force the commit type instead of detecting it. Only valid when the changes form one commit. |
| `--draft` | Passed through to `dlc-pr` to open a draft PR. |

## Rules / Steps

### Phase 1: Commit

#### 1. Preflight

```bash
gh auth status
git status --short
git branch --show-current
gh repo view --json defaultBranchRef -q .defaultBranchRef.name
```

- If `gh` is missing or not authenticated, stop before committing anything. Tell the user to install `gh` or run `gh auth login` in their own terminal. Committing first and failing at the PR step leaves the user halfway.
- If there is nothing to commit and the branch has commits ahead of the base branch, skip to Phase 2.
- If there is nothing to commit and nothing ahead of the base branch, stop and say so.

#### 2. Get off the base branch

If the current branch is the base branch, create a feature branch before committing. Never commit straight to the base branch in this flow.

- Derive a name from the change: `<type>/<short-kebab-summary>`, for example `feat/token-refresh` or `fix/issue-482-token-refresh` when an issue number is known.
- Follow any branch naming rule in `CONTRIBUTING.md`, `AGENTS.md` or `CLAUDE.md` over this default.
- `git switch -c <branch>`. Uncommitted changes carry over.

#### 3. Run the repo's pre-commit checks

Skip this step when `--no-verify` is passed.

- Detect the package manager from the lockfile (`bun.lock`, `pnpm-lock.yaml`, `yarn.lock`, `package-lock.json`) and use it. Never assume one.
- Run only scripts that exist, in this order: `lint`, `typecheck`, `test`, `build`. Check `package.json` scripts first, or the equivalent for the stack (`Makefile`, `Cargo.toml`, `pyproject.toml`).
- If the repo has a git pre-commit hook or `.pre-commit-config.yaml`, let the hook run during `git commit` instead of duplicating it.
- If a check fails, stop and fix the cause, or ask the user. Do not commit failing code and do not pass `--no-verify` to `git commit` on the user's behalf.

#### 4. Plan the commits

```bash
git diff
git diff --staged
git status --short
```

- If files are already staged, treat the staged set as the user's intended first commit and leave unstaged files for later commits.
- Group the rest into atomic commits. Split when the diff mixes:
  - a feature and an unrelated fix
  - unrelated areas of the codebase
  - dependency bumps and feature work
  - formatting-only changes and logic changes
- Keep a test with the code it tests. Keep docs with the change they describe unless they are unrelated.
- Never stage secrets, `.env` files, credentials, large binaries or build output. If any are present and not ignored, stop and ask.
- Stage by explicit path (`git add <file> ...`). Never use `git add -A` or `git add .` in this flow.

#### 5. Write the commit messages

Detect the repo's commit convention first: `commitlint.config.*`, `.commitlintrc*`, commit rules in `CONTRIBUTING.md`, `AGENTS.md` or `CLAUDE.md`, and the counted majority of the last 100 subjects on the base branch. Repo rules beat the defaults below.

Default format:

```
<gitmoji> <type>(<optional scope>): <imperative summary>
```

| Type | Gitmoji |
| --- | --- |
| `feat` | ✨ |
| `fix` | 🐛 |
| `docs` | 📝 |
| `style` | 🎨 |
| `refactor` | ♻️ |
| `perf` | ⚡️ |
| `test` | ✅ |
| `chore` | 🔧 |
| `ci` | 👷 |
| `build` | 📦 |
| `revert` | ⏪ |
| `wip` | 🚧 |

- Imperative mood, no trailing period, subject under 72 characters.
- Scope is a noun naming the area changed, matching scopes already used in history.
- Use the full style (body plus footer) for breaking changes, non-obvious fixes and changes that span systems, even when `--style=simple` is the default. The body explains what and why, wrapped at 72 characters.
- Footers: `BREAKING CHANGE: <what broke>`, `Closes #<n>` when an issue is known.
- Follow the repo's and the user's rules on attribution trailers. Do not add any the user has said to leave out.

Commit each group:

```bash
git add <paths> && git commit -m "<subject>" -m "<body>"
```

If a commit hook rewrites files, re-stage those files and create a new commit. Never `--amend` a commit that already existed before this run.

#### 6. Confirm the history

```bash
git log origin/<base>..HEAD --oneline --no-decorate
git status --short
```

The tree must be clean before Phase 2, apart from files the user chose to leave out. Show the new commits in the final report.

### Phase 2: Pull request

#### 7. Hand off to dlc-pr

Invoke the `dlc-pr` skill and follow it in full, passing `--draft` through if it was given. It owns the push, branch hygiene, convention detection, the PR title and body, signoff, and the follow-up report.

- Its step 1 dirty-tree question does not apply, since Phase 1 left the tree clean.
- Reuse what Phase 1 learned: the issue number, the change type and the commit convention. Do not ask the user for anything Phase 1 already settled.

If `dlc-pr` is not installed, stop after Phase 1, report the commits, and tell the user to install it:

```bash
bunx skills add https://github.com/UrbanChrisy/delacour-agent-skills.git --skill dlc-pr
```

#### 8. Report

One combined report:

- The branch, and whether it was created in step 2
- The commits created, one line each
- Which checks ran, which were skipped, and why
- The PR URL and the `dlc-pr` report (convention source, signoff result, anything still blocking the merge)

### Edge Cases

| Situation | Action |
| --- | --- |
| On the base branch with changes | Create a feature branch in step 2 before committing. |
| Branch has an open PR already | Commit, then let `dlc-pr` update the existing PR instead of opening a new one. |
| Pre-commit check fails | Stop. Fix or ask. Never bypass the check without `--no-verify` from the user. |
| Commit hook rejects the message | Rewrite the message to satisfy the hook and commit again. Do not skip the hook. |
| Untracked files that look unrelated | Ask whether to include them before staging. |
| Merge or rebase in progress | Stop and tell the user to finish or abort it first. |
| `--type` given but changes split into several commits | Ask whether to apply the type to all commits or detect per commit. |

## Examples

### Example: feature work on main

**Before:**

```
branch: main
changes:
  M src/auth/refresh.ts
  M src/auth/refresh.test.ts
  M package.json   (dependency bump)
```

**After:**

```
branch: feat/token-refresh (created)
commits:
  📦 build(deps): bump jose to 5.9.0
  ✨ feat(auth): refresh token before expiry window
checks: bun run lint, bun run typecheck, bun test (all passed)
PR: https://github.com/{owner}/{repo}/pull/{n}
```

The dependency bump was split from the feature, and the test stayed with the code it covers.
