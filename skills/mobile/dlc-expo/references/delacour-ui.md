# Delacour UI Setup (detailed procedure)

Optional add-on for the `dlc-expo` skill. Follow these steps only when the user picks **Delacour UI** as the component library (see the component-library prompt in [../SKILL.md](../SKILL.md)). **Requires Uniwind setup** ([./uniwind.md](./uniwind.md)) to be completed first — Delacour UI is styled with Uniwind + Tailwind v4. Do not skip steps and do not paraphrase commands or code snippets, copy them as written.

Source: <https://ui.delacour.co.nz/docs/native/getting-started> (every docs page is available as Markdown by appending `.md`; full index at <https://ui.delacour.co.nz/llms.txt>)

> Delacour UI is **copy-in, not a package**. The `delacour` CLI copies each component's `.tsx` into `src/components/ui/<name>/` with imports rewritten onto this project's aliases. The app owns that source. There is no package barrel to import from.

> Delacour UI targets iOS and Android. It uses native modules (Reanimated, Gesture Handler, Keyboard Controller, Bottom Sheet), so it needs a dev-client build, not Expo Go — which the base scaffold already provides.

## Steps

1. **Prerequisite check.** Confirm `uniwind` and `tailwindcss` are installed (check `package.json`) and that `src/styles/global.css` and a `withUniwindConfig`-wrapped `metro.config.js` exist. If any of these are missing, run [./uniwind.md](./uniwind.md) end-to-end first, then return here.

   - The CLI can set Uniwind up on its own, but it would write its own CSS entry. Running `uniwind.md` first keeps the entry at `src/styles/global.css`; the CLI reads the entry off the Metro config and appends its block to it rather than creating a second file.
   - **Check for NativeWind.** If `nativewind` is in `package.json` or `metro.config.js` wraps with `withNativeWind`, stop and ask the user. Two Tailwind transforms cannot share one Metro config and fail silently. Migrate first via <https://docs.uniwind.dev/migration-from-nativewind>.
   - **Check for HeroUI Native.** If `heroui-native` is installed, confirm with the user before continuing — running both libraries means two providers, two themes and two token sets.

2. Add the `@/*` path alias so the CLI writes `@/components/ui/<name>` imports (the form every Delacour UI docs page uses). `app.config.ts` from the base scaffold already sets `experiments.tsconfigPaths: true`; add `paths` to `tsconfig.json` under `compilerOptions`:

   ```json
   {
     "extends": "expo/tsconfig.base",
     "compilerOptions": {
       "strict": true,
       "paths": {
         "@/*": ["./src/*"]
       }
     }
   }
   ```

   - Merge into the existing `compilerOptions` — do not drop keys the template already set.
   - Without the alias the CLI falls back to relative imports. That works, but mixes badly with docs examples.

3. Add the first components. `add` initialises the project on first run — writes `native-components.json`, confirms the `withUniwindConfig` wrap, appends the `@source` globs and theme block to `src/styles/global.css`, and copies the theme and `DelacourProvider` into `src/components/ui/` — then copies the named components and installs what they need:

   ```sh
   bunx delacour@alpha add button --install
   ```

   - Add more components by name in the same command, e.g. `bunx delacour@alpha add button input field --install`.
   - `--install` runs the installs, native modules through `expo install`. If the user wants to review first, drop `--install` and run the printed commands **verbatim**. Never swap an `expo install` line for `bun add` — the newest release of a native module fails at the linker on an older SDK.
   - Run `bunx delacour@alpha list` to see every available component, and `bunx delacour@alpha view <name>` for one component's files, props and dependencies.
   - Monorepo (components belong to a shared package) or a source dir not called `src`: run `init` deliberately first, e.g. `bunx delacour@alpha init --src app --package-name @acme/ui --package-path packages/ui`. See <https://ui.delacour.co.nz/docs/native/cli/monorepo>.

4. Review `src/styles/global.css` after `add` runs. It must still start with the Uniwind imports and keep the `src/` scan from [./uniwind.md](./uniwind.md) step 3; the CLI's block (theme + `@source` for `src/components/ui`) sits beneath. Do not hand-add a `.dark { … }` block — Uniwind registers it as a utility class named `dark` and the dark theme silently never applies. Themes use `@variant light` / `@variant dark`.

