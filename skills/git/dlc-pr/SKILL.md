---
name: dlc-pr
description: Create a GitHub pull request following project conventions using the gh CLI, matching any repo-supplied rules for PR titles and descriptions (commitlint, semantic PR title actions, PR templates, contributor docs) and falling back to gitmoji conventional commit titles. Use when the user asks to create a PR, open a pull request, raise a PR, submit changes for review, or ship a branch. Handles prerequisite checks, branch and commit hygiene, issue linking, convention detection, PR template usage, title formatting, draft PRs, signing off the PR when the repo gates on gh-signoff, and post-creation follow-up. Triggers on "create a PR", "open a pull request", "/pr", "submit for review", "push and PR".
metadata:
  author: chris@delacour.co.nz
  version: "0.5.0"
  category: git
  tags: [git, github, pull-request, gh-cli, workflow]
license: UNLICENSED
---

# Delacour Pull Request Creator

Create a well structured GitHub pull request from the current branch. This skill covers prerequisite checks, context gathering, branch hygiene, template compliant PR body authoring, creation via the `gh` CLI, and signing off the result in repos that gate on local CI.

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

### 5. Detect the repo's own PR conventions

**Repo-supplied rules always beat this skill's defaults - for the title and the description alike.** Before writing either, find out what the repo states about them. In a monorepo, check the workspace root of the changed code as well as the repo root; the nearest config to the change wins.

Precedence, highest first:

1. Machine-enforced config (CI fails without it)
2. Written contributor docs (`CONTRIBUTING.md`, `AGENTS.md`, `CLAUDE.md`, `docs/`)
3. The de facto convention across the base branch's history - a **counted majority over at least 100 titles**, never the most recent handful
4. The defaults in this skill

Discovery:

```bash
# title rules
ls .commitlintrc* commitlint.config.* .czrc .versionrc* release-please-config.json .changeset/config.json .github/semantic.yml 2>/dev/null
rg -l "semantic-pull-request|pr-title|pr-lint|title-check|commitlint|conventional" .github 2>/dev/null
rg -n "\"commitlint\"" package.json 2>/dev/null

# rules for both, in prose
rg -n -i "pull request|pr title|pr description|commit message" CONTRIBUTING.md AGENTS.md CLAUDE.md docs 2>/dev/null

# body rules enforced by bots
rg -l "dangerfile|Danger|pr-body|body-check|task-list|checklist" .github dangerfile* 2>/dev/null

# de facto convention when nothing is configured - sample DEEP, and COUNT
# (squash-merge repos put the merged PR title straight into the base branch log,
#  so git log is both cheaper and deeper than the API)
GITMOJI='^(✨|🐛|📝|🎨|♻️|⚡️|✅|🔧|👷|📦|⏪|🚀|🚨|💚|⬆️|⬇️|🔥|🚧|🩹|💄|🔒️)'
git log origin/<base> --format='%s' | head -100 > /tmp/pr-titles.txt
grep -cE "$GITMOJI" /tmp/pr-titles.txt   # gitmoji count out of the last 100
wc -l < /tmp/pr-titles.txt               # denominator
cat /tmp/pr-titles.txt                   # read them, do not just count
```

**A sample of 20 is not evidence.** A repo that has used gitmoji for two years can easily show a dozen consecutive prose titles at the top of the log - one contributor, one sprint, one bad week - and a shallow sample reads that run as the house style. Count over 100 and use the ratio, not the first screenful.

What each source dictates:

