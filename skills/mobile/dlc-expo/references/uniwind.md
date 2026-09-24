# Uniwind (Tailwind) Setup (detailed procedure)

Optional add-on for the `dlc-expo` skill. Follow these steps only when the user asks for Tailwind / Uniwind styling. Assumes the base scaffold in [scaffold.md](./scaffold.md) has already been completed (Expo Router is wired, `src/app/_layout.tsx` exists, Metro is the bundler). Do not skip steps and do not paraphrase commands or code snippets, copy them as written.

Source: https://docs.uniwind.dev/quickstart

> Uniwind only supports **Tailwind 4**.

## Steps

1. Ensure `metro.config.js` exists at the project root before starting the Uniwind install. If it is missing, generate it with Bun:

   ```sh
   bunx expo customize metro.config.js
   ```

   If it already exists, leave it in place — you will edit it in step 5. Do not overwrite an existing `metro.config.js` via `bunx expo customize`; the CLI will prompt for confirmation in that case.

2. Install Uniwind and Tailwind:

   ```sh
   bun add uniwind tailwindcss
   ```

3. Create the CSS entry file at `src/styles/global.css`:

   ```css
   @import 'tailwindcss';
   @import 'uniwind';

   @source '../**/*.{ts,tsx}';
   ```

   - Tailwind scans for classNames starting from the directory that contains `global.css`. Because we keep the file in `src/styles/` (not the project root), the `@source '../**/*.{ts,tsx}'` directive is required so classNames in `src/app/` and other sibling folders under `src/` are still detected.
   - Do not move `global.css` to the project root; keep it under `src/styles/`.

4. Import `global.css` from `src/app/_layout.tsx` (not the root `index.ts`). Importing from the registered root entry breaks hot reload and forces full reloads on every change — per the Uniwind docs' `Danger` callout.

   Overwrite `src/app/_layout.tsx` with:

   ```tsx
   import "../styles/global.css";
   import { Stack } from "expo-router";

   export default function RootLayout() {
     return <Stack />;
   }
   ```

5. Edit `metro.config.js` (the one generated or already present from step 1) to wrap the default config with `withUniwindConfig`. Replace its contents with:

   ```js
   const { getDefaultConfig } = require('expo/metro-config');
   const { withUniwindConfig } = require('uniwind/metro');

   const config = getDefaultConfig(__dirname);

   module.exports = withUniwindConfig(config, {
     // relative path to your global.css file (from step 3)
     cssEntryFile: './src/styles/global.css',
     // path where Uniwind auto-generates typings
     dtsFile: './src/uniwind-types.d.ts',
   });
   ```

   If the existing `metro.config.js` already contains custom Metro modifications or other config wrappers, preserve them inside the `withUniwindConfig` call rather than replacing them. Rules (from the Uniwind docs):
   - `cssEntryFile` **must be a relative path string** from the project root. Do not use absolute paths or `path.resolve(...)`.
   - `withUniwindConfig` **must be the outermost wrapper** in your Metro config. If you chain other config wrappers, they go inside `withUniwindConfig`, not around it.
   - `src/uniwind-types.d.ts` lives inside `src/` so the default `tsconfig.json` `include` picks it up automatically. If you move the dts file elsewhere, add it to `tsconfig.json` `include` manually.

6. Start Metro once so Uniwind's transformer emits typings and clears any TypeScript errors related to className props:

   ```sh
   bun start
   ```

   Leave it running long enough for `src/uniwind-types.d.ts` to be generated, then stop it. Commit the generated file.

7. Smoke test. If app has just been scaffolded edit `src/app/index.tsx` to use a Uniwind className and confirm styles apply on device:

   ```tsx
   import { Text, View } from "react-native";

   export default function Index() {
     return (
       <View className="flex-1 items-center justify-center">
         <Text className="text-red-500">Uniwind is working.</Text>
       </View>
     );
   }
   ```

   Run `bun ios` or `bun android` and verify the text renders red and centered. Save the file again and confirm hot reload still works (no full reload) — this validates that importing `global.css` from `src/app/_layout.tsx` rather than `index.ts` avoided the hot-reload break.

8. (Optional) Editor IntelliSense for Tailwind classes on React Native props. Pick the block that matches your editor.

   **VSCode / Cursor / Windsurf** — add to `.vscode/settings.json`:

   ```json
   {
     "tailwindCSS.classAttributes": [
       "class",
       "className",
       "headerClassName",
       "contentContainerClassName",
       "columnWrapperClassName",
       "endFillColorClassName",
       "imageClassName",
       "tintColorClassName",
       "ios_backgroundColorClassName",
       "thumbColorClassName",
       "trackColorOnClassName",
       "trackColorOffClassName",
       "selectionColorClassName",
       "cursorColorClassName",
       "underlineColorAndroidClassName",
       "placeholderTextColorClassName",
       "selectionHandleColorClassName",
       "colorsClassName",
       "progressBackgroundColorClassName",
       "titleColorClassName",
       "underlayColorClassName",
       "colorClassName",
       "drawerBackgroundColorClassName",
       "statusBarBackgroundColorClassName",
       "backdropColorClassName",
       "backgroundColorClassName",
       "ListFooterComponentClassName",
       "ListHeaderComponentClassName"
     ],
     "tailwindCSS.classFunctions": ["useResolveClassNames"]
   }
   ```

   **Zed** — add to `.zed/settings.json` (or user-level `settings.json`):

   ```json
   {
     "lsp": {
       "tailwindcss-language-server": {
         "settings": {
           "classAttributes": [
             "class",
             "className",
             "headerClassName",
             "contentContainerClassName",
             "columnWrapperClassName",
             "endFillColorClassName",
             "imageClassName",
             "tintColorClassName",
             "ios_backgroundColorClassName",
             "thumbColorClassName",
             "trackColorOnClassName",
             "trackColorOffClassName",
             "selectionColorClassName",
             "cursorColorClassName",
             "underlineColorAndroidClassName",
             "placeholderTextColorClassName",
             "selectionHandleColorClassName",
             "colorsClassName",
             "progressBackgroundColorClassName",
             "titleColorClassName",
             "underlayColorClassName",
             "colorClassName",
             "drawerBackgroundColorClassName",
             "statusBarBackgroundColorClassName",
             "backdropColorClassName",
             "backgroundColorClassName",
             "ListFooterComponentClassName",
             "ListHeaderComponentClassName"
           ],
           "classFunctions": ["useResolveClassNames"]
         }
       }
     }
   }
   ```

9. **(Optional) Component library.** Now that Uniwind is wired up, install a component library. If the user already chose one (scaffold step 1), use it; otherwise ask per the "Component Library Choice" section of [../SKILL.md](../SKILL.md):
   - **Delacour UI** → follow [./delacour-ui.md](./delacour-ui.md).
   - **HeroUI Native** → follow [./heroui-native.md](./heroui-native.md).
   - **None** → you are done.

## Reference

- Uniwind Quickstart: https://docs.uniwind.dev/quickstart
- Uniwind docs index: https://docs.uniwind.dev/llms.txt
- Monorepos & `@source`: https://docs.uniwind.dev/monorepos
- Component library (optional next step): [./delacour-ui.md](./delacour-ui.md) or [./heroui-native.md](./heroui-native.md)
