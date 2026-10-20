#!/usr/bin/env bun
import { $ } from "bun";

/**
 * Fails unless the EAS Update channel has at least one branch pointed at it.
 *
 * A channel is created by the first build that names it and is never linked to a
 * branch by `eas update`, so a workflow can publish every update to the
 * `production` branch while every `production` binary asks the server for a
 * channel with nothing behind it. The update is live on the branch and
 * unreachable from the app until `eas channel:edit production --branch production`
 * is run by hand.
 *
 * Usage: bun scripts/eas-check-channel.ts [channel]   (default: production)
 *
 * `eas` is not on the PATH of an EAS Workflows custom job — the pre-packaged
 * `update` job shells out to `npx eas-cli@latest` for the same reason — so this
 * runs the CLI through `bunx` rather than assuming a global install.
 */

const channel = process.argv[2] ?? "production";

type Channel = { readonly name?: string; readonly updateBranches?: readonly { readonly name: string }[] };
type ChannelView = { readonly currentPage?: Channel } & Channel;

const raw = await $`bunx eas-cli@latest channel:view ${channel} --json --non-interactive`.text();
const start = raw.indexOf("{");
if (start === -1) {
	console.error(`❌ eas channel:view ${channel} returned no JSON:\n${raw}`);
	process.exit(1);
}
const view = JSON.parse(raw.slice(start)) as ChannelView;
const branches = ((view.currentPage ?? view).updateBranches ?? []).map((b) => b.name);

if (branches.length === 0) {
	console.error(`❌ Channel "${channel}" has no branch linked to it, so no build on it can receive an update.`);
	console.error(`   Fix: eas channel:edit ${channel} --branch ${channel}`);
	process.exit(1);
}

console.log(`✅ Channel "${channel}" → branch ${branches.join(", ")}`);
