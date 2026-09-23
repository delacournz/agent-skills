---
name: dlc-expo
description: Scaffold a Expo app with TypeScript using Bun, typed `app.config.ts`, and Expo Router. Delegates the full scaffold procedure to `references/scaffold.md` (prompts for app name + iOS bundle identifier + Android package, runs `bun create expo-app` with `blank-typescript`, migrates `app.json` to `app.config.ts`, installs Expo Router + peers, wires up `src/app`). Use when the user asks to create a new Expo app, bootstrap a minimal React Native / Expo project with Bun, start a fresh Expo TypeScript project with file-based routing, or set up EAS Workflows / Expo CI/CD on an existing app. Triggers on phrases like "create expo app", "new expo typescript app", "bun create expo", "minimal expo app", "expo router app", "set up eas workflows", "add expo ci", "automate expo builds", "add heroui native", "add delacour ui", "add a component library".
metadata:
  author: chris@delacour.co.nz
  version: "1.1.0"
  category: mobile
  tags: [mobile, expo, expo-router, routing, react-native, bun, typescript, scaffolding, uniwind, tailwind, heroui, delacour-ui, eas, eas-workflows, ci-cd]
---

# Create Expo App (TypeScript, Bun)

Scaffold a brand-new Expo app with TypeScript using Bun as the package manager. This is the minimal path, no monorepo, no EAS workflows. Uniwind (Tailwind) is available as an optional add-on via [references/uniwind.md](./references/uniwind.md), and a component library (requires Uniwind) is available as a user choice between HeroUI Native via [references/heroui-native.md](./references/heroui-native.md) and Delacour UI via [references/delacour-ui.md](./references/delacour-ui.md).

## When to Use

