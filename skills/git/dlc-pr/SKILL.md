---
name: dlc-pr
description: Create a GitHub pull request following project conventions using the gh CLI. Use when the user asks to create a PR, open a pull request, raise a PR, submit changes for review, or ship a branch. Handles prerequisite checks, branch and commit hygiene, issue linking, PR template usage, draft PRs, and post-creation follow-up. Triggers on "create a PR", "open a pull request", "/pr", "submit for review", "push and PR".
metadata:
  author: chris@delacour.co.nz
  version: "0.1.0"
  category: git
  tags: [git, github, pull-request, gh-cli, workflow]
license: UNLICENSED
---

# Delacour Pull Request Creator

Create a well structured GitHub pull request from the current branch. This skill covers prerequisite checks, context gathering, branch hygiene, template compliant PR body authoring, and creation via the `gh` CLI.

## When to Use

- When the user asks to create, open, or raise a pull request
- When the user says their branch is ready for review or ready to ship
- When the user asks to push a feature branch and get it reviewed
- When a task is complete and the changes need to land on the base branch

Do not use this skill for committing work only. Commit first, then run this skill.

## Rules / Steps

### 1. Verify prerequisites

Run these checks before anything else.

```bash
gh --version
gh auth status
git status --short
```

- If `gh` is missing, tell the user to install it (`brew install gh` on macOS, otherwise https://cli.github.com/) and stop.
- If `gh auth status` fails, tell the user to run `gh auth login` in their own terminal and stop. Do not attempt an interactive login.
- If the working tree is dirty, ask the user whether to commit the changes into this PR, stash them, or leave them behind. Never discard changes without explicit confirmation.

### 2. Gather context

```bash
git branch --show-current
git remote show origin | grep "HEAD branch"
git log origin/<base>..HEAD --oneline --no-decorate
git diff origin/<base>..HEAD --stat
```

- If the current branch is the base branch (`main` or `master`), stop and ask the user to create a feature branch first.
- If there are no commits ahead of the base branch, stop and ask whether they meant a different branch.
- Read the commits and the diff stat to understand scope, change type, and which areas of the codebase are affected.

### 3. Infer the required information before asking

Derive as much as possible from the repository itself:

| Information | Where to look |
| --- | --- |
| Related issue number | `#123`, `fixes #123`, `closes #123` in commit messages, or the branch name (`fix/issue-123`) |
| Change type | Gitmoji or conventional commit prefixes, plus the diff |
| Description | Commit bodies and the diff |
| Test procedure | Test files in the diff, CI config, project test command |

Only ask the user for what cannot be inferred, and ask everything in a single round of questions. If no issue exists, use `N/A` rather than blocking.

### 4. Apply branch hygiene

- Fetch and check whether the branch is behind the base branch:

  ```bash
  git fetch origin
  git log --oneline HEAD..origin/<base>
  ```

- If it is behind, offer to rebase (`git rebase origin/<base>`). Do not rebase without confirmation.
- If the history contains noisy WIP commits, offer an interactive rebase. Only suggest this when the user is clearly comfortable with rewriting history, and never run it unprompted.
- Push the branch:

  ```bash
  git push -u origin HEAD
  ```

  After a rebase, use `git push --force-with-lease origin HEAD`. Never use plain `--force`.

### 5. Write the PR body to a file

Check for a template in this order and use the first match:

1. `.github/pull_request_template.md`
2. `.github/PULL_REQUEST_TEMPLATE.md`
3. `.github/PULL_REQUEST_TEMPLATE/` (pick the matching template, or ask if several apply)

If a template exists, match its structure exactly. Do not add, remove, or reorder sections. Fill every section, tick the correct change type boxes, and complete the checklist items that apply.

If no template exists, use this default body:

```markdown
## Summary

<one or two sentences on what this changes and why>

## Related Issue

Closes #123

## Changes

- <change one>
- <change two>

## Type of Change

- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Refactor
- [ ] Documentation
- [ ] Chore / tooling

## Test Plan

<how this was verified, including commands run and their result>

## Risk

<what could break, and anything reviewers should look at closely>
```

Always write the body to a temporary file rather than passing it inline. Inline markdown with newlines, backticks, and checkboxes is fragile in a shell. Use the session scratchpad directory when one is available, otherwise `.git/pr-body.md`.

### 6. Title the PR

Match the repository's existing PR titles (`gh pr list --limit 20` shows the convention). If the repo uses gitmoji conventional commits, follow that format:

```
✨ feat(auth): add passwordless email sign in
```

Keep the title under 72 characters, imperative mood, no trailing period.

### 7. Create the PR

```bash
gh pr create --title "<title>" --body-file <body-path> --base <base>
```

Add `--draft` when the work is incomplete, when the user asks for a draft, or when CI is expected to fail on the first push.

Delete the temporary body file afterwards.

### 8. Report and follow up

- Print the PR URL returned by `gh pr create`.
- Mention that CI checks will run automatically.
- Offer, without running them unprompted:
  - `gh pr edit --add-reviewer <username>`
  - `gh pr edit --add-label "<label>"`
  - `gh pr checks --watch`

### Edge Cases

| Situation | Action |
| --- | --- |
| No commits ahead of base | Stop. Ask whether the user meant a different branch. |
| Branch not on remote | Push with `git push -u origin HEAD` before creating the PR. |
| PR already exists for the branch | Run `gh pr view --json url,title,state`. Show it and ask whether to update the existing PR (`gh pr edit`) instead of creating a new one. |
| Merge conflicts with base | Stop and guide the user through the rebase. Do not resolve conflicts silently. |
| Fork based workflow | Confirm the target repo. Use `gh pr create --repo <upstream> --head <user>:<branch>`. |
| No `origin` remote | Ask the user for the correct remote name and use it throughout. |
| Repo has no base branch detected | Fall back to `gh repo view --json defaultBranchRef -q .defaultBranchRef.name`. |

## Examples

### Example: branch with an inferable issue number

**Before:**

```
branch: fix/issue-482-token-refresh
commits:
  🐛 fix(auth): refresh token before expiry window
  ✅ test(auth): cover expired token path
```

**After:**

```
Title: 🐛 fix(auth): refresh token before expiry window
Body:  Closes #482, change type "Bug fix" ticked, test plan lists `bun test src/auth`
Command: gh pr create --title "🐛 fix(auth): refresh token before expiry window" \
  --body-file <scratchpad>/pr-body.md --base main
```

No questions were asked because the issue number came from the branch name, the change type came from the gitmoji prefix, and the test plan came from the test file in the diff.

### Example: unclear scope

**Before:**

```
commits:
  🚧 wip
  🚧 wip 2
  🚧 more
```

**After:**

Ask one round of questions covering the issue number, what the change does, and how it was tested. Offer an interactive rebase to squash the WIP commits before pushing.
