# iOS simulator work on a macOS devbox

Everything here runs ON the box (through `devbox.sh sh` for quick commands, `devbox.sh run` for anything over a minute or two). `D` is a simulator UDID.

## 1. Find and boot a simulator

```bash
xcrun simctl list devices available            # name, UDID, state, grouped by iOS runtime
xcrun simctl list runtimes                     # installed iOS versions
D=$(xcrun simctl list devices available | grep 'iPhone 17 Pro (' | head -1 | grep -Eo '[0-9A-F-]{36}')
xcrun simctl boot $D; xcrun simctl bootstatus $D -b
```

- The same device name can exist under several runtimes (e.g. an iPad on iOS 18 and iOS 26). Pick by UDID, not name.
- Tools that find a simulator by NAME (screenshot pipelines, test configs) need a unique name: `xcrun simctl rename $D "<name>"`, and rename the clash to something else.
- If a UI automation tool (argent, Maestro, XCUITest drivers) reads the accessibility tree, boot through that tool. A simulator booted by plain `simctl` can return an empty accessibility tree to it.

## 2. Get an app onto it

Pick one:

| Need | Do |
| --- | --- |
| Store screenshots, release behaviour, a build that talks to a backend on the box | Local Release build: `mac-setup.sh ios` (bakes `EXPO_PUBLIC_API_URL=http://localhost:<port>`) |
| Quick functional testing of JS changes | Download a prebuilt simulator dev client from EAS, then run Metro on the box |
| A `.app` built elsewhere | `devbox.sh push <box> ./App.app '~/App.app'` then install it |

```bash
xcrun simctl install $D path/to/App.app
xcrun simctl launch $D <bundle-id>
xcrun simctl terminate $D <bundle-id>
```

EAS dev client: download the latest simulator build's `.tar.gz` (`bunx eas-cli build:list --platform ios --json --limit 1` gives `artifacts.buildUrl`), extract it, install it, then `bunx expo start --dev-client --port 8081` in tmux so the client loads JS from Metro. It needs `EXPO_TOKEN` in the box's environment: ask the user for it and pass it inline; never write it into the repo.

### Local Xcode build rules (each cost a failed run)

- **Sign ad hoc**: `CODE_SIGN_IDENTITY=- CODE_SIGNING_REQUIRED=NO CODE_SIGNING_ALLOWED=YES`. With `CODE_SIGNING_ALLOWED=NO` the simulated entitlements are missing and Keychain access is refused at launch (expo-secure-store fails, expo-updates' error recovery then aborts the app). Re-signing the finished `.app` ad hoc does not fix it: the simulator refuses to launch it.
- **Build-time env is baked in**: `EXPO_PUBLIC_*` values are read at bundle time. Write them to the app's `.env` and export them before `expo prebuild` and `xcodebuild`.
- **SDKs that throw without config** (analytics, crash reporting): give them a dummy key and a dead local host (`http://127.0.0.1:9`) rather than the real project.
- A cold Release build takes 10+ minutes and a warm one about 5. Always run it in tmux.
- `xcodebuild` output is huge. Log it to a file and grep `error:` on failure.

## 3. Drive it

```bash
xcrun simctl openurl $D 'myapp://path'                         # deep link
xcrun simctl privacy $D grant photos <bundle-id>               # or reset microphone, etc.
xcrun simctl push $D <bundle-id> payload.apns                  # push notification
xcrun simctl location $D set 37.33,-122.03
xcrun simctl status_bar $D override --time 9:41 --batteryState charged --batteryLevel 100
```

Taps, typing and accessibility trees need an automation tool installed on the box (argent, Maestro, idb). Notes from argent:

- Find its CLI after first use through `npx`: `A=$(ls -d ~/.npm/_npx/*/node_modules/.bin/argent | head -1)`.
- `$A run boot-device --udid $D --force true` boots with the accessibility settings it needs.
- `$A run describe --udid $D` returns the accessibility tree with normalized coordinates; it also sees SpringBoard permission prompts, while flow runners may not, so flows tap those prompts by coordinate.

When no automation tool is available, the whole Mac desktop can be driven: `devbox desktop screenshot <box> --file s.png`, `devbox desktop click <box> --x 100 --y 200`, `devbox desktop type <box> ...`, `devbox desktop press <box> ...`. These run from the agent's machine, not the box.

## 4. See it

- Screenshot for a human or for checking a screen: `devbox.sh screenshot <box> $D ./shot.png` (simctl screenshot, shrunk to 900px with `sips`, copied back).
- Video: `xcrun simctl io $D recordVideo /tmp/v.mov` in tmux, stop it with `tmux send-keys -t <job> C-c`, then `devbox.sh pull`.
- Look at the screen before "fixing" an automation step that failed: a stale login session in the Keychain, a permission prompt or a crash all look like a broken flow.

## 5. Debug a crash

```bash
ls -t ~/Library/Logs/DiagnosticReports/ | head                 # newest crash reports
xcrun simctl spawn $D log show --last 1m --predicate 'process == "<AppProcess>"'   # JS errors, native logs
xcrun simctl spawn $D log stream --predicate 'process == "<AppProcess>"'          # live, in tmux
xcrun simctl get_app_container $D <bundle-id> data             # app sandbox on disk
```

`xcrun simctl erase $D` resets a simulator completely (shut it down first).
