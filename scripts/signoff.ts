#!/usr/bin/env bun
/**
 * Local CI signoff for this repo.
 *
 * Runs the repo's checks on this machine, then writes the `signoff` commit
 * statuses that branch protection on `main` requires (via basecamp/gh-signoff).
 *
 * The gate is only as honest as the run behind it, so this script:
 *   1. refuses to run on a dirty or unpushed tree
 *   2. runs every applicable check in the foreground with visible output
 *   3. writes statuses ONLY for checks that actually passed
 *   4. withholds the umbrella `signoff` context if anything failed or nothing ran
 *   5. posts a PR comment naming the runner, every duration and every skip
 *
 * A status binds to a SHA, not a branch. Push again and the signoff drops.
 *
 * Usage:
 *   bun run signoff                          run everything, write statuses, comment
 *   bun run signoff --dry-run                print the plan, run nothing, write nothing
 *   bun run signoff --only validate          run a subset (umbrella still withheld if
 *                                            a required check did not run)
 *   bun run signoff --skip links             skip a check (recorded as skipped)
 *   bun run signoff --no-comment             do not touch the PR comment
 *   bun run signoff --runner "Chris"         override the runner label
 */

// ---------------------------------------------------------------------------
// Check plan
// ---------------------------------------------------------------------------

interface Check {
  /** Context suffix: writes the `signoff/<id>` status. */
  id: string;
  description: string;
  cmd: string[];
  /**
   * Path globs that gate this check. `undefined` means always-on.
   *
   * Only always-on checks may appear in branch protection's required list:
   * GitHub's required contexts are static per branch, so a required context
   * that never arrives leaves the PR unmergeable forever. Path-gated checks
   * block transitively through the withheld umbrella instead.
   */
  paths?: RegExp[];
}

const CHECKS: Check[] = [
  {
    id: "validate",
    description: "SKILL.md frontmatter, naming, uniqueness, schema, structure",
    cmd: ["bun", "run", "scripts/validate-skills.ts"],
  },
  {
    id: "links",
    description: "external link reachability across all skills",
    cmd: ["bun", "run", "scripts/validate-skills.ts", "--check-links"],
  },
];

/** Contexts branch protection requires. Keep in sync with `gh signoff install`. */
const REQUIRED = ["validate", "links"];

const COMMENT_MARKER = "<!-- dlc-signoff-report -->";

// ---------------------------------------------------------------------------
// Shell helpers
// ---------------------------------------------------------------------------

interface Ran {
  ok: boolean;
  code: number;
  out: string;
}

/** Run a command, capture combined output, stay quiet. */
async function run(cmd: string[], stdin?: string): Promise<Ran> {
  const proc = Bun.spawn(cmd, {
    stdout: "pipe",
    stderr: "pipe",
    stdin: stdin === undefined ? "ignore" : new TextEncoder().encode(stdin),
  });
  const [out, err] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  return { ok: code === 0, code, out: (out + err).trim() };
}

/** Run a command with its output streamed live, and capture it too. */
async function runVisible(cmd: string[]): Promise<Ran> {
  const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });

  const decoder = new TextDecoder();
  let acc = "";
  const tee = async (stream: ReadableStream<Uint8Array>) => {
    for await (const chunk of stream) {
      const text = decoder.decode(chunk, { stream: true });
      acc += text;
      process.stdout.write(text);
    }
  };

  await Promise.all([tee(proc.stdout), tee(proc.stderr)]);
  const code = await proc.exited;
  return { ok: code === 0, code, out: acc.trim() };
}

function fail(message: string): never {
  console.error(`\n✗ ${message}`);
  process.exit(1);
}

function fmtDuration(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

interface Options {
  dryRun: boolean;
  comment: boolean;
  only: string[] | null;
  skip: string[];
  runner: string | null;
}

function parseArgs(argv: string[]): Options {
  const opts: Options = {
    dryRun: false,
    comment: true,
    only: null,
    skip: [],
    runner: null,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) continue;

    const takeValue = (): string => {
      const inline = arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : null;
      if (inline !== null) return inline;
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("-")) {
        fail(`option ${arg} requires a value`);
      }
      i++;
      return next;
    };

    if (arg === "--dry-run") opts.dryRun = true;
    else if (arg === "--no-comment") opts.comment = false;
    else if (arg.startsWith("--only")) {
      opts.only = takeValue().split(",").map((s) => s.trim()).filter(Boolean);
    } else if (arg.startsWith("--skip")) {
      opts.skip.push(
        ...takeValue().split(",").map((s) => s.trim()).filter(Boolean),
      );
    } else if (arg.startsWith("--runner")) opts.runner = takeValue();
    else fail(`unknown option: ${arg}`);
  }

  const known = new Set(CHECKS.map((c) => c.id));
  for (const id of [...(opts.only ?? []), ...opts.skip]) {
    if (!known.has(id)) {
      fail(`unknown check '${id}'. known: ${[...known].join(", ")}`);
    }
  }

  return opts;
}

// ---------------------------------------------------------------------------
// Preflight
// ---------------------------------------------------------------------------

