---
name: dlc-signoff
description: Sign off the current PR or commit with basecamp/gh-signoff by running the repo's CI checks locally and writing the `signoff` commit statuses branch protection requires, or set gh-signoff up in a repo. Routes to one of two references, run mode by default, setup mode when the request is about configuring the repo. Enforces the honesty rules (clean tree, pushed HEAD, only sign off what actually ran, report who ran it). Use when asked to "sign off", "sign off the PR", "signoff", "run signoff", "make the PR mergeable", "green the checks", or when a PR is blocked on a missing `signoff` status. Use setup mode for "signoff setup", "set up signoff", "install gh-signoff", "configure signoff for this repo", "add signoff to this repo", "which checks should be required".
license: UNLICENSED
allowed-tools: Read, Bash(*), Glob, Grep
metadata:
  author: chris@delacour.co.nz
  version: "0.2.0"
  category: workflow
  tags: [signoff, gh-signoff, ci, pull-request, github, local-ci, branch-protection, setup]
  argument-hint: "[setup] [--dry-run] [--only ctx,ctx] [--skip ctx,ctx]"
---

# Signoff

Local CI. Instead of a PR fanning out cloud jobs that re-verify work the authoring machine already verified, the checks run here and [`basecamp/gh-signoff`](https://github.com/basecamp/gh-signoff) writes commit statuses (`POST /repos/:owner/:repo/statuses/<sha>`, context `signoff` or `signoff/<check>`) that branch protection requires.

The gate is only as honest as the run behind it. `gh signoff` writes a green status without running anything, so the whole value of this skill is the procedure around the command: verify the tree, run the checks the diff actually needs, write statuses only for checks that passed, and say in writing who ran them and what was skipped.

## Modes

Pick the mode from the request, then follow that reference in full. Do not paraphrase it and do not skip steps.

| Mode | Follow | Use when |
| --- | --- | --- |
| **Run** (default) | [references/signoff.md](./references/signoff.md) | Signing off the current branch, PR or commit |
| **Setup** | [references/setup.md](./references/setup.md) | Configuring gh-signoff for the repo |

**Setup mode** when the request carries a setup word: "setup", "set up", "install", "configure", "initialise", "add signoff to this repo", "which checks should be required", or when the invocation argument is `setup`. Also switch to setup mode if a run reveals the repo has no `signoff` context in branch protection or the extension is not installed, then return to run mode afterwards.

**Run mode** for everything else, including a bare invocation with no arguments.

If the request is ambiguous ("sort out signoff on this repo"), check whether `signoff` is already a required context and say which mode you picked before starting:

```bash
gh api "repos/{owner}/{repo}/branches/$(gh repo view --json defaultBranchRef --jq .defaultBranchRef.name)/protection" --jq '.required_status_checks.contexts'
```

## When to Use

Run mode:

- User says "sign off", "sign off the PR", "signoff", "run signoff", or "gh signoff"
- A PR is blocked on a missing or red `signoff` / `signoff/<check>` status
- User asks to make a PR mergeable, or asks why the checks panel is empty
- After finishing work on a branch that already has an open PR, when the user asks for the PR to be ready to merge

Setup mode:

- User asks to set up, install or configure gh-signoff on a repo
- User asks which contexts should be required, or wants to migrate cloud CI to local signoff
- `gh extension list` has no gh-signoff, or branch protection has no `signoff` context

Do **not** use this skill to skip verification. If the user wants a green status without running the checks, see the break-glass section in [references/signoff.md](./references/signoff.md#break-glass), which requires explicit authorization.

## Rules / Steps

These hold in both modes:

1. **A status binds to a SHA, not a branch.** Push another commit and the signoff drops, and the run has to happen again.
2. **Never sign off a check that did not run.** Not run is skipped, never passed.
3. **Never weaken a check to make it green.** No `--no-verify`, no skipped tests, no loosened types, no ignore comments added to silence a real finding.
4. **A failing check is work to do, not a result to hand back.** Fix it, commit, push, start the run over on the new SHA.
5. **Name the runner.** GitHub stamps the token owner's login, so say explicitly in the PR comment when an agent ran the checks.
6. **Only always-on checks become required contexts.** A required context that never arrives leaves the PR unmergeable forever.

## Examples

```bash
/dlc-signoff                         # run mode: check, verify, write statuses on the current PR
/dlc-signoff --dry-run               # run mode: print the plan, run nothing, write nothing
/dlc-signoff --skip e2e --only test  # run mode with filters
/dlc-signoff setup                   # setup mode: install the extension, pick and require contexts
```

Worked examples for each mode live in the reference files.
