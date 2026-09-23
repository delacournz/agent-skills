# Expo App Scaffold (detailed procedure)

Follow these steps in order when creating a new Expo app via the `dlc-expo` skill. Each step includes the exact commands and file contents to use. Do not skip steps and do not paraphrase commands or code snippets, copy them as written.

## Steps

1. Before running any commands, collect the following from the user. Do not proceed until all seven are confirmed:
   - **App name / directory name** (e.g. `my-app`). Used for the folder, `expo.name`, `expo.slug`, and `expo.scheme`.
   - **iOS bundle identifier** (reverse-DNS, e.g. `com.acme.myapp`). Used for `expo.ios.bundleIdentifier`.
   - **Android package name** (reverse-DNS, e.g. `com.acme.myapp`). Used for `expo.android.package`.
   - **Bundler port** (default `8081`). Used in the `dev`, `android`, and `ios` scripts in `package.json`.
   - Parent directory to scaffold into (default: current working directory).
   - **Component library?** (Delacour UI / HeroUI Native / none, default `none`). Any choice other than `none` implies Uniwind (step 14). Ask per the "Component Library Choice" section of [../SKILL.md](../SKILL.md). Defer the install until after Uniwind (see step 15).
   - **Set up EAS Workflows?** (yes/no, default `no`). If yes, also collect the iOS App Store Connect App ID and Apple Developer Team ID up front (used by [eas-workflows.md](./eas-workflows.md) step 1). Defer the actual EAS setup until after the base scaffold (and any Uniwind / component library add-ons); see step 16.

   Ask the user these up front. If the user provides only an app name, suggest `com.<user>.<appname>` defaults for both IDs but still confirm before writing them. If the user does not specify a port, use `8081`.

2. Create the app with the TypeScript template:

   ```sh
   bun create expo-app <app-name> --template blank-typescript
   ```

   - `--template blank-typescript` selects the minimal TypeScript template.
   - Only omit `--template` if the user explicitly wants the default tabs template.

3. `cd <app-name>`.
4. Migrate `app.json` to a typed `app.config.ts` at the project root. Delete `app.json` and create `app.config.ts`:

   ```ts
   import type { ExpoConfig } from "expo/config";

   const expoConfig: ExpoConfig = {
     name: "<app-name>",
     slug: "<app-name>",
     scheme: "<app-name>",
     version: "0.0.0",
     orientation: "portrait",
     userInterfaceStyle: "automatic",
     platforms: ["ios", "android"],
     // - newArchEnabled: true, <-- if this exists remove it as its enabled by default now
     ios: {
       supportsTablet: false,
       infoPlist: {
         ITSAppUsesNonExemptEncryption: false,
       },
       bundleIdentifier: "<ios-bundle-id>",
     },
     android: {
       package: "<android-package>",
     },
     plugins: [
       "expo-router",
       [
         "expo-dev-client",
         {
           launchMode: "most-recent",
         },
       ],
     ],
     experiments: {
       typedRoutes: true,
       tsconfigPaths: true,
       reactCompiler: true,
     },
   };

   export default expoConfig;
   ```

   Keep this minimal — Sentry, fonts, and other plugins are out of scope for this skill (EAS is handled separately by [eas-workflows.md](./eas-workflows.md)).

   Copy the prebuild guard script from this skill's assets into the new app:

   ```sh
   mkdir -p scripts
   cp <skill-dir>/assets/scripts/ensure-prebuild.ts ./scripts/ensure-prebuild.ts
   ```

   Replace `<skill-dir>` with the absolute path to this skill's directory (the agent runtime should resolve this automatically when invoking the skill). The script checks for the `ios/` and `android/` native project folders and runs `bun run prebuild` on demand, so the user never has to remember to prebuild manually.

   Replace the entire `scripts` block in `package.json` with the set below (drops `web`, adds `prebuild` + `ensure-prebuild` + `dev`, chains `ensure-prebuild` before every run command, and switches `ios` / `android` to `expo run:*` with `--device` + the chosen port). Substitute `<bundler_port>` with the port collected in step 1 (default `8081`):

   ```diff
      "scripts": {
   -    "start": "expo start",
   -    "android": "expo start --android",
   -    "ios": "expo start --ios",
   -    "web": "expo start --web"
   +    "prebuild": "bun expo prebuild",
   +    "ensure-prebuild": "bun scripts/ensure-prebuild.ts",
   +    "start": "bun ensure-prebuild && bun expo start --dev-client --clear",
   +    "dev": "bun ensure-prebuild && bun expo start --dev-client --clear --port <bundler_port>",
   +    "android": "bun ensure-prebuild && expo run:android --device --port <bundler_port>",
   +    "ios": "bun ensure-prebuild && expo run:ios --device --port <bundler_port>"
      },
   ```

   Notes:
   - `ios` / `android` use `expo run:*` (not `expo start`) because this app targets `expo-dev-client`, not Expo Go, and needs a prebuilt native project.
   - `start` and `dev` pass `--dev-client` so the bundler serves a dev-client-compatible bundle.
   - Every run command is gated by `bun ensure-prebuild`, so a stale clone without `ios/` or `android/` folders self-heals via `bun run prebuild`.