interface Context {
  sha: string;
  shortSha: string;
  branch: string;
  base: string;
  prNumber: number;
  actor: string;
  runner: string;
  changed: string[];
}

async function preflight(opts: Options): Promise<Context> {
  if (!(await run(["git", "rev-parse", "--git-dir"])).ok) {
    fail("not inside a git repository");
  }

  const dirty = await run(["git", "status", "--porcelain"]);
  if (dirty.out) {
    fail(
      "working tree is dirty. A signoff attests to a commit, so verifying " +
        `uncommitted work attests to something the PR does not contain.\n${dirty.out}`,
    );
  }

  const sha = (await run(["git", "rev-parse", "HEAD"])).out;
  const pushed = await run(["git", "rev-parse", "@{push}"]);
  if (!pushed.ok) {
    fail("@{push} does not resolve. Push the branch first: git push -u origin HEAD");
  }
  if (pushed.out !== sha) {
    fail(
      `HEAD (${sha.slice(0, 7)}) is not pushed (@{push} is ${pushed.out.slice(0, 7)}). ` +
        "GitHub rejects a status for a commit it has never seen. Run: git push",
    );
  }

  const auth = await run(["gh", "api", "user", "--jq", ".login"]);
  if (!auth.ok) fail("gh is not authenticated. Run: gh auth login");

  const ext = await run(["gh", "extension", "list"]);
  if (!/gh-signoff/.test(ext.out)) {
    fail("gh-signoff is not installed. Run: gh extension install basecamp/gh-signoff");
  }

  const pr = await run([
    "gh", "pr", "view", "--json", "number,baseRefName,state",
  ]);
  if (!pr.ok) {
    fail("no pull request for this branch. There is nothing being gated.");
  }
  const parsed = JSON.parse(pr.out) as {
    number: number;
    baseRefName: string;
    state: string;
  };
  if (parsed.state !== "OPEN") {
    fail(`pull request #${parsed.number} is ${parsed.state}, not OPEN`);
  }

  const branch = (await run(["git", "branch", "--show-current"])).out;

  await run(["git", "fetch", "--quiet", "origin", parsed.baseRefName]);
  const mergeBase = await run([
    "git", "merge-base", `origin/${parsed.baseRefName}`, "HEAD",
  ]);
  const diff = mergeBase.ok
    ? await run(["git", "diff", "--name-only", mergeBase.out, "HEAD"])
    : { ok: false, code: 1, out: "" };

  return {
    sha,
    shortSha: sha.slice(0, 7),
    branch,
    base: parsed.baseRefName,
    prNumber: parsed.number,
    actor: auth.out,
    runner: opts.runner ?? (process.env.CLAUDECODE ? "Claude Code (agent)" : "local shell"),
    changed: diff.out.split("\n").filter(Boolean),
  };
}

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

type Outcome = "passed" | "failed" | "skipped";

interface Result {
  check: Check;
  outcome: Outcome;
  durationMs: number;
  reason: string;
  output: string;
}

