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

## Steps

1. Before running any commands, collect the following from the user. Do not proceed until all three are confirmed:
   - **`<WORKING_DIRECTORY>`** — the path each workflow should `cd` into before running its commands.
     - **Standalone app** (this skill's default scaffold output, where `package.json` lives at the repo root): the user does **not** need a `working_directory` at all. The workflow assets ship with a placeholder; you will delete the entire `defaults.run` block in step 6.
     - **Monorepo app** (the Expo app lives at `./apps/<app_folder>` inside a workspace root): use `./apps/<app_folder>` matching the actual workspace path.
   - **`<ios_app_store_id>`** — App Store Connect numeric App ID (find in ASC → My Apps → your app → App Information → Apple ID).
   - **`<ios_apple_team_id>`** — Apple Developer Team ID (10-char alphanumeric, find in <https://developer.apple.com/account> → Membership).

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

     Also delete the per-step `working_directory: .` override on the `extract_version` step in `build:native:prod.yml` and `release:prod.yml` — without a default `working_directory`, the per-step override is meaningless:

     ```diff
            steps:
              - id: parse
                name: Parse version from branch
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

   Without this, the `APP_VERSION` exported by `build:native:prod.yml` and `release:prod.yml` (parsed from the `release/app/*` branch name) is never read and the built binary keeps whatever literal was in the config.

8. Install `dotenv-cli` as a dev dependency. The `"eas"` npm script added in step 11 wraps every `eas:*` invocation with `dotenv -e .env` so `EXPO_TOKEN` (and any other local env vars) are loaded from `.env`:

   ```sh
   bun add -D dotenv-cli
   ```

9. Copy the build-number sync script into the app's `scripts/` directory. This script reads the current Android `versionCode` and iOS `buildNumber` from EAS, takes the max, increments by 1, and writes the synchronized value back to both platforms:

   ```sh
   mkdir -p scripts
   cp <skill-dir>/assets/scripts/eas-sync-build-numbers.ts ./scripts/eas-sync-build-numbers.ts
   ```

   For monorepo apps, run this from the app directory (e.g. `./apps/<app_folder>`) so the script lives next to that app's `package.json`.

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
    - `eas:build:native:dev` / `eas:build:native:prod` — manually trigger the respective native-build workflow without pushing to `release/app/*`.
    - `eas:release:prod` — manually trigger the release pipeline (fingerprint reuse + OTA or native submit).
    - `eas:submit:prod` — manually trigger a fingerprint-only submit for builds already produced out-of-band.

12. (Optional) Connect the GitHub repo so push triggers fire. `build:native:prod.yml` listens for pushes to `release/app/*` branches; without GitHub integration these workflows must be invoked manually (use the `eas:*` scripts from step 11). Steps:
    - Open the project on the EAS dashboard → **Project settings → GitHub**.
    - Install the EAS GitHub app and select the matching repo.
    - See <https://docs.expo.dev/eas/workflows/syntax/#on> for the full trigger reference.

13. Validate the setup by manually running a workflow:

    ```sh
    bun run eas:build:native:dev
    ```

    Watch the run on the project's workflows page on the EAS dashboard.

## What each workflow does

- **`build:native:dev.yml`** — fingerprints the current commit, then for each of (Android dev, iOS dev, iOS simulator/`cicd`) checks if a build with the matching fingerprint already exists. If yes, reuses it; if no, builds in parallel. Use this on PRs.
- **`build:native:prod.yml`** — triggered by push to `release/app/*`. Parses the semver version out of the branch name (e.g. `release/app/1.0.0` → `1.0.0`), exports it as `APP_VERSION`, fingerprints, then builds and submits production iOS + Android natively to the stores.
- **`release:prod.yml`** — manually-triggered release pipeline. Same version-from-branch parsing as the prod build workflow. Reuses existing native builds via fingerprint and publishes an OTA update on `branch: production`; otherwise builds + submits new natives. Use when cutting a release that may or may not need new native binaries.
- **`submit:native:prod.yml`** — fingerprint-only submit. Looks up existing production builds by hash and submits them to the stores. Use when builds were already produced out-of-band (e.g. local `eas build`) and you just need to ship them.

## Edge cases

- The `cicd` iOS profile (in both `eas.json` and `build:native:dev.yml`) is for simulator builds used by automated UI testing. If the user has no testing pipeline, they can delete the `get_cicd_build` and `build_cicd` jobs from `build:native:dev.yml` and the `cicd` build profile from `eas.json`.
- The commented tag jobs at the bottom of `release:prod.yml` rely on `scripts/tag-build.ts` and `scripts/tag-update.ts` that this skill does not generate. Leave them commented unless the user supplies those scripts.
- `appVersionSource: "remote"` in `eas.json` means version numbers are tracked on EAS servers, not in `app.config.ts`. Before the first production build, run `bun run eas:sync-build-numbers` once to seed a synchronized baseline for both platforms — otherwise `autoIncrement` on the `production` profile has no starting value and Android/iOS can drift.
- `eas-sync-build-numbers.ts` shells out to the `expect` binary to drive the interactive `eas build:version:set` prompt. macOS ships with it; on Linux CI images install via `apt-get install -y expect`.
- The asset `submit.base.android` block uses `track: internal` + `releaseStatus: draft`. Adjust if the user wants direct production-track submissions.
- If `eas init` warns that `app.config.ts` is dynamic and cannot be modified, manually paste the printed `projectId` into `app.config.ts` under `extra.eas.projectId`.

## Reference

- Get started with EAS Workflows: <https://docs.expo.dev/eas/workflows/get-started/>
- Workflow syntax: <https://docs.expo.dev/eas/workflows/syntax/>
- `eas.json` reference: <https://docs.expo.dev/eas/json/>
- Fingerprint-based reuse: <https://docs.expo.dev/eas/workflows/reference/fingerprint/>
