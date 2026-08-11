# Reference: Set Up Signoff in a Repo

One-off, per repo. Turns the repo's merge gate from cloud CI into local CI: the checks run on the authoring machine and [`basecamp/gh-signoff`](https://github.com/basecamp/gh-signoff) writes the commit statuses branch protection requires.

This procedure changes branch protection, so it **needs admin on the repo** and it affects everyone who pushes to it. Confirm with the user before running `gh signoff install` if they have not already asked for it explicitly.

## 1. Preflight

```bash
git rev-parse --git-dir                                  # inside a repo
gh api user --jq .login                                  # gh authenticated
gh repo view --json nameWithOwner,defaultBranchRef       # the repo and default branch
gh api "repos/{owner}/{repo}" --jq .permissions          # admin MUST be true
gh extension list | grep gh-signoff                      # installed?
```

Install the extension if it is missing:

```bash
gh extension install basecamp/gh-signoff
gh signoff version
```

Also check what is already there, so this does not overwrite a working setup:

```bash
gh api "repos/{owner}/{repo}/branches/<branch>/protection" --jq '.required_status_checks.contexts'
```

If `signoff` is already in that list, the repo is set up. Report what exists and stop unless the user wants contexts changed.

## 2. Decide which checks are always-on

The contexts you make required are a promise that they will arrive on **every** PR. Read the repo's real check commands first:

```bash
cat package.json | grep -A30 '"scripts"'
ls .github/workflows/
cat turbo.json 2>/dev/null
```

Sort every check into one of two buckets:

- **Always-on** (typecheck, lint/format, test, build in most repos). These run on every PR regardless of what the diff touches. **These, and only these, become required contexts.**
- **Path-gated** (a cargo leg, a Playwright suite, a native build, a screenshot capture). These run only when the diff touches their paths. **Never make them required.** GitHub's required-context list is static per branch, so a required context that never arrives leaves the PR unmergeable forever. They gate transitively: the umbrella `signoff` context is withheld when a check that should have run did not pass.

State the split to the user before installing it.

## 3. Install the required contexts

```bash
gh signoff install                                        # the bare `signoff` umbrella context
gh signoff install typecheck check test build             # plus the always-on sub-contexts
gh signoff install --branch main typecheck check test     # repeat for a second protected branch
```

`gh signoff install` adds to the branch's required status checks, it does not replace the branch protection rule wholesale. Existing required contexts from cloud CI stay required until removed, so a repo mid-migration will be gated by both.

Verify:

```bash
gh api "repos/{owner}/{repo}/branches/<branch>/protection" --jq '.required_status_checks.contexts'
gh signoff status                                         # what is currently signed off
```

To undo:

```bash
gh signoff uninstall                                      # removes the contexts it added
```

## 4. Retire or repurpose the cloud jobs it replaces

Leaving the old workflows on `pull_request` means every check runs twice, once locally and once in the cloud, and the PR is gated by both. For each workflow now covered by a local check, pick one:

- **Delete or narrow the trigger** if the local run fully replaces it. Keep the `push`-on-default-branch leg if the repo publishes from it.
- **Convert to `workflow_dispatch`** for checks that genuinely cannot run on a laptop (no Docker, a missing platform toolchain, a port that collides across worktrees). Give it a `signoff-sha` input so the workflow can write the status for the exact commit it tested:

  ```yaml
  on:
    workflow_dispatch:
      inputs:
        signoff-sha:
          description: Commit SHA to sign off
          required: true
  ```

  Signoff runs then dispatch it and skip that check locally, as covered in [signoff.md](./signoff.md#edge-cases).

Also remove the retired contexts from branch protection, otherwise they stay required and never arrive:

```bash
gh api "repos/{owner}/{repo}/branches/<branch>/protection/required_status_checks" \
  -X PATCH -f 'contexts[]=signoff' -f 'contexts[]=signoff/typecheck'
```

## 5. Optional: add a repo wrapper

A wrapper script is what makes signoff repeatable rather than remembered. Add one when the repo has more than a couple of checks, or any path-gated check. It owns:

- the check list, with each check's command and the globs that gate it (a `scripts/signoff-checks.ts` style map, one source of truth)
- diffing against the PR base to decide what runs
- `--dry-run`, `--only ctx,ctx`, `--skip ctx,ctx`, `--no-comment` flags
- running the checks in the foreground, capturing pass/fail and duration
- writing statuses in order: every passed sub-context first, the bare umbrella last, and only when nothing failed and something actually ran
- posting or editing one PR comment keyed on an HTML comment marker, naming the actor **and** the runner (an agent, when an agent ran it), with a row per check and a reason for every skip

Wire it up as a script so the entrypoint is discoverable:

```jsonc
// package.json
"scripts": {
  "signoff": "bun scripts/signoff.ts"
}
```

Once it exists, [signoff.md](./signoff.md) step 1 finds it and uses it instead of raw `gh signoff` calls.

## 6. Document it and verify end to end

- Add a short section to the repo's `README.md` / `AGENTS.md` / `CONTRIBUTING.md`: what signoff is, that `bun run signoff` (or `gh signoff create ...`) is how a PR goes green, and that statuses drop on every push.
- Tell every contributor to run `gh extension install basecamp/gh-signoff` once. The extension is per-machine, not per-repo.
- Verify on a real PR: run the full procedure in [signoff.md](./signoff.md) and confirm the checks panel turns green and the merge button unblocks.

Report back to the user: which contexts are now required on which branches, which workflows were retired or converted, whether a wrapper was added, and what each contributor has to install locally.