| Source | What to take from it |
| --- | --- |
| commitlint config (`.commitlintrc*`, `commitlint.config.*`, `package.json#commitlint`) | `type-enum` (allowed types), `scope-enum` and `scope-empty` (which scopes, whether one is required), `subject-case`, `header-max-length`, `header-pattern` |
| `amannn/action-semantic-pull-request` in a workflow | `types`, `scopes`, `requireScope`, `subjectPattern`, `validateSingleCommit` |
| `.github/semantic.yml` | Allowed types, and whether the check applies to the title, the commits, or both |
| release-please / changesets / semantic-release config | The types that drive versioning - never invent a type outside that set |
| Contributor docs | Prose rules: prefixes, ticket keys (`ABC-123`), required sections, forbidden phrasing |
| Danger / body-lint workflows | Sections or strings the description must contain (`Closes #`, a test plan heading, a ticked checklist) |
| Merged PR titles | The shape to copy when nothing above exists **and** a counted majority of 100 agrees on it |

Apply what you find literally:

- If the repo restricts types, use only those types, even when a gitmoji type in this skill's table fits better.
- Drop the gitmoji **only** when a machine-enforced pattern has no room for it (a `subjectPattern`/`header-pattern` anchored on `^type`), or when *fewer than 20 of 100* sampled titles carry one. A recent run of bare titles is not a reason - see the threshold in step 7.
- If a header max length is configured, respect it over this skill's 72 character guidance.
- If a scope enum exists, pick a scope from it. If `requireScope`/`scope-empty` demands one, never omit it.
- If a ticket key is required in the title or body, take it from the branch name or commits, and ask only if it cannot be inferred.

When repo rules and this skill's defaults conflict, follow the repo and say so in the final report.

### 6. Write the PR body to a file

**If the repo has a PR template, always use it.** It is the repo's stated contract for what a PR description must contain, and reviewers and automation may depend on its sections. Never substitute your own format, and never fall back to the default body below while a template exists. Layer any description rules found in step 5 on top of the template - a template and a documented rule are cumulative, not alternatives.

Search for one before writing anything, and use the first match:

1. `.github/pull_request_template.md`
2. `.github/PULL_REQUEST_TEMPLATE.md`
3. `.github/PULL_REQUEST_TEMPLATE/` (pick the matching template, or ask if several apply)
4. `docs/pull_request_template.md` or a `pull_request_template.md` at the repo root

```bash
ls .github/pull_request_template.md .github/PULL_REQUEST_TEMPLATE.md docs/pull_request_template.md pull_request_template.md 2>/dev/null
ls .github/PULL_REQUEST_TEMPLATE/ 2>/dev/null
```

When a template is found, read it in full and:

- Match its structure exactly. Do not add, remove, rename, or reorder sections.
- Keep its HTML comments and instructions only if the template clearly expects them to stay. Otherwise replace the placeholder text with real content.
- Fill every section. If a section genuinely does not apply, write `N/A` with a short reason rather than deleting it.
- Tick the correct change type boxes and complete the checklist items that apply. Leave unticked anything you have not actually verified.
- Keep the template's own issue reference syntax rather than inventing your own.

Use the default body below **only** when no template exists anywhere in the repo and step 5 turned up no description rules:

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

### 7. Title the PR

**If step 5 found title rules, follow them and skip the rest of this section.** The rules below are the fallback for a repo that states nothing.

PR titles are gitmoji conventional commits. The title becomes the squash commit subject on merge, so it has to read well in `git log`.

```
<emoji> <type>(<scope>): <description>
```

Rules:

1. **Always lead with the emoji.** No exceptions, no bare `feat:` titles.
2. **The emoji must match the type.** Use the table below, never a mismatched pair like `📝 fix(...)`.
3. **Scope is the app or package the change belongs to**, lowercase, singular, matching the directory name (`outpost`, `nimbus`, `web`, `ci`, `jobs`, `infra`, `release`, `brand`, `tauri`). Omit the scope only when the change genuinely spans the whole repo.
4. **Description is lowercase, imperative, and says what the change does for a user or developer**, not which files moved. Prefer "retire rows one by one as each thread is marked done" over "update thread list logic".
5. **No trailing period.** Aim for under 72 characters, but a longer title that stays specific beats a short vague one.
6. **Do not type the PR number.** GitHub appends `(#123)` when the PR is squash merged.

