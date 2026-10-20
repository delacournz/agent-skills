#!/usr/bin/env bun

/**
 * Tags the commit a production binary was built from, or an OTA update was
 * bundled from, on GitHub.
 *
 *   <TAG_PREFIX>/build/ios/1.0.0+5                   the iOS binary 1.0.0, build 5
 *   <TAG_PREFIX>/update/ios/1.0.0+5/acfbadee         an update onto that binary
 *
 * An update carries no version of its own — it runs on whatever binary shares
 * its fingerprint — so it is named for the binary it lands on, plus the first
 * eight characters of its update group, which is what keeps a second push to
 * the same release branch from colliding with the first. Each tag is annotated
 * with the expo.dev page for the build or the update group and its runtime
 * version.
 *
 * It writes through the GitHub REST API rather than `git push`. An EAS custom
 * job has a checkout but no credentials for it, and a manual `eas workflow:run`
 * uploads a local tree whose remote is not GitHub at all; the API needs only a
 * token and a commit GitHub already has.
 *
 * Usage (from `.eas/workflows`, never by hand):
 *
 *   bun scripts/eas-tag.ts build    TAG_PLATFORM TAG_APP_VERSION TAG_BUILD_NUMBER
 *                                   TAG_RUNTIME_VERSION TAG_COMMIT TAG_BUILD_ID
 *   bun scripts/eas-tag.ts update   TAG_PLATFORM TAG_APP_VERSION TAG_BUILD_NUMBER
 *                                   TAG_UPDATES_JSON
 *
 * plus `GITHUB_TAG_TOKEN`, an EAS secret in the `production` environment — a
 * fine-grained token on this repository with Contents read and write.
 *
 * The constants below are placeholders the dlc-expo skill substitutes at setup
 * (see its `references/eas-workflows.md`).
 *
 * Deliberately dependency-free, so the job that runs it needs `eas/checkout`
 * and nothing else.
 */

export const GITHUB_REPOSITORY = "<GITHUB_REPOSITORY>";
export const EXPO_ACCOUNT = "<EXPO_ACCOUNT>";
export const EXPO_SLUG = "<EXPO_SLUG>";
export const TAG_PREFIX = "<TAG_PREFIX>";
export const APP_LABEL = "<APP_LABEL>";

export type Platform = "ios" | "android";
export type TagKind = "build" | "update";

type Binary = {
	readonly platform: Platform;
	readonly appVersion: string;
	readonly buildNumber: string;
	readonly runtimeVersion: string;
	readonly commit: string;
};

export type TagInput =
	| (Binary & { readonly kind: "build"; readonly buildId: string })
	| (Binary & { readonly kind: "update"; readonly groupId: string });

export type Tag = { readonly name: string; readonly commit: string; readonly message: string };

export type Result<T> =
	| { readonly success: true; readonly data: T }
	| { readonly success: false; readonly error: string };

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

type Env = Readonly<Record<string, string | undefined>>;

/** What each kind reads from the environment — the tag jobs in `.eas/workflows` must set every one. */
export const REQUIRED_ENV: Readonly<Record<TagKind, readonly string[]>> = {
	build: ["TAG_PLATFORM", "TAG_APP_VERSION", "TAG_BUILD_NUMBER", "TAG_RUNTIME_VERSION", "TAG_COMMIT", "TAG_BUILD_ID"],
	update: ["TAG_PLATFORM", "TAG_APP_VERSION", "TAG_BUILD_NUMBER", "TAG_UPDATES_JSON"],
};

const PLATFORM_LABEL: Readonly<Record<Platform, string>> = { ios: "iOS", android: "Android" };

const SHAPES = {
	platform: /^(ios|android)$/,
	version: /^\d+\.\d+\.\d+$/,
	buildNumber: /^\d+$/,
	commit: /^[0-9a-f]{40}$/,
	uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
	present: /\S/,
} as const;

function ok<T>(data: T): Result<T> {
	return { success: true, data };
}

function err<T>(error: string): Result<T> {
	return { success: false, error };
}

/**
 * EAS renders an absent output as the literal string "undefined", so presence
 * is not enough — the same trap `extract_version` normalises in shell.
 */