- User asks for a Expo or React Native app
- User wants a minimal Expo + Bun setup without a monorepo
- User explicitly says "bun create expo", "new expo typescript app", etc.
- User asks to add Tailwind / Uniwind to an existing Expo app scaffolded by this skill (or a comparable minimal Expo + Bun setup), jump directly to [references/uniwind.md](./references/uniwind.md) without re-running the base scaffold
- User asks to add a component library to an existing Expo app. If they named one, jump directly to [references/heroui-native.md](./references/heroui-native.md) (HeroUI Native) or [references/delacour-ui.md](./references/delacour-ui.md) (Delacour UI); otherwise ask per [Component Library Choice](#component-library-choice). If Uniwind is not yet installed, run [references/uniwind.md](./references/uniwind.md) first, then continue
- User asks to set up EAS Workflows / CI/CD on an existing Expo app, jump directly to [references/eas-workflows.md](./references/eas-workflows.md) without re-running the base scaffold
- Triggers for the add-on flows: "add uniwind", "set up tailwind in this expo app", "install heroui native", "add delacour ui", "add a component library to my expo app", "set up eas workflows", "add expo ci", "automate expo builds"

## Prerequisites

1. Bun installed (`bun --version`). Install from <https://bun.sh> if missing.
2. Node.js LTS installed. `bun create expo` and `bun expo prebuild` still require Node per the Expo docs.
3. For native builds later: Xcode (iOS) and/or Android Studio.

## Rules / Steps

Follow the full procedure in [references/scaffold.md](./references/scaffold.md). Do not skip steps and do not paraphrase the commands or code snippets, copy them as written.

High-level outline:

1. Prompt the user for app name, iOS bundle identifier, Android package name, bundler port (default `8081`), and parent directory. Also ask whether to set up EAS Workflows (default `no`); if yes, also collect the iOS App Store Connect App ID and Apple Developer Team ID up front.
2. `bun create expo-app <app-name> --template blank-typescript`, then `cd` into it.
3. Replace `app.json` with a typed `app.config.ts` (iOS bundle id + Android package baked in); copy `assets/scripts/ensure-prebuild.ts` into the new app's `scripts/`; rewrite the `package.json` `scripts` block to use `prebuild` / `ensure-prebuild` / `start` / `dev` / `ios` / `android` (ios+android via `expo run:* --device --port <bundler_port>`, all run commands gated by `bun ensure-prebuild`; drops `web`).
4. `bun install`, then `bunx expo install` the Expo Router peer set plus `expo-dev-client`.
5. Overwrite `index.ts` with `import "expo-router/entry";`, delete `App.tsx`, and scaffold `src/app/_layout.tsx` + `src/app/index.tsx`.
6. Scaffold the colocated module pattern under `src/modules/` per [references/modules.md](./references/modules.md). Creates `src/modules/AGENTS.md` + `src/modules/CLAUDE.md` documenting the per-domain `components/` / `sheets/` / `contexts/` / `hooks/` / `utils/` convention. No code, no empty subfolders, subfolders are added on demand per module.
7. `bun ios` / `bun android` / `bun dev` (the `ensure-prebuild` guard auto-runs `expo prebuild` on first invocation).
8. **Optional:** if the user wants Tailwind-style styling, follow [references/uniwind.md](./references/uniwind.md) after the base scaffold completes. It installs `uniwind` + `tailwindcss`, creates `src/styles/global.css`, imports it from `src/app/_layout.tsx`, and wires `metro.config.js` with `withUniwindConfig`.
9. **Optional (requires step 8):** after Uniwind setup completes, ask which component library to install per [Component Library Choice](#component-library-choice), then follow the matching reference. If the user requests a library first without Uniwind, run [references/uniwind.md](./references/uniwind.md) first, then continue.
10. **Optional (independent of Uniwind / component library):** if the user opted into EAS Workflows in step 1 (or asks for CI/CD on an existing app), follow [references/eas-workflows.md](./references/eas-workflows.md). It collects `<WORKING_DIRECTORY>` + iOS App Store Connect ID + Apple Team ID, runs `bunx eas-cli init`, copies a parameterized `eas.json` and four workflow YAMLs (`build:native:dev`, `build:native:prod`, `release:prod`, `submit:native:prod`) into the project, and walks through the standalone-vs-monorepo `working_directory` adjustment.

## Component Library Choice

Ask the user which React Native component library to use. Use the harness's question tool (`AskUserQuestion` in Claude Code) when available. Exactly one library per app.

| Option | Model | Reference |
| --- | --- | --- |
| **Delacour UI** | Copy-in source via the `delacour` CLI into `src/components/ui/`; app owns and edits the code; `DelacourProvider` | [references/delacour-ui.md](./references/delacour-ui.md) |
| **HeroUI Native** | npm package `heroui-native` with pinned peer deps; `HeroUINativeProvider` + `GestureHandlerRootView` | [references/heroui-native.md](./references/heroui-native.md) |
| **None** | Uniwind classNames only | n/a |

- Both require Uniwind ([references/uniwind.md](./references/uniwind.md)) and both keep the CSS entry at `src/styles/global.css`.
- Never install both in one app: two providers, two gesture roots and two token sets.
- If the project already has one installed (`heroui-native` in `package.json`, or `native-components.json` / `src/components/ui/provider` for Delacour UI), skip the prompt and use that library.

## Edge Cases

- If `bun create expo-app` errors mentioning Node, install Node LTS and retry.
- Do not scaffold inside a non-empty directory unless the user confirms.

## Reference

- Using Bun with Expo: <https://docs.expo.dev/guides/using-bun/>
- Create Expo reference: <https://docs.expo.dev/more/create-expo/>
- Expo Router installation: <https://docs.expo.dev/router/installation/>
- Using a `src/` directory with Expo Router: <https://docs.expo.dev/router/reference/src-directory/>
- `app.config.ts` / dynamic config: <https://docs.expo.dev/workflow/configuration/>
- Uniwind Quickstart: <https://docs.uniwind.dev/quickstart>
- HeroUI Native Quick Start: <https://www.heroui.com/docs/native/getting-started/quick-start>
- Delacour UI Quick Start: <https://ui.delacour.co.nz/docs/native/getting-started>
- Delacour UI agent skill: <https://ui.delacour.co.nz/skills/delacour-ui/SKILL.md>
- EAS Workflows: <https://docs.expo.dev/eas/workflows/get-started/>
- `eas.json` reference: <https://docs.expo.dev/eas/json/>
