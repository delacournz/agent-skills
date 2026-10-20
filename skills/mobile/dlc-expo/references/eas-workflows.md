# EAS Workflows Setup (detailed procedure)

Optional add-on for the `dlc-expo` skill. Wires up Expo's first-party CI/CD primitive, EAS Workflows, for native builds, OTA updates, and store submissions. Independent of Uniwind / component library; can be applied to any Expo app produced by this skill (or a comparable layout). Do not skip steps and do not paraphrase commands or code snippets, copy them as written.

Source: <https://docs.expo.dev/eas/workflows/get-started/>

## When to use

- User asks to set up EAS Workflows on a new or existing Expo app.
- User asks to automate Expo builds, add CI/CD to their Expo app, deploy to App Store / Play Store, or run release pipelines.
- Chained from [scaffold.md](./scaffold.md) when the user opted into EAS in scaffold step 1.
- Triggers: "set up eas workflows", "add expo ci", "automate expo builds", "expo cd", "expo release pipeline".

## Prerequisites

1. Expo account (sign up at <https://expo.dev/signup>).
2. Existing Expo app at the target directory (this skill's base scaffold or equivalent).
3. For iOS submit: App Store Connect numeric App ID and Apple Developer Team ID. The user must have an active Apple Developer Program membership and an app record in App Store Connect.
4. `eas-cli` installed globally (a setup step below verifies and installs it via `bun add -g eas-cli` if missing).
5. `expect` binary available (used by the build-number sync script). Preinstalled on macOS; on Linux CI run `apt-get install -y expect`.
6. An Expo access token to use for non-interactive `eas` commands. Generate at <https://expo.dev/accounts/[account]/settings/access-tokens>.
7. The app's GitHub repo, with a fine-grained GitHub token on it scoped to **Contents: read and write**. The production workflows tag every binary and OTA update through the GitHub API with it (step 14).

## Steps

1. Before running any commands, collect the following from the user. Do not proceed until all are confirmed:
   - **`<WORKING_DIRECTORY>`** — the path each workflow should `cd` into before running its commands.
     - **Standalone app** (this skill's default scaffold output, where `package.json` lives at the repo root): the user does **not** need a `working_directory` at all. The workflow assets ship with a placeholder; you will delete the entire `defaults.run` block in step 6.
     - **Monorepo app** (the Expo app lives at `./apps/<app_folder>` inside a workspace root): use `./apps/<app_folder>` matching the actual workspace path.
   - **`<ios_app_store_id>`** — App Store Connect numeric App ID (find in ASC → My Apps → your app → App Information → Apple ID).
   - **`<ios_apple_team_id>`** — Apple Developer Team ID (10-char alphanumeric, find in <https://developer.apple.com/account> → Membership).
   - **`<GITHUB_REPOSITORY>`** — `owner/repo` the tags are written to (default: parse `git remote get-url origin`).
   - **`<EXPO_ACCOUNT>`** / **`<EXPO_SLUG>`** — the Expo account (`owner` in `app.config.ts`) and project `slug`. Used for the expo.dev links in tag messages.
   - **`<TAG_PREFIX>`** — first path segment of every tag, e.g. `my-app` → `my-app/build/ios/1.0.0+5` (default: the app slug; in a monorepo, the app folder name).
   - **`<APP_LABEL>`** — human app name for tag messages, e.g. `My App` (default: the `name` in `app.config.ts`).

2. Ensure `eas-cli` is installed globally. If missing, install it with Bun:

   ```sh
   if ! command -v eas >/dev/null 2>&1; then
     bun add -g eas-cli
   fi
   eas --version
   ```

3. Log in to EAS (skip if already logged in):

   ```sh
   eas login
   ```

4. Initialize the EAS project from the app directory. This creates the EAS project on the dashboard and writes `extra.eas.projectId` into `app.config.ts`:

   ```sh
   eas init
   ```

5. Copy the asset `eas.json` to the project root:

   ```sh
   cp <skill-dir>/assets/eas/eas.json ./eas.json
   ```

   Replace `<skill-dir>` with the absolute path to `skills/mobile/dlc-expo/` inside this repo. If `eas init` already created an `eas.json` (typically `{}`), overwrite it.

   Then substitute the iOS submit placeholders with the values from step 1:

   ```diff
            "ios": {
   -          "ascAppId": "<ios_app_store_id>",
   -          "appleTeamId": "<ios_apple_team_id>"
   +          "ascAppId": "<value collected in step 1>",
   +          "appleTeamId": "<value collected in step 1>"
            }
   ```

   The asset `eas.json` defines build profiles `base` / `ios-simulator` / `development` / `cicd` / `production` and submit profile `production`, all aligned with the workflow YAMLs in step 6. Do not rename these profiles — the workflows reference them by name.

6. Copy the four asset workflow YAMLs into `<project-root>/.eas/workflows/`:

   ```sh
   mkdir -p .eas/workflows
   cp <skill-dir>/assets/eas/workflows/*.yml ./.eas/workflows/
   ```

   Then mutate each YAML's top-level `defaults.run` block based on app layout:

   - **Standalone app** — delete the entire `run:` block (keep `defaults.tools`):

     ```diff
      defaults:
        tools:
          bun: 1.3.5
     -  run:
     -    working_directory: <WORKING_DIRECTORY>
     ```

     Also delete every per-step `working_directory: .` override on the `extract_version` job — the `parse` step in `build:native:prod.yml`, and both the `parse` and `mode` steps in `release:prod.yml`. Without a default `working_directory`, the per-step override is meaningless:

     ```diff
            steps:
              - id: parse
                name: Parse version
     -          working_directory: .
                run: |
     ```

   - **Monorepo app** — substitute `<WORKING_DIRECTORY>` with the value collected in step 1 (e.g. `./apps/my-app`). Leave the per-step `working_directory: .` overrides alone — they exist so the version-parse step runs from the workspace root rather than the app subdirectory.

7. Wire `app.config.ts` to the `APP_VERSION` env var so the production workflows' parsed branch version flows into the built binary. Add the constant at the top of the file and reference it from `expo.version`:

   ```diff
    import type { ExpoConfig } from "expo/config";

   +const APP_VERSION = (process.env as Record<string, string | undefined>).APP_VERSION ?? "0.0.0";
   +
    const expoConfig: ExpoConfig = {
      name: "<app-name>",
      slug: "<app-name>",
      scheme: "<app-name>",
   -  version: "0.0.0",
   +  version: APP_VERSION,
   ```

   Without this, the `APP_VERSION` exported by `build:native:prod.yml` and `release:prod.yml` (the `version` dispatch input, else parsed from the `release/app/*` branch name) is never read and the built binary keeps whatever literal was in the config.

8. Install `dotenv-cli` as a dev dependency. The `"eas"` npm script added in step 11 wraps every `eas:*` invocation with `dotenv -e .env` so `EXPO_TOKEN` (and any other local env vars) are loaded from `.env`:

   ```sh
   bun add -D dotenv-cli
   ```

9. Copy the EAS scripts into the app's `scripts/` directory:

   ```sh
   mkdir -p scripts
   cp <skill-dir>/assets/scripts/eas-sync-build-numbers.ts ./scripts/eas-sync-build-numbers.ts
   cp <skill-dir>/assets/scripts/eas-check-channel.ts ./scripts/eas-check-channel.ts
   cp <skill-dir>/assets/scripts/eas-tag.ts ./scripts/eas-tag.ts
   cp <skill-dir>/assets/scripts/eas-tag.test.ts.tmpl ./scripts/eas-tag.test.ts
   ```

   - `eas-sync-build-numbers.ts` — reads the current Android `versionCode` and iOS `buildNumber` from EAS, takes the max, increments by 1, and writes the synchronized value back to both platforms.
   - `eas-check-channel.ts` — run by `release:prod`'s `check_update_channel` job. Fails the run when the `production` channel has no branch linked, so OTA updates never publish to nowhere.
   - `eas-tag.ts` — run by the `tag_*` jobs in `build:native:prod` and `release:prod`. Creates an annotated GitHub tag on the commit each production binary was built from (`<TAG_PREFIX>/build/<platform>/<version>+<build>`) and each OTA update was bundled from (`<TAG_PREFIX>/update/<platform>/<version>+<build>/<group8>`). Idempotent on re-run; never moves an existing tag. Dependency-free.
   - `eas-tag.test.ts` — `bun test` suite for `eas-tag.ts`. Also asserts the constants match `app.config.ts`'s `owner` / `slug`. Shipped as `eas-tag.test.ts.tmpl` so `bun test` in this skills repo never picks it up; drop the `.tmpl` on copy.

   Then substitute the placeholder constants at the top of `scripts/eas-tag.ts` with the values from step 1:

   ```diff
   -export const GITHUB_REPOSITORY = "<GITHUB_REPOSITORY>";
   -export const EXPO_ACCOUNT = "<EXPO_ACCOUNT>";
   -export const EXPO_SLUG = "<EXPO_SLUG>";
   -export const TAG_PREFIX = "<TAG_PREFIX>";
   -export const APP_LABEL = "<APP_LABEL>";
   +export const GITHUB_REPOSITORY = "acme/my-app";
   +export const EXPO_ACCOUNT = "acme";
   +export const EXPO_SLUG = "my-app";
   +export const TAG_PREFIX = "my-app";
   +export const APP_LABEL = "My App";
   ```

   If `app.config.ts` has no `owner`, add `owner: "<EXPO_ACCOUNT>"` to it. Verify with `bun test scripts/eas-tag.test.ts`.

   For monorepo apps, run this from the app directory (e.g. `./apps/<app_folder>`) so the scripts live next to that app's `package.json` — the workflow jobs run `bun scripts/…` from `<WORKING_DIRECTORY>`.

10. Copy the `.env.example` and create a working `.env`:

    ```sh
    cp <skill-dir>/assets/env/.env.example ./.env.example
    cp ./.env.example ./.env
    ```

    Instruct the user to fill in `EXPO_TOKEN` in `.env` with the token they generated (see Prerequisites item 6). `.env.example` should be committed; `.env` must be gitignored (it is in this skill's base scaffold — verify the project's root `.gitignore` includes `.env`).

11. Add the following entries to the app's `package.json` `scripts` object:

    ```jsonc
    {
      "scripts": {
        "eas": "dotenv -e .env eas",
        "eas:sync-build-numbers": "bun ./scripts/eas-sync-build-numbers.ts",
        "eas:build:native:dev": "bun run eas workflow:run build:native:dev.yml",
        "eas:build:native:prod": "bun run eas workflow:run \"build:native:prod.yml\"",
        "eas:release:prod": "bun run eas workflow:run release:prod.yml",
        "eas:submit:prod": "bun run eas workflow:run submit:native:prod.yml"
      }
    }
    ```

    What each script does:
    - `eas` — `dotenv`-wrapped pass-through to the `eas` CLI. All the other `eas:*` scripts invoke it via `bun run eas …` so `EXPO_TOKEN` (and any other `.env` values) are injected.
    - `eas:sync-build-numbers` — runs the asset script from step 9. Use before cutting a production build so both platforms start a release at the same `max+1` build number.
    - `eas:build:native:dev` — manually trigger the dev-client build workflow. Takes no inputs.
    - `eas:build:native:prod` — manually trigger a forced production build + submit. Manual only, so it **requires** the `version` input (`eas workflow:run` carries no branch ref to parse).
    - `eas:release:prod` — manually trigger the release pipeline (fingerprint reuse + OTA or native submit). Takes `version` and optional `force_native`.
    - `eas:submit:prod` — manually trigger a fingerprint-only submit for builds already produced out-of-band. Takes no inputs.

    Pass `workflow_dispatch` inputs with `-F key=value`; `bun run` forwards trailing args to the script:

    ```sh
    bun run eas:build:native:prod -F version=1.2.0
    bun run eas:release:prod -F version=1.2.0
    bun run eas:release:prod -F version=1.2.0 -F force_native=true
    ```

    | Workflow | Input | Type | Default | Purpose |
    | --- | --- | --- | --- | --- |
    | `build:native:prod` | `version` | string | branch name | `x.y.z` exported as `APP_VERSION`. Required in practice — manual runs have no `release/app/*` ref. |
    | `release:prod` | `version` | string | branch name | `x.y.z` exported as `APP_VERSION`. Falls back to the `release/app/x.y.z` branch on push. |
    | `release:prod` | `force_native` | boolean | `false` | Build + submit both platforms even when the fingerprint already has a binary, instead of shipping OTA. |

12. (Optional) Connect the GitHub repo so push triggers fire. `release:prod.yml` listens for pushes to `release/app/*` branches (`build:native:prod.yml` is `workflow_dispatch` only, so one push never double-builds); without GitHub integration these workflows must be invoked manually (use the `eas:*` scripts from step 11). Steps:
    - Open the project on the EAS dashboard → **Project settings → GitHub**.
    - Install the EAS GitHub app and select the matching repo.
    - See <https://docs.expo.dev/eas/workflows/syntax/#on> for the full trigger reference.

13. Link the `production` update channel to the `production` branch. A channel is created by the first build that names it and `eas update` never links it, so until this runs `check_update_channel` fails every `release:prod` run that would publish an OTA update:

    ```sh
    bun run eas channel:edit production --branch production
    ```

    If the channel does not exist yet (no production build has run), create it first with `bun run eas channel:create production`, then link it.

14. Store the GitHub token from Prerequisites item 7 as an EAS secret in the `production` environment. The `tag_*` jobs read it as `GITHUB_TAG_TOKEN`:

    ```sh
    bun run eas env:create production --name GITHUB_TAG_TOKEN --value <token> --visibility secret
    ```

    Without it, every tag job fails with the exact command above in its log; builds, submits and updates still succeed.

15. Validate the setup by manually running a workflow:

    ```sh
    bun run eas:build:native:dev
    ```

    Watch the run on the project's workflows page on the EAS dashboard.

## What each workflow does

- **`build:native:dev.yml`** — fingerprints the current commit, then for each of (Android dev, iOS dev, iOS simulator/`cicd`) checks if a build with the matching fingerprint already exists. If yes, reuses it; if no, builds in parallel. Use this on PRs.
- **`build:native:prod.yml`** — `workflow_dispatch` only (`-F version=x.y.z`). Validates the semver `version` input, exports it as `APP_VERSION`, fingerprints, then always builds and submits production iOS + Android natively to the stores, skipping fingerprint reuse, and tags each binary on GitHub. Use to force fresh binaries outside the release pipeline.
- **`release:prod.yml`** — triggered by push to `release/app/*` **or** `workflow_dispatch`. Version comes from the `version` input, else the branch name (e.g. `release/app/1.0.0` → `1.0.0`). Reuses existing native builds via fingerprint and publishes an OTA update on `branch: production`; otherwise builds + submits new natives. Force the native path with `-F force_native=true`, or by putting `[native]` in the head commit message of the push (the PR title, under squash merge). A `check_update_channel` job gates both OTA publishes on the `production` channel having a linked branch. Every binary and update it ships is tagged on GitHub on the commit it came from (`tag_*_build` / `tag_*_update`, each gated only by `needs`). Use when cutting a release that may or may not need new native binaries.
- **`submit:native:prod.yml`** — fingerprint-only submit. Looks up existing production builds by hash and submits them to the stores. Use when builds were already produced out-of-band (e.g. local `eas build`) and you just need to ship them.

## Edge cases

- `${{ inputs.* }}`, `${{ github.ref_name }}` and `${{ github.commit_message }}` render as the literal string `undefined` when their context is absent (a push has no `inputs`; `eas workflow:run` has no ref or commit message). The `extract_version` job normalises them with `case` before testing, and resolves `force_native` / `[native]` once into its `native` output so each job's `if:` compares a real `'true'`. Keep that pattern when adding inputs; do not test `inputs.*` directly in `if:`.
- Do not add a `push` trigger back to `build:native:prod.yml`. Two workflows on the same `release/app/*` branch double-build and double-submit.

- The `cicd` iOS profile (in both `eas.json` and `build:native:dev.yml`) is for simulator builds used by automated UI testing. If the user has no testing pipeline, they can delete the `get_cicd_build` and `build_cicd` jobs from `build:native:dev.yml` and the `cicd` build profile from `eas.json`.
- Tag jobs write through the GitHub REST API, not `git push` — an EAS custom job has a checkout but no push credentials, and a manual `eas workflow:run` uploads the local tree. So a manual run on a commit GitHub has never seen fails its tag jobs with "push the commit before running it"; push first.
- The user does not want GitHub tags: delete the `tag_*` jobs from `build:native:prod.yml` and `release:prod.yml`, skip `eas-tag.ts` / `eas-tag.test.ts` in step 9 and skip step 14. Nothing else `needs` them.
- The user does not ship OTA updates: delete `check_update_channel`, the `publish_*_update` and `tag_*_update` jobs from `release:prod.yml`, skip `eas-check-channel.ts` and step 13.
- `eas` is not on the PATH of an EAS custom job, so `eas-check-channel.ts` runs the CLI via `bunx eas-cli@latest`.
- `appVersionSource: "remote"` in `eas.json` means version numbers are tracked on EAS servers, not in `app.config.ts`. Before the first production build, run `bun run eas:sync-build-numbers` once to seed a synchronized baseline for both platforms — otherwise `autoIncrement` on the `production` profile has no starting value and Android/iOS can drift.
- `eas-sync-build-numbers.ts` shells out to the `expect` binary to drive the interactive `eas build:version:set` prompt. macOS ships with it; on Linux CI images install via `apt-get install -y expect`.
- The asset `submit.base.android` block uses `track: internal` + `releaseStatus: draft`. Adjust if the user wants direct production-track submissions.
- If `eas init` warns that `app.config.ts` is dynamic and cannot be modified, manually paste the printed `projectId` into `app.config.ts` under `extra.eas.projectId`.

## Reference

- Get started with EAS Workflows: <https://docs.expo.dev/eas/workflows/get-started/>
- Workflow syntax: <https://docs.expo.dev/eas/workflows/syntax/>
- `eas.json` reference: <https://docs.expo.dev/eas/json/>
- Fingerprint-based reuse: <https://docs.expo.dev/eas/workflows/reference/fingerprint/>