function planReason(check: Check, ctx: Context, opts: Options): string | null {
  if (opts.only && !opts.only.includes(check.id)) return "--only excluded it";
  if (opts.skip.includes(check.id)) return "--skip";
  if (check.paths) {
    const hit = ctx.changed.some((f) => check.paths?.some((p) => p.test(f)));
    if (!hit) return "no files in the diff matched its paths";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Statuses
// ---------------------------------------------------------------------------

async function writeStatuses(passed: Check[], ctx: Context): Promise<string[]> {
  const written: string[] = [];

  // Sub-contexts first, umbrella last: the bare `signoff` context is what
  // unblocks the merge, and writing it over a failed sub-context write yields
  // a green panel with a required status quietly absent.
  for (const check of passed) {
    const res = await run([
      "gh", "signoff", "create", check.id, "--commit", ctx.sha,
    ]);
    if (!res.ok) {
      console.error(`  ✗ failed to write signoff/${check.id}: ${res.out}`);
      console.error("  umbrella withheld. The PR stays blocked.");
      return written;
    }
    written.push(`signoff/${check.id}`);
    console.log(`  ✓ signoff/${check.id}`);
  }

  const umbrella = await run(["gh", "signoff", "create", "--commit", ctx.sha]);
  if (!umbrella.ok) {
    console.error(`  ✗ failed to write signoff: ${umbrella.out}`);
    return written;
  }
  written.push("signoff");
  console.log("  ✓ signoff");
  return written;
}

// ---------------------------------------------------------------------------
// PR report comment
// ---------------------------------------------------------------------------

function buildComment(
  ctx: Context,
  results: Result[],
  written: string[],
  missing: string[],
): string {
  const signed = written.includes("signoff");
  const rows = results
    .map((r) => {
      const mark = r.outcome === "passed" ? "✅" : r.outcome === "failed" ? "❌" : "⊘";
      const note = r.outcome === "skipped" ? r.reason : "";
      const dur = r.outcome === "skipped" ? "-" : fmtDuration(r.durationMs);
      return `| \`${r.check.id}\` | ${mark} ${r.outcome} | ${dur} | ${note} |`;
    })
    .join("\n");

  const lines = [
    COMMENT_MARKER,
    `### Signoff \`${ctx.shortSha}\``,
    "",
    `**Result:** ${signed ? "signed off" : "**not signed off**"}`,
    `**Actor:** @${ctx.actor} (the token that wrote the statuses)`,
    `**Runner:** ${ctx.runner} (who actually ran the checks)`,
    "",
    "| Check | Result | Duration | Note |",
    "| --- | --- | --- | --- |",
    rows,
    "",
  ];

  if (written.length) {
    lines.push(`Statuses written: ${written.map((c) => `\`${c}\``).join(", ")}`);
  }
  if (missing.length) {
    lines.push(
      "",
      `> Required contexts still missing: ${missing.map((c) => `\`signoff/${c}\``).join(", ")}. ` +
        "The umbrella `signoff` context is withheld until every required check passes.",
    );
  }

  lines.push("", "_A status binds to a SHA. The next push to this branch drops it._");
  return lines.join("\n");
}

async function postComment(ctx: Context, body: string): Promise<void> {
  const existing = await run([
    "gh", "api",
    `repos/{owner}/{repo}/issues/${ctx.prNumber}/comments`,
    "--jq", `[.[] | select(.body | contains("${COMMENT_MARKER}")) | .id] | last // empty`,
  ]);

  if (existing.ok && existing.out) {
    const patched = await run([
      "gh", "api", "--method", "PATCH",
      `repos/{owner}/{repo}/issues/comments/${existing.out}`,
      "--field", `body=${body}`,
    ]);
    if (patched.ok) {
      console.log(`  ✓ updated report comment on PR #${ctx.prNumber}`);
      return;
    }
    console.error(`  ✗ could not update report comment: ${patched.out}`);
    return;
  }

  const posted = await run(
    ["gh", "pr", "comment", String(ctx.prNumber), "--body-file", "-"],
    body,
  );
  if (posted.ok) console.log(`  ✓ posted report comment on PR #${ctx.prNumber}`);
  else console.error(`  ✗ could not post report comment: ${posted.out}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const ctx = await preflight(opts);

  console.log(`signoff plan - PR #${ctx.prNumber}, ${ctx.shortSha} against origin/${ctx.base}`);
  const skipReasons = new Map<string, string>();
  for (const check of CHECKS) {
    const reason = planReason(check, ctx, opts);
    if (reason) skipReasons.set(check.id, reason);
    const verb = reason ? "skip" : "run ";
    console.log(`  ${verb}  ${check.id.padEnd(10)} ${reason ?? check.description}`);
  }
  console.log("");

  if (opts.dryRun) {
    console.log("dry run: nothing executed, no statuses written.");
    return;
  }

  const results: Result[] = [];
  for (const check of CHECKS) {
    const reason = skipReasons.get(check.id);
    if (reason) {
      results.push({ check, outcome: "skipped", durationMs: 0, reason, output: "" });
      continue;
    }

    console.log(`━━ ${check.id} ━━`);
    const started = Date.now();
    const res = await runVisible(check.cmd);
    const durationMs = Date.now() - started;
    results.push({
      check,
      outcome: res.ok ? "passed" : "failed",
      durationMs,
      reason: "",
      output: res.out,
    });
    console.log(`  ${res.ok ? "✓" : "✗"} ${check.id} (${fmtDuration(durationMs)})\n`);
  }

  const failed = results.filter((r) => r.outcome === "failed");
  const passed = results.filter((r) => r.outcome === "passed");

  if (failed.length) {
    console.error("no statuses written. Fix these, commit, push, then run signoff again:");
    for (const r of failed) console.error(`  ✗ ${r.check.id}`);
    process.exit(1);
  }

  if (!passed.length) {
    fail("nothing ran, so there is nothing to attest to. No statuses written.");
  }

  const missing = REQUIRED.filter((id) => !passed.some((r) => r.check.id === id));
  let written: string[] = [];

  if (missing.length) {
    console.error(
      `required check(s) did not run: ${missing.join(", ")}. ` +
        "Writing the passed sub-contexts only, umbrella withheld.",
    );
    for (const r of passed) {
      const res = await run(["gh", "signoff", "create", r.check.id, "--commit", ctx.sha]);
      if (res.ok) {
        written.push(`signoff/${r.check.id}`);
        console.log(`  ✓ signoff/${r.check.id}`);
      } else {
        console.error(`  ✗ failed to write signoff/${r.check.id}: ${res.out}`);
      }
    }
  } else {
    written = await writeStatuses(passed.map((r) => r.check), ctx);
  }

  if (opts.comment) {
    await postComment(ctx, buildComment(ctx, results, written, missing));
  }

  if (written.includes("signoff")) {
    console.log(`\n✓ signed off ${ctx.shortSha} on PR #${ctx.prNumber}.`);
  } else {
    console.error(`\n✗ ${ctx.shortSha} is not signed off. PR #${ctx.prNumber} stays blocked.`);
    process.exit(1);
  }
}

main();
