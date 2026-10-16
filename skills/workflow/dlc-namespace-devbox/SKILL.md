---
name: dlc-namespace-devbox
description: Boot, connect to and run code on a Namespace devbox, most often a remote Apple Silicon Mac with Xcode and iOS simulators, over SSH. Covers CLI install and device login, reusing or creating a box, running long jobs safely in tmux, copying files, bootstrapping a project on the box (Postgres, Redis, backend, Release simulator build), driving iOS simulators and shutting the box down. Bundles scripts/devbox.sh (runs on the agent's machine) and assets/mac-setup.sh (a per-project setup template that runs on the box). Use when the work needs a Mac and the session is on Linux (iOS simulator, Xcode build, App Store screenshots, iOS QA), or when asked to "use a devbox", "use Namespace", "spin up a Mac", "boot a devbox", "run it on the Mac" or "ssh into the devbox".
license: UNLICENSED
allowed-tools: Read, Bash(*), Glob, Grep
metadata:
  author: chris@delacour.co.nz
  version: "0.1.0"
  category: workflow
  tags: [namespace, devbox, macos, ios, simulator, xcode, ssh, remote, tmux]
  argument-hint: "[box-name] [task]"
---

# Namespace Devbox

A Linux agent session cannot run Xcode or an iOS simulator. A [Namespace](https://namespace.so) devbox is a remote machine (macOS on Apple Silicon or Linux) with a persistent home directory, reachable over SSH. This skill boots or resumes one, runs work on it without losing processes to dropped SSH sessions, and shuts it down when done so it stops billing.

Two bundled files do the mechanical work:

| File | Runs on | Does |
| --- | --- | --- |
| `scripts/devbox.sh` | the agent's machine | install, login, create or reuse, ssh, tmux jobs, file copy, simulator screenshots, shutdown |
| `assets/mac-setup.sh` | the box | idempotent project setup template: tools, Postgres, Redis, backend, iOS Release build, simulator list |

Below, `DX` means the absolute path to this skill's `scripts/devbox.sh`.

## When to Use

- The task needs macOS: an iOS simulator, `xcodebuild`, Swift tooling, App Store screenshots or previews, iOS QA of a React Native / Expo app
- The user says "use a devbox", "use Namespace", "spin up a Mac", "run it on the Mac", "ssh into the devbox"
- A heavy Linux job should run on a bigger remote machine (`DEVBOX_PLATFORM=linux/amd64`)

## Rules / Steps

### 1. Install the CLI and log in (once per session)

```bash
bash DX install          # devbox CLI into ~/.local/bin, checks for an ssh client
bash DX auth             # exit 0 = logged in; exit 3 = login started, waiting on the user
```

On exit 3 the script prints a URL and a verification code. **Hand both to the user** and tell them to approve only if the page shows that exact code. Then `bash DX auth --wait 600` until it prints `Logged in`. The credential lasts about a month. Never approve the login yourself, and never ask for the user's Namespace password.

- `devbox auth check` exits 0 even when logged out. Read its output (the script does).
- A bare container may lack SSH: `apt-get install -y openssh-client`.

### 2. Pick or create a box

```bash
bash DX list             # JSON: name, site, image, state, last used
```

**Reuse before creating.** A box's home directory survives stop and start, so a box that already holds the repo, dependencies and a build resumes in seconds. Pick one by name from the list, matching platform and purpose.

```bash
bash DX up <name>        # reuses <name> if it exists, else creates it; configures ssh; waits until reachable
```

New boxes take their settings from env (all optional):

| Env | Default | Notes |
| --- | --- | --- |
| `DEVBOX_PLATFORM` | `macos/arm64` | or `linux/amd64` |
| `DEVBOX_IMAGE` | `tahoe-slim` | `devbox image list --platform macos -o json` lists images with their Xcode and simulator runtimes |
| `DEVBOX_SIZE` | `l` | macOS: `m` or `l`. Linux: `s` to `xl` |
| `DEVBOX_SITE` | closest | airport codes such as `zrh`, `ord`. `devbox site-latency` compares them. Names like `switzerland` are rejected |
| `DEVBOX_IDLE` | `1h` | auto-stop after idle, a safety net against a forgotten box |
| `DEVBOX_CHECKOUT` | none | e.g. `github.com/org/repo`, checked out under `~/workspaces/<repo>` |
| `DEVBOX_PURPOSE` | `agent work` | shown in the dashboard |

Extra `devbox create` flags can follow the name: `bash DX up <name> --setup_github`.

Name boxes `<project>-<platform>-<site>` (e.g. `acme-mac-zrh`) so the list stays readable. Once `up` succeeds, `ssh <name>.devbox.namespace` works directly too.

### 3. Run commands: short over ssh, long in tmux

**An SSH command running more than a few minutes gets cut off and takes its process with it. `nohup` does not survive.** So:

```bash
bash DX sh <name> 'xcrun simctl list devices available | head'          # SHORT: seconds
bash DX run <name> build 'cd ~/workspaces/repo && bun run build'        # LONG: tmux session "build"
bash DX wait <name> build 3600       # prints "== " progress lines, returns the job's exit code
bash DX tail <name> build 80         # last lines of ~/devbox-logs/build.log
```

- `run` ships the command to the box as a script, so quoting is preserved, and appends `== EXIT <code>` to the log when it ends. Print your own `== <step>` lines from long scripts so `wait` shows progress.
- `wait` polls every 15 seconds. Run it in the background or with a long tool timeout; do not sit in a foreground sleep loop of your own.
- Both `sh` and `run` put Homebrew (`/opt/homebrew/bin`) on `PATH`. Any raw `ssh` command must do it itself: `export PATH=/opt/homebrew/bin:$PATH`.
- Servers (backend, Metro, log streams) also go in tmux. List sessions with `bash DX sh <name> 'tmux ls'`, stop one with `tmux kill-session -t <job>`.
- Sync the repo on the box to the branch under test before running anything: `bash DX sh <name> 'cd ~/workspaces/repo && git fetch -q origin <branch> && git checkout -q -B <branch> origin/<branch>'`. Push local commits first; the box clones from the remote, not from you.

### 4. Move files

```bash
bash DX push <name> ./local/path '~/remote/path'    # rsync if installed, else scp
bash DX pull <name> '~/remote/out/' ./out/
```

`devbox upload` / `devbox download <name> <remote> -` also work without SSH config. Never copy secrets into the repo on the box; pass tokens (e.g. `EXPO_TOKEN`) inline in the command after asking the user for them.

### 5. Bootstrap a project on the box

For a project that needs more than a checkout (database, backend, app build), give it a committed setup script so every run is the same:

1. Copy `assets/mac-setup.sh` to the project as `scripts/devbox/mac.sh`.
2. Edit its CONFIG block: bun version, brew packages, `MIGRATE_CMD`, `SEED_CMD`, `BACKEND_CMD`, `HEALTH_PATH`, `APP_DIR`, `IOS_BUILD_ENV`. Delete steps the project does not need.
3. Commit and push it, sync the box (step 3), then:

```bash
bash DX run <name> setup 'cd ~/workspaces/repo && bash scripts/devbox/mac.sh all'
bash DX wait <name> setup
```

Every step is idempotent: re-running `all` on a box that already has it takes seconds. Built-in lessons:

- **Postgres** runs as a private trust-auth cluster on its own port. The image's Homebrew cluster belongs to the image-build user and has no role for the box's login user.
- **Backend** runs in tmux session `backend`, logs to `~/backend.log`, and the step waits for its health URL.
- **iOS** builds are signed ad hoc and bake the backend URL in at build time. See [references/ios-simulator.md](./references/ios-simulator.md) for why.

### 6. iOS simulator work

Follow [references/ios-simulator.md](./references/ios-simulator.md) for booting, installing a build (local Release or EAS dev client), driving, screenshots, video and crash logs. Quick screenshot for the user:

```bash
bash DX screenshot <name> booted ./shot.png
```

### 7. Shut down

A running Mac bills by the minute. When the work is done, **ask the user**, then:

```bash
bash DX down <name>       # devbox shutdown --force; the disk is kept for next time
```

`devbox expire <name> --force` deletes the box and its disk. Only run it when the user asks for deletion.

### Edge Cases

- **`no available region to start a macos/arm64 instance`**: that site has no free Mac. Retrying, shutting down other boxes or waiting minutes does not help. Create a box at another site (`DEVBOX_SITE=ord bash DX up <project>-mac-ord`) and re-run the setup script there.
- **Box restarted under you** (`uptime` reset, tmux sessions gone, `wait` reports unreachable): the disk survives. Re-run the setup steps that start services (e.g. `mac.sh tools postgres redis backend`) and restart the job.
- **`ssh <name>.devbox.namespace` keeps failing** while the box shows as running: re-run `devbox configure-ssh`, or use `devbox ssh <name> -- '<cmd>'` / `devbox exec <name> -- <cmd>`, which do not depend on the SSH config.
- **`devbox create` prompts or fails non-interactively**: every one of `--name --platform --image --size` plus a site choice and a checkout choice must be set. `DX up` always sets them.
- **An automation step "fails"** (login, OTP screen): take a screenshot before changing anything. Persistent state on the box (a Keychain session from a previous run, a granted permission) often explains it.

## Examples

### Example: iOS QA of a branch from a Linux session

```bash
DX=~/.agents/skills/dlc-namespace-devbox/scripts/devbox.sh
bash $DX install && bash $DX auth || bash $DX auth --wait 600    # user approves the code
bash $DX list                                                    # acme-mac-zrh exists, reuse it
bash $DX up acme-mac-zrh
bash $DX sh acme-mac-zrh 'cd ~/workspaces/acme && git fetch -q origin fix/login && git checkout -q -B fix/login origin/fix/login'
bash $DX run acme-mac-zrh setup 'cd ~/workspaces/acme && bash scripts/devbox/mac.sh all'
bash $DX wait acme-mac-zrh setup
# == 10:02:11 tools
# == 10:02:40 postgres
# == 10:02:52 backend
# == 10:03:05 ios
# == 10:09:31 sims
# == 10:09:32 done
# == EXIT 0
bash $DX sh acme-mac-zrh 'xcrun simctl boot "iPhone 17 Pro"; xcrun simctl install booted ~/Library/Developer/Xcode/DerivedData/devbox/Build/Products/Release-iphonesimulator/Acme.app && xcrun simctl launch booted com.acme.app'
bash $DX screenshot acme-mac-zrh booted ./login.png
bash $DX down acme-mac-zrh                                       # after the user confirms
```
