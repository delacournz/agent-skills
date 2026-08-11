---
name: dlc-signoff-pr
description: Sign off a pull request with basecamp/gh-signoff by running the repo's CI checks locally and writing the `signoff` commit statuses branch protection requires. Failing checks are fixed, committed and pushed, then the whole run starts over on the new SHA. Enforces the honesty rules (clean tree, pushed HEAD, only sign off what actually ran, report who ran it). Use when asked to "sign off", "sign off the PR", "signoff", "run signoff", "make the PR mergeable", "write the signoff statuses", "green the checks", or when a PR is blocked on a missing `signoff` status. Also covers first-time setup (`gh extension install basecamp/gh-signoff`, `gh signoff install`) and the break-glass escape hatches.
license: UNLICENSED
allowed-tools: Read, Bash(*), Glob, Grep
metadata:
  author: chris@delacour.co.nz
  version: "0.1.0"
  category: workflow
  tags: [signoff, gh-signoff, ci, pull-request, github, local-ci, branch-protection]
  argument-hint: "[--dry-run] [--only ctx,ctx] [--skip ctx,ctx]"
---

# Sign Off a Pull Request

Local CI. Instead of a PR fanning out cloud jobs that re-verify work the authoring machine already verified, the checks run here and [`basecamp/gh-signoff`](https://github.com/basecamp/gh-signoff) writes commit statuses (`POST /repos/:owner/:repo/statuses/<sha>`, context `signoff` or `signoff/<check>`) that branch protection requires.

The gate is only as honest as the run behind it. `gh signoff` writes a green status without running anything, so the whole value of this skill is the procedure around the command: verify the tree, run the checks the diff actually needs, write statuses only for checks that passed, and say in writing who ran them and what was skipped.

**A status binds to a SHA, not a branch.** Push another commit and the signoff drops, and this has to run again.

## When to Use

- User says "sign off", "sign off the PR", "signoff", "run signoff", or "gh signoff"
- A PR is blocked on a missing or red `signoff` / `signoff/<check>` status
- User asks to make a PR mergeable, or asks why the checks panel is empty
- User asks to set up gh-signoff on a repo, or to configure required contexts
- After finishing work on a branch that already has an open PR, when the user asks for the PR to be ready to merge

Do **not** use this skill to skip verification. If the user wants a green status without running the checks, see [Break-glass](#break-glass), which requires explicit authorization.

## Rules / Steps

### 1. Find the repo's signoff entrypoint

Before touching `gh signoff` directly, look for a wrapper the repo already owns:

```bash
cat package.json | grep -i signoff        # e.g. "signoff": "bun scripts/signoff.ts"
ls scripts/ | grep -i signoff
```

**If a wrapper exists, use it and nothing else.** It encodes which checks the diff needs, the status write order, and the report comment. In the Delacour monorepo that is:

```bash
bun run signoff -- --dry-run   # print the plan, run nothing, write nothing
bun run signoff                # run the checks, write the statuses, post the report
bun run signoff -- --skip e2e-folio --only typecheck,test --no-comment
```

Read the wrapper's source before the first run in an unfamiliar repo, then follow its output. If it reports a failed check, go to [step 4b](#4b-a-check-failed-fix-it-commit-push-start-over) and fix it. Otherwise skip to step 6.

If there is no wrapper, continue with steps 2 to 5 and do the work by hand.

### 2. Preflight (every condition is a hard stop)

```bash
git rev-parse --git-dir                          # inside a repo
git status --porcelain                           # MUST be empty
git rev-parse HEAD                               # the SHA being signed off
git rev-parse @{push}                            # MUST equal HEAD
gh pr view --json number,baseRefName,state       # MUST exist and be OPEN
gh api user --jq .login                          # gh MUST be authenticated
gh extension list | grep gh-signoff              # else: gh extension install basecamp/gh-signoff
```

Why each one matters:

- **Dirty tree:** a signoff attests to a commit. Verifying uncommitted work attests to something the PR does not contain. Commit or stash, do not sign off around it.
- **Unpushed HEAD:** the status binds to a remote SHA. GitHub rejects a status for a commit it has never seen.
- **No open PR:** there is nothing to report to, and nothing being gated.

### 3. Plan the checks from the diff, not from memory

```bash
BASE=$(gh pr view --json baseRefName --jq .baseRefName)
git fetch --quiet origin "$BASE"
git diff --name-only "$(git merge-base origin/$BASE HEAD)" HEAD
```

Map those paths to checks:

- **Always-on checks** (typecheck, lint/format, test, build in most repos) run on every PR and are the contexts branch protection requires.
- **Path-gated checks** (a cargo leg, a Playwright suite, a screenshot capture) run only when the diff touches their paths. They are deliberately *not* in the required list: GitHub's required-context list is static per branch, so a required context that never arrives leaves the PR unmergeable forever.
- Markdown-only changes should not trigger path-gated checks. Nothing imports a `.md`.

If the repo defines this mapping in a file (for example `scripts/signoff-checks.ts`), that file is the source of truth. Never invent a plan beside it.

State the plan before running it: which checks run, which are skipped, and why each skip is legitimate.

### 4. Run the checks and record the outcome

Run each applicable check with its real command, in the foreground, and capture pass/fail plus duration. Do not run them in a way that hides output.

Rules that make the result trustworthy:

- A check that was not run is **skipped**, never "passed".
- A check that passed only because an env var was missing (a suite that self-skips without `TEST_DATABASE_URL`, say) is a **qualified pass**. Say so in the report.
- Never pass `--no-verify`, never disable a lint rule, and never narrow a suite to make it green.
- If any check fails: **write no statuses at all**, then go fix it. A partial signoff on a failing PR is worse than no signoff.

### 4b. A check failed: fix it, commit, push, start over

Signing off is not a report on the state of the branch, it is the job of getting the branch to a state worth signing off. A red check is work to do, not a result to hand back.

1. **Read the actual failure.** Re-run the single failing check on its own for clean output. Diagnose the root cause, do not pattern-match on the error string.
2. **Fix the source.** Change the code (or the test, when the test is the thing that is wrong). Never make a check pass by weakening it: no skipped tests, no loosened types, no `biome-ignore` added to silence a real finding, no `--no-verify`, no removing the check from the plan.
3. **Re-run that check** until it passes, then re-run **every** check in the plan. A fix in one place breaks another often enough that a targeted re-run is not evidence.
4. **Commit the fix** on the same branch, with a gitmoji conventional message describing the fix (not "fix signoff"):

   ```bash
   git add <only the files you changed> && git commit -m "🐛 fix(pkg): <what was actually wrong>"
   ```

5. **Push to origin.**

   ```bash
   git push
   ```

6. **Start over from step 2.** The push created a new SHA, so the plan, the checks and the statuses all belong to that commit. Nothing from the previous attempt carries forward.

Loop guard: after **three** full attempts on the same check, stop and report. Also stop immediately, without further attempts, when any of these is true:

- the fix would need a decision that is the user's to make (a product behavior change, a dependency bump, a schema migration)
- the fix reaches outside the scope of this PR
- the failure is environmental and not the branch's fault (no Docker, a missing toolchain, a port collision). Use the dispatched-workflow escape hatch in [Edge Cases](#edge-cases) instead.
- the check is flaky: it passes on re-run without any change. Say so rather than treating the green as settled.

When you stop, report the failing check, the diagnosis, what you tried, and what you need from the user. Leave the PR unsigned.

### 5. Write the statuses, sub-contexts first, umbrella last

```bash
SHA=$(git rev-parse HEAD)
gh signoff create typecheck --commit "$SHA"
gh signoff create test      --commit "$SHA"
# ...one per passed check...
gh signoff create --commit "$SHA"        # the bare umbrella context, LAST
```

Non-negotiable details:

- **Always name `create` explicitly.** The context is positional and so is the subcommand, so a context named `check`, `status`, `install`, `uninstall`, `version` or `completion` is parsed as a gh-signoff subcommand and silently writes nothing. `create` takes every non-option argument as a context, so no name can collide.
- **Umbrella last, and only if every write above succeeded.** The bare `signoff` context is the one that unblocks the merge. Writing it over a sub-context write that failed produces a green panel with a required status quietly absent, which is invisible in a way a red mark is not. If any write failed, withhold the umbrella and say which contexts are missing.
- **Withhold the umbrella unless something ran and nothing failed.** A plan that skipped everything (a filter typo, for instance) must not sign off a PR nobody verified.

### 6. Post the report and tell the truth about the runner

GitHub records the status creator and stamps `"<login> signed off"`, which names the token, not the hands. When an agent runs the checks with a human's `gh` credentials, the PR would otherwise read as though a person watched the suite.

Post (or edit in place, keyed on an HTML comment marker so re-runs do not stack comments) a comment on the PR containing:

- the short SHA and whether the signoff was written
- the actor (`gh api user --jq .login`) **and** the runner, naming the agent explicitly when an agent ran it
- a row per check: passed, failed, or skipped, with duration and the reason for every skip
- a note that the statuses drop on the next push

If the repo's wrapper posts this comment, do not post a second one.

Finally, report back to the user: the SHA, the PR number, what ran, what was skipped and why, and what is still blocking the merge if anything is.

### Edge Cases

**A check genuinely cannot run on this machine.** Sibling worktrees colliding on a dev-server port, a missing platform toolchain, no Docker. Do not skip it silently. Dispatch the workflow that still runs it, then re-run signoff excluding it once green:

```bash
gh workflow run "E2E (folio)" --ref "$(git branch --show-current)" -f signoff-sha="$(git rev-parse HEAD)"
bun run signoff -- --skip e2e-folio
```

**HEAD moved mid-run.** Abort. The statuses would bind to a SHA whose code was never the code under test. Re-run from step 2.

**The PR was pushed to after signoff.** Expected. Re-run the whole procedure. Do not copy statuses forward to the new SHA.

**Fork PRs.** Writing a status needs write access to the head repo. A signoff run from a fork will fail at the status write, so the check has to come from a dispatched workflow instead.

**Repo not set up yet.** One-off, per repo, and needs admin on the branch:

```bash
gh extension install basecamp/gh-signoff
gh signoff install                                        # require the bare `signoff` context
gh signoff install typecheck check test build             # plus the always-on sub-contexts
gh signoff install --branch main typecheck check test     # a second protected branch
gh signoff status                                         # what is currently signed off
```

Only put always-on contexts in the required list. Path-gated ones block transitively through the withheld umbrella.

### Break-glass

Bare `gh signoff` (no wrapper, no checks) writes the statuses without running anything. It exists for a machine that genuinely cannot run a suite. **An agent must never reach for it on its own initiative.** Use it only when the user explicitly asks for an unverified signoff, and when you do, say plainly in the PR comment that no checks were run.

The honest escape hatch is the dispatched workflow above: it runs the real thing and signs off from CI.

## Examples

### Example: signing off in a repo with a wrapper

**Before:**

```
$ gh signoff
✓ signed off
```

Nothing ran. The PR is mergeable on an attestation of nothing.

**After:**

```
$ bun run signoff -- --dry-run
signoff plan - against origin/develop
  run   typecheck
  run   check (lint + format)
  run   test
  run   build
  skip  rust (outpost)         no files matched apps/outpost/app/src-tauri/**, crates/**
  ...

$ bun run signoff
━━ typecheck ━━  ... ✓
━━ test ━━       ... ✓
✓ signed off a1b2c3d on PR #412.
```

Plus a PR comment naming the runner as an agent, every duration, and every skip reason.

### Example: a failing check

**Before:** run the suite, see one red test, sign off the other three contexts anyway so the panel looks mostly green. Or: stop and hand the failure back to the user untouched.

**After:**

```
━━ test ━━
  ✗ packages/db  1 failing: softDelete leaves deletedAt null on cascade

no statuses written. fixing.

  → packages/db/src/services/base.ts: cascade path skipped the timestamp stamp
  → fixed, `bun test packages/db` green, full plan re-run green

$ git add packages/db/src/services/base.ts packages/db/src/services/base.test.ts \
    && git commit -m "🐛 fix(db): stamp deletedAt on cascading soft-deletes"
$ git push
$ bun run signoff
✓ signed off e4f5a6b on PR #412.
```

The signoff landed on the new SHA, not the one that failed.
