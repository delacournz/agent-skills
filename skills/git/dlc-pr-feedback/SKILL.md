---
name: dlc-pr-feedback
description: Work through all review feedback on a GitHub pull request using the gh CLI. Collects every unresolved review thread, review body and PR comment (human and bot), fixes each one in its own commit, runs the repo's checks, pushes, then replies on each thread with a link to the fixing commit and resolves it. Use when the user wants to address PR comments, resolve review feedback, or close out review threads. Triggers on "address PR comments", "resolve review comments", "fix the PR feedback", "work through review threads", "handle the review", "/pr-feedback".
metadata:
  author: chris@delacour.co.nz
  version: "0.1.0"
  category: git
  tags: [git, github, pull-request, code-review, gh-cli, workflow]
  argument-hint: "[<pr-number-or-url>]"
license: UNLICENSED
---

# Delacour PR Feedback

Turn every open review comment on a pull request into a commit, a pushed branch, and a threaded reply that links the commit. Phase 1 collects and plans. Phase 2 fixes, one commit per thread. Phase 3 pushes, replies, resolves and verifies.

## When to Use

- When the user asks to address, resolve or work through PR comments or review threads
- When a reviewer or bot (Copilot, CodeRabbit) left feedback on the user's PR
- When the user wants each comment answered with a link to the commit that fixed it

Use `dlc-pr` to open the PR. Use `dlc-signoff` after the push if the repo gates on signoff.

## Rules / Steps

### 1. Preflight

```bash
gh auth status
gh pr view [<number-or-url>] --json number,url,headRefName,baseRefName,isCrossRepository,headRepositoryOwner
git status --short
git branch --show-current
git fetch origin && git status -sb
```

- Stop if `gh` is not authenticated. Tell the user to run `gh auth login`.
- Stop if the PR is from a fork (`isCrossRepository` true). You cannot push to it.
- Stop if the current branch is not `headRefName`. Ask before switching.
- If the tree is dirty, ask the user to commit or stash. Never mix their changes into feedback commits.
- If the branch is behind `origin/<headRefName>`, run `git pull --ff-only` first. If it cannot fast-forward, stop and ask.

### 2. Collect all feedback

Get `owner` and `repo` with `gh repo view --json owner,name`. Run one query. Paginate any list with `hasNextPage` by re-running with `-F cursor=<endCursor>`.

```bash
gh api graphql -F owner=OWNER -F repo=REPO -F number=NUMBER -f query='
query($owner:String!,$repo:String!,$number:Int!){
  repository(owner:$owner,name:$repo){
    pullRequest(number:$number){
      reviewThreads(first:100){
        pageInfo{hasNextPage endCursor}
        nodes{
          id isResolved isOutdated path line
          comments(first:50){nodes{databaseId author{login} body url}}
        }
      }
      reviews(first:100){nodes{id state body url author{login}}}
      comments(first:100){nodes{id body url author{login}}}
    }
  }
}'
```

- Skip threads where `isResolved` is true.
- Classify each remaining item:

| Class | Meaning |
| --- | --- |
| Actionable | A concrete change is asked for and is correct. |
| Question | Needs an answer, not a change. |
| Disagree | The request is wrong, out of scope, or conflicts with another comment. |
| Duplicate | Same fix as another thread. |
| Noise | Bot summary, praise, or empty review body. Ignore. |

- Treat bot suggestions critically. Read the code and verify the claim before changing anything. Bots are often wrong about types, call sites and framework behavior.
- Review bodies and PR comments cannot be resolved. Read them for requests, then answer once in step 7.

### 3. Plan

Show a list: `thread -> path:line -> intended fix -> class`. One commit per thread. Group only true duplicates.

Ask the user once, in a single round, about every item where the fix is unclear, the comment is a disagreement, or it needs a design decision. Use the harness's question tool if there is one. Do not guess.

### 4. Fix each thread, in order

For each actionable thread:

1. Read the code and the full thread, not only the first comment.
2. If behavior changes, write or adjust a failing test first, then fix.
3. Run the repo's relevant checks. Detect the package manager from the lockfile (`bun.lock`, `pnpm-lock.yaml`, `yarn.lock`, `package-lock.json`) and run only scripts that exist: `lint`, `typecheck`, `test`. Check `package.json`, `AGENTS.md` or `CONTRIBUTING.md`.
4. Commit only that change, staged by explicit path:

```bash
git add <paths> && git commit -m "<subject>"
git rev-parse HEAD
```

Record the full SHA next to the thread.

Commit rules:

- Follow the repo's commit convention: `commitlint.config.*`, `AGENTS.md`, `CLAUDE.md`, then the majority style of recent history. Default is `<gitmoji> <type>(<scope>): <imperative summary>`.
- If the repo says review fixes are fixups, use `git commit --fixup <sha>` against the commit the thread is about.
- Follow the repo's commit signing rule (for example a `scripts/check-signing.sh`). Stop if it fails.
- Follow the repo's and the user's rules on attribution trailers. Add none they have excluded.
- Never `--no-verify`. Never `--amend` or rebase commits that are already pushed.

For Question and Disagree threads, make no commit. Prepare the reply text.

### 5. Final checks and push

Run the full check suite once (same scripts as step 4, plus `build` if it exists). Fix failures in a new commit and note which thread it belongs to.

```bash
git push
```

Use `--force-with-lease` only if history was rewritten and the user allowed it. Confirm with `git rev-parse HEAD origin/<headRefName>` that both SHAs match.

### 6. Reply and resolve

Reply on each thread using the `databaseId` of the thread's first comment:

```bash
gh api -X POST repos/OWNER/REPO/pulls/NUMBER/comments/COMMENT_ID/replies \
  -f body="Fixed in [abc1234](https://github.com/{owner}/{repo}/pull/{number}/commits/{full-sha}): <what the code does now>."
```

Then resolve it with the thread `id`:

```bash
gh api graphql -F threadId=THREAD_ID -f query='
mutation($threadId:ID!){
  resolveReviewThread(input:{threadId:$threadId}){thread{id isResolved}}
}'
```

Reply style:

- Short and factual. Say what the code does now, not what you did.
- No "Good catch", no praise, no emoji, no filler.
- Do not @-mention anyone unless they need a notification.

Declined and question threads: reply with the reasoning or the answer. Leave them unresolved unless the user agreed to resolve.

### 7. Top-level comments

Review bodies and issue comments cannot be resolved. Post one comment listing what was done, linking each commit:

```bash
gh pr comment NUMBER --body "<short list: request -> commit link or reason not changed>"
```

Skip it if they held no requests.

### 8. Verify and report

Re-run the step 2 query. Confirm every addressed thread has `isResolved` true and contains your reply. Then:

```bash
gh pr checks NUMBER
```

Report a table: `thread -> commit -> reply link -> resolved yes/no`. List anything left open and why. Include CI status.

### Edge Cases

| Situation | Action |
| --- | --- |
| Thread is outdated (code moved) | Find the current location of the code. If the issue is gone, reply with where it was addressed and resolve. |
| Thread is on a deleted line | Reply that the line no longer exists and resolve. |
| Comment has a `suggestion` block | Apply it exactly, or reply with why not. Do not half-apply. |
| Two comments conflict | Ask the user in the step 3 round. Reply on both once decided. |
| Review state is "changes requested" | Pushing does not clear it. Tell the user to re-request review. Run `gh pr edit --add-reviewer <login>` only if asked. |
| Fork PR | Stop in step 1. |
| Vendored or generated file | The fix may belong upstream. Say so in the reply and the report. Do not hand-edit generated output. |
| Large thread needing a design decision | Ask in step 3. |
| New comments arrive mid-run | Re-run the step 2 query before pushing and add them to the plan. |
| Check fails and cannot be fixed | Do not push. Report which thread caused it. |

## Examples

### Example: bot review with 3 threads

**Before:**

```
PR #42, branch fix/token-refresh, 3 unresolved threads from a review bot
  T1 src/auth.ts:18   "Token expiry is compared in seconds, but exp is in ms"
  T2 src/auth.ts:55   "Consider renaming `d` to `delay`"
  T3 src/api.ts:9     "Use `any` for the response type"
```

**After:**

```
Plan
  T1 -> fix unit mismatch, add failing test first      (actionable)
  T2 -> rename variable                                (actionable)
  T3 -> decline, a typed response is already defined   (disagree, verified in src/types.ts)

Commits
  T1  🐛 fix(auth): compare token expiry in milliseconds   a1b2c3d
  T2  ♻️ refactor(auth): rename d to delay                 e4f5a6b

Checks: lint, typecheck, test passed. Pushed. HEAD matches origin.
```

Replies:

```
T1: Fixed in [a1b2c3d](https://github.com/acme/app/pull/42/commits/{a1b2c3d-full-sha}): expiry is now compared in milliseconds, with a test for the boundary.
T2: Fixed in [e4f5a6b](https://github.com/acme/app/pull/42/commits/{e4f5a6b-full-sha}): `d` is now `delay`.
T3: Not changed. `fetchUser` already returns `UserResponse` (src/types.ts:12), so `any` would drop the type.
```

Report:

| Thread | Commit | Reply | Resolved |
| --- | --- | --- | --- |
| T1 | a1b2c3d | link | yes |
| T2 | e4f5a6b | link | yes |
| T3 | none | link | no, left for reviewer |

CI: `gh pr checks 42` shows all passing.