function read(env: Env, key: string, shape: RegExp): Result<string> {
	const value = env[key]?.trim() ?? "";
	if (value === "" || value === "undefined" || value === "null") {
		return err(`${key} is missing — EAS renders an output the job does not have as "undefined"`);
	}
	return shape.test(value) ? ok(value) : err(`${key} is malformed: "${value}"`);
}

function matches(value: unknown, shape: RegExp): value is string {
	return typeof value === "string" && shape.test(value);
}

type UpdateEntry = {
	readonly platform?: unknown;
	readonly group?: unknown;
	readonly gitCommitHash?: unknown;
	readonly runtimeVersion?: unknown;
};

/** Picks this platform's update out of the `update` job's `updates_json` output. */
function readUpdate(env: Env, platform: Platform): Result<{ groupId: string; commit: string; runtimeVersion: string }> {
	const raw = read(env, "TAG_UPDATES_JSON", SHAPES.present);
	if (!raw.success) return raw;

	let entries: unknown;
	try {
		entries = JSON.parse(raw.data);
	} catch {
		return err(`TAG_UPDATES_JSON is not JSON: ${raw.data.slice(0, 80)}`);
	}
	if (!Array.isArray(entries)) return err("TAG_UPDATES_JSON is not an array of updates");

	const update = (entries as UpdateEntry[]).find((entry) => entry.platform === platform);
	if (!update) return err(`TAG_UPDATES_JSON has no ${platform} update`);

	const { group, gitCommitHash, runtimeVersion } = update;
	const invalid = (field: string) => err<never>(`TAG_UPDATES_JSON's ${platform} update has no valid ${field}`);
	if (!matches(group, SHAPES.uuid)) return invalid("group");
	if (!matches(gitCommitHash, SHAPES.commit)) return invalid("gitCommitHash");
	if (!matches(runtimeVersion, SHAPES.present)) return invalid("runtimeVersion");

	return ok({ groupId: group, commit: gitCommitHash, runtimeVersion });
}

export function readTagInput(kind: string | undefined, env: Env): Result<TagInput> {
	if (kind !== "build" && kind !== "update") return err(`Unknown tag kind "${kind}" — expected build or update`);

	const platform = read(env, "TAG_PLATFORM", SHAPES.platform);
	if (!platform.success) return platform;
	const appVersion = read(env, "TAG_APP_VERSION", SHAPES.version);
	if (!appVersion.success) return appVersion;
	const buildNumber = read(env, "TAG_BUILD_NUMBER", SHAPES.buildNumber);
	if (!buildNumber.success) return buildNumber;

	const binary = {
		platform: platform.data as Platform,
		appVersion: appVersion.data,
		buildNumber: buildNumber.data,
	};

	if (kind === "update") {
		const update = readUpdate(env, binary.platform);
		if (!update.success) return update;
		return ok({ kind, ...binary, ...update.data });
	}

	const runtimeVersion = read(env, "TAG_RUNTIME_VERSION", SHAPES.present);
	if (!runtimeVersion.success) return runtimeVersion;
	const commit = read(env, "TAG_COMMIT", SHAPES.commit);
	if (!commit.success) return commit;
	const buildId = read(env, "TAG_BUILD_ID", SHAPES.uuid);
	if (!buildId.success) return buildId;

	return ok({ kind, ...binary, runtimeVersion: runtimeVersion.data, commit: commit.data, buildId: buildId.data });
}

export function tagFor(input: TagInput): Tag {
	const project = `https://expo.dev/accounts/${EXPO_ACCOUNT}/projects/${EXPO_SLUG}`;
	const label = PLATFORM_LABEL[input.platform];
	const binary = `${input.appVersion}+${input.buildNumber}`;
	const shipped = `${input.appVersion} (${input.buildNumber})`;

	switch (input.kind) {
		case "build":
			return {
				name: `${TAG_PREFIX}/build/${input.platform}/${binary}`,
				commit: input.commit,
				message: [
					`${APP_LABEL} ${label} ${shipped}`,
					"",
					`Build    ${project}/builds/${input.buildId}`,
					`Runtime  ${input.runtimeVersion}`,
				].join("\n"),
			};
		case "update":
			return {
				name: `${TAG_PREFIX}/update/${input.platform}/${binary}/${input.groupId.slice(0, 8)}`,
				commit: input.commit,
				message: [
					`${APP_LABEL} ${label} OTA update onto ${shipped}`,
					"",
					`Update   ${project}/updates/${input.groupId}`,
					`Runtime  ${input.runtimeVersion}`,
				].join("\n"),
			};
	}
}