| Type | Emoji | Use for |
| --- | --- | --- |
| `feat` | ✨ | New capability |
| `fix` | 🐛 | Broken behaviour corrected |
| `docs` | 📝 | Documentation and copy |
| `style` | 🎨 | Visual and formatting changes with no behaviour change |
| `refactor` | ♻️ | Restructuring with no behaviour change |
| `perf` | ⚡️ | Performance work |
| `test` | ✅ | Tests |
| `chore` | 🔧 | Tooling, config, maintenance |
| `ci` | 👷 | CI pipeline changes |
| `build` | 📦 | Build system and packaging |
| `revert` | ⏪ | Reverting a previous change |

Titles that follow the pattern:

```
✨ feat(outpost): show today's agenda in the menu-bar tray
🐛 fix(infra): pin railpack to the node provider so builds still get bun
🎨 style(outpost): distinguish the selected row from unread rows
♻️ refactor(rust): share one cargo workspace across the tauri apps
🔧 chore(ci): cut desktop releases from release/* branches instead of main
```

Titles that do not:

```
feat(outpost): show agenda            missing emoji
📝 fix(settings): update disclaimer   emoji does not match the type
✨ feat: update files                 no scope, says nothing
✨ feat(outpost): Show Agenda.        capitalised, trailing period
✨ feat(outpost): show agenda (#135)  PR number typed by hand
```

#### Before writing the title, apply the threshold

Gitmoji is the **default**, and the bar for abandoning it is deliberately high. Using the 100-title count from step 5:

| Gitmoji share of 100 | Do this |
| --- | --- |
| No machine-enforced rule, **≥ 20** carry a gitmoji | Use gitmoji. The repo's convention is gitmoji; the bare titles are the exceptions. |
| No machine-enforced rule, **< 20** carry a gitmoji | Follow the repo's shape instead, and say so in the report. |
| A machine-enforced pattern exists | It wins outright, whatever the count says. |

Two failure modes this threshold exists to prevent, both of which have happened:

- **Sampling the top of the log.** A 15-title sample landed entirely inside a 12-PR run of prose titles in a repo where **84 of the last 100** were gitmoji. The conclusion "this repo uses prose" was drawn from a window smaller than the exception, and it produced a PR title the author immediately rejected.
- **Treating a recent run as a convention change.** Conventions change by someone writing them down, not by drift. Unless a doc or config says the repo moved off gitmoji, a run of non-conforming titles means those PRs skipped the convention - copying them propagates the mistake.

When in doubt, use gitmoji: a title that conforms in a repo that has stopped caring costs nothing, while a bare title in a repo that still cares is the one the reviewer asks you to change.

### 8. Create the PR

```bash
gh pr create --title "<title>" --body-file <body-path> --base <base>
```

Add `--draft` when the work is incomplete, when the user asks for a draft, or when CI is expected to fail on the first push.

Delete the temporary body file afterwards.

**Read the title back and check it against the convention before moving on.** A title is cheap to fix now and awkward to fix after review starts, and on a squash-merge repo it is the subject that lands in the base branch forever.

```bash
gh pr view <number> --json title -q .title
```

Confirm it leads with the right emoji for its type, carries a scope from the repo's vocabulary, is lowercase and imperative, and has no trailing period or hand-typed PR number.

To correct it:

```bash
gh pr edit <number> --title "<title>"
```

If that fails, use the REST endpoint - `gh pr edit` goes through GraphQL and **aborts on unrelated field errors** (a repo with Projects-classic enabled returns a deprecation error on `projectCards` and the title is left unchanged, while the command still prints something that reads like output):

```bash
gh api -X PATCH repos/{owner}/{repo}/pulls/<number> -f title='<title>' --jq .title
```

Either way, verify with `gh pr view` afterwards rather than trusting the command's exit. A title edit does not move the SHA, so any signoff or CI status on the PR survives it.

### 9. Sign off the PR when the repo gates on signoff