5. Mount the provider. Overwrite `src/app/_layout.tsx` (replacing the Uniwind-era version) with:

   ```tsx
   import "../styles/global.css";
   import { DelacourProvider } from "@/components/ui/provider";
   import { Stack } from "expo-router";

   export default function RootLayout() {
     return (
       <DelacourProvider>
         <Stack screenOptions={{ headerShown: false }} />
       </DelacourProvider>
     );
   }
   ```

   - The `import "../styles/global.css";` line stays the **first statement** — anywhere else and every component renders unstyled with no error.
   - `DelacourProvider` already composes `GestureHandlerRootView` → `SafeAreaProvider` → `KeyboardProvider` → `KeyboardStateSync` → `BottomSheetModalProvider`. Do **not** add another `GestureHandlerRootView` or `KeyboardProvider` around it — nesting `KeyboardProvider` breaks keyboard state app-wide.
   - Passing `style` to `DelacourProvider` replaces the gesture root's default `{ flex: 1 }`; include `flex: 1` yourself.
   - Drop `screenOptions={{ headerShown: false }}` if the app wants native headers.

6. Rebuild the native projects. `add` pulled in native modules (`react-native-reanimated`, `react-native-gesture-handler`, `react-native-worklets`, `react-native-keyboard-controller`, …) that a JS reload cannot load:

   ```sh
   bun run prebuild
   ```

   Then run on device to rebuild and reinstall:

   ```sh
   bun ios
   # or
   bun android
   ```

   Repeat this rebuild every time a later `add` installs a new native module.

7. Smoke test. Edit `src/app/index.tsx` to render the Delacour UI `Button`:

   ```tsx
   import { Button } from "@/components/ui/button";
   import { useState } from "react";
   import { View } from "react-native";

   export default function Index() {
     const [count, setCount] = useState(0);

     return (
       <View className="flex-1 items-center justify-center gap-4 bg-background">
         <Button onPress={() => setCount(count + 1)}>Pressed {count} times</Button>
         <Button variant="outline" onPress={() => setCount(0)}>
           Reset
         </Button>
       </View>
     );
   }
   ```

   On device, verify:
   - Both buttons render centered with Delacour UI styling (plain text on white = CSS import missing or not first).
   - Tapping increments the count (renders but ignores taps = provider missing).
   - `bg-background` follows the system light/dark setting.
   - Hot reload still works after editing the file (no full reload).

8. Check the wiring. Every check is a failure that produces no error on its own:

   ```sh
   bunx delacour@alpha doctor
   ```

   Fix anything it names before writing screens. Run it again whenever a component renders unstyled, stops responding to touch, or loses classes in a release build — before changing any code.

9. **(Recommended) Install the Delacour UI agent skill** into the new app so future agent sessions copy real components instead of writing look-alikes. It is bundled in the CLI and matches the pinned version:

   ```sh
   bunx delacour@alpha skills --agent claude
   ```

   - `--agent all` writes it for Claude Code, Cursor, OpenCode and Codex. `--list` previews without writing.
   - Optional: the MCP server (`bunx delacour@alpha mcp`) exposes `list_components`, `get_component`, `add_components`, `init_project` and `check_project` as tools. See <https://ui.delacour.co.nz/docs/native/cli/mcp>.

## Conventions for screens built on Delacour UI

- **Always `list` before writing UI.** A component that exists is added with `add`, never hand-written.
- **Import from the project path** — `@/components/ui/button`. `import { Button } from "@delacour/react-native-ui"` does not resolve.
- **Read `src/components/ui/<name>/AGENTS.md` before editing a component.** The CLI writes one beside each; it holds the edge-case reasoning.
- **Semantic tokens only** — `bg-background`, `text-muted-foreground`, `border-border`, `bg-primary`. No hex literals, no `dark:` prefix.
- **One size scale** — set `sm` / `md` / `lg` on the root; parts inherit through context.
- **Compound parts** — `Field.Label`, `Button.Label`, `Accordion.Item` / `.Trigger` / `.Content`. Use `view <name>` to confirm part names; a wrong one throws at runtime, not in the type checker.
- **Theme lives in one file.** Build a palette at <https://ui.delacour.co.nz/theme> and paste its `theme.css` tab over the copied theme, or convert a web app's with `bunx delacour@alpha theme ./globals.css`.
- UI primitives live in `src/components/ui/`; feature code stays in `src/modules/<domain>/` per [./modules.md](./modules.md) and composes those primitives.

## Reference

- Quick start: <https://ui.delacour.co.nz/docs/native/getting-started>
- Installation: <https://ui.delacour.co.nz/docs/native/getting-started/installation>
- Provider: <https://ui.delacour.co.nz/docs/native/getting-started/provider>
- Theming: <https://ui.delacour.co.nz/docs/native/getting-started/theming>
- Components: <https://ui.delacour.co.nz/docs/native/components>
- Agent skill: <https://ui.delacour.co.nz/skills/delacour-ui/SKILL.md>
- LLMs.txt: <https://ui.delacour.co.nz/docs/native/getting-started/llms>
- Uniwind Quickstart (prereq): <https://docs.uniwind.dev/quickstart>