type GitObject = { readonly object: { readonly type: string; readonly sha: string } };

async function describe(response: Response): Promise<string> {
	const body = (await response.json().catch(() => ({}))) as { message?: string };
	const detail = `GitHub answered ${response.status}${body.message ? `: ${body.message}` : ""}`;
	if (response.status === 401 || response.status === 403) {
		return `${detail} — GITHUB_TAG_TOKEN needs Contents read and write on ${GITHUB_REPOSITORY}, and may have expired`;
	}
	return detail;
}

/**
 * Creates the annotated tag and its ref, or confirms it is already there.
 *
 * A tag that exists on the same commit is success, so a re-run job cannot
 * turn a finished release red. One on a different commit is an error: tags
 * are never moved.
 */
export async function pushTag(options: {
	readonly token: string;
	readonly tag: Tag;
	readonly fetch: Fetch;
}): Promise<Result<"created" | "exists">> {
	const { token, tag, fetch } = options;
	const github = (path: string, body?: object) =>
		fetch(`https://api.github.com/repos/${GITHUB_REPOSITORY}${path}`, {
			method: body ? "POST" : "GET",
			headers: {
				Accept: "application/vnd.github+json",
				Authorization: `Bearer ${token}`,
				"User-Agent": `${EXPO_SLUG}-eas-tag`,
				"X-GitHub-Api-Version": "2022-11-28",
			},
			body: body ? JSON.stringify(body) : undefined,
		});

	const encoded = tag.name.split("/").map(encodeURIComponent).join("/");
	const existing = await github(`/git/ref/tags/${encoded}`);
	if (existing.ok) {
		const ref = (await existing.json()) as GitObject;
		let commit = ref.object.sha;
		if (ref.object.type === "tag") {
			const annotated = await github(`/git/tags/${ref.object.sha}`);
			if (!annotated.ok) return err(await describe(annotated));
			commit = ((await annotated.json()) as GitObject).object.sha;
		}
		return commit === tag.commit
			? ok("exists")
			: err(
					`${tag.name} already points at ${commit.slice(0, 7)}, not ${tag.commit.slice(0, 7)} — tags are never moved`
				);
	}
	if (existing.status !== 404) return err(await describe(existing));

	const created = await github("/git/tags", {
		tag: tag.name,
		message: tag.message,
		object: tag.commit,
		type: "commit",
	});
	if (created.status === 422) {
		return err(
			`${await describe(created)} — GitHub has no commit ${tag.commit.slice(0, 7)}. A manual \`eas workflow:run\` uploads the local tree, so push the commit before running it`
		);
	}
	if (!created.ok) return err(await describe(created));
	const { sha } = (await created.json()) as { sha: string };

	const ref = await github("/git/refs", { ref: `refs/tags/${tag.name}`, sha });
	if (!ref.ok) return err(await describe(ref));

	return ok("created");
}

function fail(message: string): never {
	console.error(`❌ ${message}`);
	process.exit(1);
}

if (import.meta.main) {
	const input = readTagInput(process.argv[2], process.env);
	if (!input.success) fail(input.error);

	const token = process.env.GITHUB_TAG_TOKEN?.trim();
	if (!token) {
		fail(
			"GITHUB_TAG_TOKEN is not set. Create a fine-grained GitHub token on " +
				`${GITHUB_REPOSITORY} with Contents read and write, then:\n` +
				"   eas env:create production --name GITHUB_TAG_TOKEN --value <token> --visibility secret"
		);
	}

	const tag = tagFor(input.data);
	const outcome = await pushTag({ token, tag, fetch });
	if (!outcome.success) fail(outcome.error);

	const verb = outcome.data === "created" ? "🏷️  Tagged" : "✅ Already tagged";
	console.log(`${verb} ${tag.commit.slice(0, 7)} as ${tag.name}\n\n${tag.message}`);
}
