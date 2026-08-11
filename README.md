# Delacour Agent Skills

Reusable, versioned agent skills for Delacour. One command to install any skill into any AI coding tool.

## Quick Start

```bash
# Install a skill
bunx skills add https://github.com/UrbanChrisy/delacour-agent-skills.git --skill dlc-expo

# List available skills
bunx skills add https://github.com/UrbanChrisy/delacour-agent-skills.git --list

# Install for a specific agent
bunx skills add https://github.com/UrbanChrisy/delacour-agent-skills.git --skill dlc-expo -a claude-code

# Install to all detected agents globally
bunx skills add https://github.com/UrbanChrisy/delacour-agent-skills.git --skill dlc-expo -g --all
```

**Prerequisites:** Access to the Delacour `delacour-agent-skills` repo and SSH/HTTPS auth configured.

## How It Works

The [Vercel Skills CLI](https://github.com/vercel-labs/skills) (`bunx skills`) does the heavy lifting:

- **Discovers** skills by scanning for `SKILL.md` files in this repo
- **Converts** the agnostic SKILL.md format to each target tool's native format
- **Installs** to the correct path for the chosen agent
- **Manages** symlinks, updates, and removal

Our responsibility is simple: maintain well-crafted `SKILL.md` files in the right directory structure.

## Skill Categories

Skills are organized by line of business and cross-cutting concern:

| Directory | Category | Description |
| --- | --- | --- |
| `skills/mobile/` | Mobile | React Native / Expo scaffolding and mobile patterns |
| `skills/architecture/` | Architecture | Monorepo root and project structure scaffolding |
| `skills/backend/` | Backend | Backend API app scaffolding (Elysia) |
| `skills/frontend/` | Frontend | Web app and UI package scaffolding (TanStack, UI components) |
| `skills/desktop/` | Desktop | Desktop app scaffolding (Tauri) |
| `skills/database/` | Database | Shared database package scaffolding (Drizzle + Postgres) |
| `skills/auth/` | Auth | Authentication scaffolding (better-auth) |

The CLI recursively discovers `SKILL.md` files regardless of nesting depth, so the category directory is for human organization, not a CLI requirement. Add new categories as new directories under `skills/` when needed.

## Skill Format

Each skill is a directory containing a `SKILL.md` with YAML frontmatter and Markdown body:

```markdown
---
name: human-style-writing
description: Write like a human, not an LLM. Practical checklist of AI writing patterns to avoid and natural alternatives. Use when drafting blog posts, documentation, emails, or any prose content.
metadata:
  author: chris@delacour.co.nz
  version: "0.1.0"
  category: writing
  tags: [writing, content, anti-ai-patterns]
---

# Human Style Writing

Write like a human, not an LLM...

## When to Use

- Blog posts
- Documentation
- Emails

## Rules / Steps

1. Never use em dashes
2. Avoid "delve", "leveraging", "robust"
...
```

### Required Frontmatter

| Field | Description |
|-------|-------------|
| `name` | Unique kebab-case identifier |
| `description` | What the skill does and when to use it. Include trigger phrases. |

### Optional Frontmatter

| Field | Description |
|-------|-------------|
| `metadata.author` | Author email or identifier |
| `metadata.version` | Semantic version string (start at `0.1.0`) |
| `metadata.category` | Lifecycle category |
| `metadata.tags` | Array of searchable tags |
| `metadata.internal` | Set `true` to hide from normal discovery (WIP skills) |
| `metadata.argument-hint` | Hint for skill arguments, e.g. `<file-or-pattern>` |
| `license` | License identifier |

## Adding a New Skill

1. Copy `SKILL-TEMPLATE.md` to `skills/<category>/<skill-name>/SKILL.md`
2. Fill in the frontmatter and body following the annotations in the template
3. Commit and push
4. Team members can immediately install via the CLI

### Quality Checklist

Before submitting a skill:

- [ ] `name` is kebab-case and unique within the repo
- [ ] `description` includes trigger phrases (when the skill should activate)
- [ ] Instructions are specific and actionable (not vague guidance)
- [ ] No references to specific agent UI (skills are tool-agnostic)
- [ ] Version is set (start at `0.1.0`)
- [ ] Category and tags are filled in for discoverability

### Versioning

Each skill is independently versioned via `metadata.version`:

- **MAJOR:** Breaking changes to instructions or expected behavior
- **MINOR:** New features, additional rules, expanded coverage (backward-compatible)
- **PATCH:** Typo fixes, clarifications, minor wording improvements

Use conventional commits for version bumps:

```
feat(skill-name): add new rule for X          # MINOR
fix(skill-name): clarify step 3 wording        # PATCH
feat(skill-name)!: restructure entire format   # MAJOR (breaking)
```

## CI / Validation

A GitHub Actions workflow validates skills on every push and PR. It checks frontmatter, name uniqueness, schema, and structure.

### Running Locally

Validate skills before pushing:

```bash
bun run scripts/validate-skills.ts
```

Check that URLs in skills are reachable (runs automatically on main pushes):

```bash
bun run scripts/validate-skills.ts --check-links
```

### Local Git Hooks (prek)

The same validation runs locally via [prek](https://prek.j178.dev) (a fast, drop-in pre-commit replacement) so issues are caught before they reach CI:

- **pre-commit** runs the fast structural check (frontmatter, naming, uniqueness, schema, em-dash ban). Offline, no network.
- **pre-push** additionally runs `--check-links` to verify external URLs are reachable, mirroring the CI check on `main`.

Hooks install automatically after `bun install` (via the `prepare` script). To install them manually:

```bash
bunx prek install --hook-type pre-commit --hook-type pre-push
```

The hooks only run when a `SKILL.md` is staged. In an emergency, bypass with `git commit --no-verify` or `git push --no-verify`. Config lives in [.pre-commit-config.yaml](.pre-commit-config.yaml).

## PR Signoff (local CI)

Instead of a PR fanning out cloud jobs that re-verify work this machine already verified, the checks run locally and [basecamp/gh-signoff](https://github.com/basecamp/gh-signoff) writes the commit statuses that branch protection on `main` requires.

A status binds to a SHA, not a branch. Push another commit and the signoff drops, so it has to run again.

### One-time setup per developer

```bash
gh extension install basecamp/gh-signoff
gh auth status                      # must be authenticated with repo write access
```

### Signing off a PR

```bash
bun run signoff --dry-run           # print the plan, run nothing, write nothing
bun run signoff                     # run the checks, write the statuses, post the report
```

`scripts/signoff.ts` refuses to run on a dirty or unpushed tree, runs each check in the foreground with visible output, and writes statuses only for checks that actually passed. If any check fails it writes nothing at all: fix the failure, commit, push, and run it again against the new SHA.

Flags:

| Flag | Effect |
| --- | --- |
| `--dry-run` | Print the plan only |
| `--only validate` | Run a subset (the umbrella context stays withheld if a required check did not run) |
| `--skip links` | Skip a check, recorded as skipped in the report |
| `--no-comment` | Do not post or update the PR report comment |
| `--runner "<name>"` | Override the runner label in the report |

The report comment names both the actor (the GitHub token that wrote the statuses) and the runner (who or what actually ran the checks), so an agent-run signoff is never mistaken for a human watching the suite.

### Checks and required contexts

| Check | Context | Command |
| --- | --- | --- |
| `validate` | `signoff/validate` | `bun run scripts/validate-skills.ts` |
| `links` | `signoff/links` | `bun run scripts/validate-skills.ts --check-links` |
| umbrella | `signoff` | written last, only when every check above passed |

`main` requires all three. Only always-on checks belong in the required list: GitHub's required contexts are static per branch, so a path-gated context that never arrives would leave a PR unmergeable forever. Path-gated checks block transitively through the withheld umbrella instead.

### Adding a new check

1. Add an entry to `CHECKS` in [scripts/signoff.ts](scripts/signoff.ts) with its `id`, `description` and `cmd`. Add `paths` only if it should be path-gated.
2. If it is always-on and should block merges, add its `id` to `REQUIRED` in the same file.
3. Add the context to branch protection (repo admin required):

   ```bash
   gh signoff install "" validate links <new-id>
   ```

   Every context has to be passed in one call: `gh signoff install` replaces the required-context list rather than appending to it, and the leading `""` is what keeps the bare `signoff` umbrella required.

### Administering branch protection

```bash
gh signoff check                    # is signoff required on the default branch?
gh signoff status                   # what is signed off for the current commit?
gh signoff uninstall                # remove the requirement
```

Current protection on `main` can be inspected with:

```bash
gh api repos/{owner}/{repo}/branches/main/protection \
  --jq '.required_status_checks.contexts'
```