5. Verify dependencies are installed with Bun:

   ```sh
   bun install
   ```

6. Install Expo Router, `expo-dev-client`, and the required peers with the Expo-aware installer so versions match the installed SDK:

   ```sh
   bunx expo install expo-router expo-dev-client react-native-safe-area-context react-native-screens expo-linking expo-constants expo-status-bar
   ```

   `expo-dev-client` is required because `ios` / `android` scripts use `expo run:*` and `start` / `dev` pass `--dev-client`.

7. Upgrade to Expo SDK 55 and realign peer versions:

   ```sh
   bun install expo@^55.0.0
   bunx expo install --fix
   bunx expo-doctor
   ```

   - `bun install expo@^55.0.0` pins the Expo package to SDK 55.
   - `bunx expo install --fix` rewrites peer dependency versions (react, react-native, router, dev-client, etc.) to the versions the installed SDK expects.
   - `bunx expo-doctor` validates the resulting dependency tree. Resolve any warnings it reports before continuing.

8. Wire up the entry file. Overwrite the root `index.ts` with exactly:

   ```ts
   import "expo-router/entry";
   ```

   Then delete the template's `App.tsx` (unused). Leave `package.json` `"main": "index.ts"` unchanged.

9. Create the routes directory under `src/app`. Expo Router auto-discovers `src/app/` when `src/` exists at the project root, so no plugin config change is needed.

   `src/app/_layout.tsx` (root Stack):

   ```tsx
   import { Stack } from "expo-router";

   export default function RootLayout() {
     return <Stack />;
   }
   ```

   `src/app/index.tsx` (default screen):

   ```tsx
   import { Text, View } from "react-native";

   export default function Index() {
     return (
       <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
         <Text>Edit src/app/index.tsx to change this screen.</Text>
       </View>
     );
   }
   ```

10. Scaffold the module pattern under `src/modules/`. Follow [./modules.md](./modules.md) — it creates `src/modules/AGENTS.md` + `src/modules/CLAUDE.md` to document the colocated domain-module pattern (`components/`, `sheets/`, `contexts/`, `hooks/`, `utils/` created on demand per module). No code, no empty subfolders, no `.gitkeep` files.

11. When adding Expo-specific libraries later, use the Expo-aware installer so versions stay aligned with the installed Expo SDK:

    ```sh
    bunx expo install <package>
    ```

    Do not use `bun add` for Expo SDK packages, it will pick incompatible versions.

12. Run the app. The `ensure-prebuild` guard auto-runs `bun run prebuild` on first invocation if `ios/` or `android/` are missing, so no manual prebuild step is required:

    ```sh
    bun start          # Metro dev-client bundler (default port)
    bun dev            # Metro dev-client bundler on <bundler_port>
    bun ios            # build + run on a connected iOS device
    bun android        # build + run on a connected Android device
    ```

    Re-run `bun run prebuild` explicitly any time `app.config.ts` or native plugins change (the guard only runs it when the native folders are missing entirely).

13. If the template did not initialize git, initialize it:

    ```sh
    git init && git add . && git commit -m "initial expo app"
    ```

14. (Optional) If the user wants Tailwind-style styling, follow [./uniwind.md](./uniwind.md) after the base scaffold completes. Notes:
    - The CSS entry file lives at `src/styles/global.css` (not the project root).
    - Import it from `src/app/_layout.tsx`, **not** `index.ts` — importing from the registered root entry breaks hot reload per the Uniwind docs.

15. (Optional, requires step 14) If the user chose a component library in step 1, follow the matching reference after Uniwind is set up: [./delacour-ui.md](./delacour-ui.md) for Delacour UI, or [./heroui-native.md](./heroui-native.md) for HeroUI Native. The final step of `uniwind.md` chains into this; if the choice was not collected in step 1, it asks then.

16. (Optional, independent) If the user opted into EAS Workflows in step 1, follow [./eas-workflows.md](./eas-workflows.md) after the base scaffold (and any Uniwind / component library add-ons) complete. It installs `eas.json`, copies four parameterized workflow YAMLs into `.eas/workflows/`, and walks through the `working_directory` adjustment for standalone vs. monorepo layouts. Independent of Uniwind / component library; runs on any Expo app produced by this skill.