Some repos replace cloud CI with [`basecamp/gh-signoff`](https://github.com/basecamp/gh-signoff): the checks run on the authoring machine and write the `signoff` commit statuses branch protection requires. In those repos a freshly created PR is unmergeable until someone signs it off, so creating the PR is only half the job.

Detect it after the PR exists:

```bash
gh api "repos/{owner}/{repo}/branches/<base>/protection" --jq '.required_status_checks.contexts' 2>/dev/null
gh extension list | grep gh-signoff
rg -n "signoff" package.json 2>/dev/null
ls scripts/ 2>/dev/null | grep -i signoff
gh pr view <number> --json statusCheckRollup -q '[.statusCheckRollup[].context] | map(select(. != null))'
```

The repo gates on signoff if any of those show a `signoff` context, a gh-signoff extension, or a signoff wrapper script.

Then, in order of preference:

1. **The `dlc-signoff` skill, if it is available.** Invoke it and let it drive. It owns the preflight, the check plan, the status write order and the report comment, and it will not sign off a check that did not run.
2. **The repo's own wrapper, if there is no skill.** `bun run signoff` or whatever the script is named. Read its source first, then follow its output.
3. **By hand, if neither exists.** Run the repo's real checks in the foreground, then write the statuses only for what passed:

   ```bash
   SHA=$(git rev-parse HEAD)
   gh signoff create <check> --commit "$SHA"   # one per passed check, sub-contexts first
   gh signoff create --commit "$SHA"           # the bare umbrella context, LAST
   ```

   Always name `create` explicitly, and write the umbrella only after every sub-context write succeeded.

Hard rules, whichever path you take:

- **Never run bare `gh signoff` as a shortcut.** It writes a green status without running anything. Only the user can ask for an unverified signoff, and if they do, say so plainly on the PR.
- **A failing check is work to do.** Fix it, commit, push, then sign off the new SHA. Never weaken a check to make it green.
- **The status binds to the SHA.** Any later push to the branch drops it and signoff has to run again.
- **Skip this step for a draft PR** unless the user asks, since a draft is not being merged yet.

If the repo does not gate on signoff, skip this step entirely and let its normal CI run.

### 10. Report and follow up

- Print the PR URL returned by `gh pr create`.
- State which convention source shaped the title and the body (repo config file, contributor doc, PR template, or this skill's defaults), and call out anywhere the repo overrode a default.
- Mention that CI checks will run automatically, or report the signoff result and the SHA it bound to when the repo gates on signoff.
- Say what is still blocking the merge, if anything.
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
| Repo title config conflicts with gitmoji | Follow the repo config, drop the emoji, and say so in the report. |
| Recent merged titles do not use gitmoji | Count over 100, not 20. Below 20 gitmoji per 100 follow the repo; at or above that, the run is exceptions and gitmoji stands. See the threshold in step 7. |
| `gh pr edit --title` errors on Projects (classic) | The GraphQL mutation aborts on the unrelated `projectCards` deprecation and leaves the title unchanged. Use `gh api -X PATCH repos/{owner}/{repo}/pulls/<n> -f title='...'` and verify with `gh pr view`. |
| Two configs disagree (e.g. commitlint vs a PR title action) | The one CI actually runs wins. If both run, satisfy both; if that is impossible, ask the user. |
| Monorepo package config differs from the repo root | Use the config nearest the changed files. If the change spans packages with different rules, satisfy the repo root config and ask. |
| Repo requires `signoff` but gh-signoff is not installed | Install it (`gh extension install basecamp/gh-signoff`) or point the user at the repo's setup instructions. Do not leave the PR silently unmergeable. |
| A check fails during signoff | Write no statuses. Fix the cause, commit, push, then sign off the new SHA. |
| PR is from a fork and signoff is required | Writing a status needs write access to the head repo, so the signoff has to come from a dispatched workflow. Say so rather than retrying. |

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
