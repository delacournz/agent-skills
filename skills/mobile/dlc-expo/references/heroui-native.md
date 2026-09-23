# HeroUI Native Setup (detailed procedure)

Optional add-on for the `dlc-expo` skill. Follow these steps only when the user picks **HeroUI Native** as the component library (see the component-library prompt in [../SKILL.md](../SKILL.md)); the alternative is Delacour UI ([./delacour-ui.md](./delacour-ui.md)). **Requires Uniwind setup** ([./uniwind.md](./uniwind.md)) to be completed first — HeroUI Native is built on Uniwind + Tailwind v4. Do not skip steps and do not paraphrase commands or code snippets, copy them as written.

Source: <https://www.heroui.com/docs/native/getting-started/quick-start>

> HeroUI Native targets iOS and Android only. It is **not** recommended for Expo web; use HeroUI React for web.

## Steps

1. **Prerequisite check.** Confirm `uniwind` and `tailwindcss` are installed (check `package.json`) and that `src/styles/global.css` and a `withUniwindConfig`-wrapped `metro.config.js` exist. If any of these are missing, run [./uniwind.md](./uniwind.md) end-to-end first, then return here.

2. Install HeroUI Native:

   ```sh
   bun add heroui-native
   ```

3. Install the mandatory peer dependencies. The HeroUI docs require these **exact versions** — version mismatches cause runtime bugs:

   ```sh
   bun add react-native-reanimated@^4.1.1 react-native-gesture-handler@^2.28.0 react-native-worklets@^0.5.1 react-native-safe-area-context@^5.6.0 react-native-svg@^15.12.1 tailwind-variants@^3.2.2 tailwind-merge@^3.4.0
   ```

   - `react-native-safe-area-context` was already installed by the base scaffold; this command pins it to the HeroUI-required version.
   - After installing, run `bunx expo-doctor` to confirm the dependency tree is still healthy. If it complains about Expo SDK alignment for any of these packages, run `bunx expo install --fix` and re-check.

4. Optional component-specific deps. Install only if the user plans to use these components:

   | Package | Version | Required for |
   | --- | --- | --- |
   | `react-native-screens` | `^4.16.0` | BottomSheet, Dialog, Menu, Popover, Select, Toast |
   | `@gorhom/bottom-sheet` | `^5.2.8` | BottomSheet, and Menu / Popover / Select when `presentation="bottom-sheet"` |

   `react-native-screens` is already installed by the base scaffold (via `bunx expo install react-native-screens`); verify the installed version meets `^4.16.0` and bump with `bun add react-native-screens@^4.16.0` if needed.

   ```sh
   bun add @gorhom/bottom-sheet@^5.2.8
   ```

5. Update `src/styles/global.css` to add the HeroUI imports and a `@source` pointing at the HeroUI lib inside `node_modules`. Because `global.css` lives at `src/styles/`, the relative path to `node_modules/heroui-native/lib` is `../../node_modules/heroui-native/lib`. Replace the file's contents with:

   ```css
   @import 'tailwindcss';
   @import 'uniwind';

   @import 'heroui-native/styles';

   @source '../**/*.{ts,tsx}';
   @source '../../node_modules/heroui-native/lib';
   ```

   - The `@source './node_modules/heroui-native/lib'` shown in the HeroUI docs assumes `global.css` is at the project root. Adjust it to `'../../node_modules/heroui-native/lib'` for our `src/styles/` layout.
   - Do not move `global.css` to the project root; keep it under `src/styles/` so Uniwind's hot-reload behavior (per its `Danger` callout) is preserved.

6. Wrap the app with `HeroUINativeProvider` and `GestureHandlerRootView`. Overwrite `src/app/_layout.tsx` (replacing the Uniwind-era version) with:

   ```tsx
   import "../styles/global.css";
   import { HeroUINativeProvider } from "heroui-native";
   import { Stack } from "expo-router";
   import { GestureHandlerRootView } from "react-native-gesture-handler";

   export default function RootLayout() {
     return (
       <GestureHandlerRootView style={{ flex: 1 }}>
         <HeroUINativeProvider>
           <Stack />
         </HeroUINativeProvider>
       </GestureHandlerRootView>
     );
   }
   ```

   - The `import "../styles/global.css";` line stays first — moving it breaks Uniwind hot reload.
   - `GestureHandlerRootView` must be the outermost wrapper, per the HeroUI docs.
   - For advanced provider options (text props, animation settings, toast config), see the HeroUI Native Provider docs linked at the bottom of this file.

7. Rebuild the native projects. The new peer deps include native modules (`react-native-reanimated`, `react-native-gesture-handler`, `react-native-worklets`, `react-native-svg`) that require a fresh prebuild:

   ```sh
   bun run prebuild
   ```

   Then run on device to rebuild and reinstall:

   ```sh
   bun ios
   # or
   bun android
   ```

8. Smoke test. Edit `src/app/index.tsx` to render the HeroUI `Button`:

   ```tsx
   import { Button } from "heroui-native";
   import { View } from "react-native";

   export default function Index() {
     return (
       <View className="flex-1 justify-center items-center bg-background">
         <Button onPress={() => console.log("Pressed!")}>Get Started</Button>
       </View>
     );
   }
   ```

   On device, verify:
   - The button renders centered with HeroUI styling.
   - `bg-background` resolves to a HeroUI theme color (light or dark).
   - Tapping logs `Pressed!` to the Metro console.
   - Hot reload still works after editing the file (no full reload).

9. **(Tip) Granular imports for smaller bundles.** Per the HeroUI docs, you can import individual components from their own subpaths to keep the bundle small:

   ```tsx
   // Granular — use when you need only a few components
   import { HeroUINativeProvider } from "heroui-native/provider";
   import { Button } from "heroui-native/button";
   import { Card } from "heroui-native/card";

   // General — imports the whole library; use when you're using many components
   import { Button, Card } from "heroui-native";
   ```

   Available granular exports:
   - `heroui-native/provider` — Provider component
   - `heroui-native/provider-raw` — Lightweight provider (no `ToastProvider` / `PortalHost`)
   - `heroui-native/[component-name]` — Individual components
   - `heroui-native/portal` — Portal utilities
   - `heroui-native/toast` — Toast provider and utilities
   - `heroui-native/utils` — Utility functions
   - `heroui-native/hooks` — Custom hooks

   **Important:** Mixing general and granular imports defeats the optimization. Pick one strategy and stick with it across the app. For a brand-new app, general imports are simpler; switch to granular before shipping if bundle size matters.

## Reference

- HeroUI Native Quick Start: <https://www.heroui.com/docs/native/getting-started/quick-start>
- HeroUI Native Provider: <https://www.heroui.com/docs/native/getting-started/provider>
- HeroUI Native Styling: <https://www.heroui.com/docs/native/getting-started/styling>
- HeroUI Native Theming: <https://www.heroui.com/docs/native/getting-started/theming>
- Uniwind Quickstart (prereq): <https://docs.uniwind.dev/quickstart>
