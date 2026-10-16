#!/usr/bin/env bash
# mac-setup.sh - idempotent setup that runs ON a Namespace macOS devbox.
#
# Copy into the project (e.g. scripts/devbox/mac.sh), edit the CONFIG block,
# commit it, and run it from the repo checkout on the box inside tmux:
#
#   devbox.sh run <box> setup 'cd ~/workspaces/<repo> && bash scripts/devbox/mac.sh all'
#   devbox.sh wait <box> setup
#
# Steps (each safe to re-run; `all` runs them in order):
#   tools     Homebrew packages, pinned bun, tmux, dependency install
#   postgres  private trust-auth Postgres cluster + database, optional migrate/seed
#   redis     redis as a brew service
#   backend   long-running API in tmux session "backend", waits for its health URL
#   ios       Release simulator build of an Expo / Xcode app (signed ad hoc)
#   sims      list available iOS simulators
#
# Progress lines start with "== " so `devbox.sh wait` can follow them. Noisy
# commands log to ~/devbox-logs/<name>.log and print their tail only on failure.
set -eo pipefail

export PATH=/opt/homebrew/opt/postgresql@14/bin:/opt/homebrew/bin:/opt/homebrew/sbin:$PATH
export LANG=en_US.UTF-8

# ---- CONFIG: edit per project ---------------------------------------------
REPO=$(cd "$(dirname "$0")/../.." && pwd) # repo root, relative to this file
BUN_VERSION=${BUN_VERSION:-}              # e.g. 1.2.0; empty = whatever is installed
BREW_PACKAGES=${BREW_PACKAGES:-"tmux"}    # e.g. "tmux ffmpeg"
INSTALL_CMD=${INSTALL_CMD:-"bun install"} # empty to skip

PG_PORT=${PG_PORT:-54322}
PG_DATA=${PG_DATA:-$HOME/pgdata}
DB_NAME=${DB_NAME:-app_dev}
export DATABASE_URL=${DATABASE_URL:-postgresql://postgres@127.0.0.1:$PG_PORT/$DB_NAME}
MIGRATE_CMD=${MIGRATE_CMD:-}             # e.g. "bun run db:migrate"
SEED_CMD=${SEED_CMD:-}                   # e.g. "bun run db:seed"; runs once (marker file)

API_PORT=${API_PORT:-3010}
BACKEND_CMD=${BACKEND_CMD:-}             # e.g. "bun apps/api/src/server.ts"
BACKEND_ENV=${BACKEND_ENV:-}             # extra "KEY=value KEY2=value" for the backend
HEALTH_PATH=${HEALTH_PATH:-/health}

APP_DIR=${APP_DIR:-$REPO/apps/mobile}    # Expo app directory (or the dir holding ios/)
EXPO_PREBUILD=${EXPO_PREBUILD:-1}        # 0 for a plain Xcode project
IOS_WORKSPACE=${IOS_WORKSPACE:-}         # e.g. App.xcworkspace; empty = first *.xcworkspace
IOS_SCHEME=${IOS_SCHEME:-}               # empty = workspace name
IOS_CONFIGURATION=${IOS_CONFIGURATION:-Release}
DERIVED=${DERIVED:-$HOME/Library/Developer/Xcode/DerivedData/devbox}
# Baked into the JS bundle at build time; the simulator reaches the box's localhost.
IOS_BUILD_ENV=${IOS_BUILD_ENV:-"EXPO_PUBLIC_API_URL=http://localhost:$API_PORT"}
# ---------------------------------------------------------------------------

step() { echo "== $(date +%H:%M:%S) $*"; }

LOGS=$HOME/devbox-logs
mkdir -p "$LOGS"
quiet() {
	local name=$1
	shift
	"$@" >"$LOGS/$name.log" 2>&1 || {
		echo "!! $name failed, tail of $LOGS/$name.log:" >&2
		tail -30 "$LOGS/$name.log" >&2
		return 1
	}
}

tools() {
	step tools
	if [ -n "$BUN_VERSION" ]; then
		command -v bun >/dev/null && [ "$(bun --version)" = "$BUN_VERSION" ] ||
			quiet bun-install-cli npm i -g "bun@$BUN_VERSION"
	else
		command -v bun >/dev/null || quiet bun-install-cli bash -c 'curl -fsSL https://bun.sh/install | bash'
	fi
	for pkg in $BREW_PACKAGES; do
		brew list "$pkg" >/dev/null 2>&1 || quiet "brew-$pkg" brew install -q "$pkg"
	done
	[ -z "$INSTALL_CMD" ] || (cd "$REPO" && quiet deps $INSTALL_CMD)
}

postgres() {
	step postgres
	command -v initdb >/dev/null || quiet brew-postgresql brew install -q postgresql@14
	# The image's Homebrew cluster belongs to the image-build user and has no
	# role for the login user, so run a private trust-auth cluster instead.
	[ -d "$PG_DATA" ] || quiet initdb initdb -U postgres -A trust -D "$PG_DATA"
	pg_isready -q -h 127.0.0.1 -p "$PG_PORT" ||
		pg_ctl -D "$PG_DATA" -o "-p $PG_PORT" -l "$HOME/pgdata.log" start >/dev/null
	for _ in $(seq 1 15); do pg_isready -q -h 127.0.0.1 -p "$PG_PORT" && break; sleep 1; done
	createdb -U postgres -h 127.0.0.1 -p "$PG_PORT" "$DB_NAME" 2>/dev/null || true
	[ -z "$MIGRATE_CMD" ] || (cd "$REPO" && quiet migrate $MIGRATE_CMD)
	if [ -n "$SEED_CMD" ] && [ ! -f "$PG_DATA/.seeded-$DB_NAME" ]; then
		(cd "$REPO" && quiet seed $SEED_CMD) && touch "$PG_DATA/.seeded-$DB_NAME"
	fi
	echo "postgres: $DATABASE_URL"
}

redis() {
	step redis
	brew list redis >/dev/null 2>&1 || quiet brew-redis brew install -q redis
	quiet redis-service brew services start redis
}

backend() {
	step backend
	[ -n "$BACKEND_CMD" ] || { echo "set BACKEND_CMD in the CONFIG block" >&2; return 1; }
	cat >"$HOME/backend.sh" <<EOF
cd "$REPO"
export PATH=/opt/homebrew/bin:\$PATH PORT=$API_PORT DATABASE_URL=$DATABASE_URL $BACKEND_ENV
exec $BACKEND_CMD
EOF
	tmux kill-session -t backend 2>/dev/null || true
	tmux new-session -d -s backend "bash $HOME/backend.sh > $HOME/backend.log 2>&1"
	local url="http://localhost:$API_PORT$HEALTH_PATH"
	for _ in $(seq 1 30); do curl -sf -o /dev/null "$url" && break; sleep 2; done
	curl -s -o /dev/null -w "backend $url -> %{http_code}\n" "$url"
}

ios() {
	step ios
	cd "$APP_DIR"
	# shellcheck disable=SC2086
	export $IOS_BUILD_ENV CI=1
	if [ "$EXPO_PREBUILD" = 1 ]; then
		# Write the build-time env to .env too, since Expo reads it during bundling.
		printf '%s\n' $IOS_BUILD_ENV >.env
		quiet prebuild npx expo prebuild -p ios --clean --no-install
		(cd ios && quiet pods pod install)
	fi
	local ws=${IOS_WORKSPACE:-$(cd ios && ls -d ./*.xcworkspace | head -1 | xargs basename)}
	local scheme=${IOS_SCHEME:-${ws%.xcworkspace}}
	# Sign ad hoc. CODE_SIGNING_ALLOWED=NO drops the simulated entitlements, so
	# Keychain access (e.g. expo-secure-store) fails at launch; re-signing the
	# finished .app afterwards makes the simulator refuse to launch it.
	(cd ios && quiet xcodebuild xcodebuild -workspace "$ws" -scheme "$scheme" \
		-configuration "$IOS_CONFIGURATION" -sdk iphonesimulator \
		-destination "generic/platform=iOS Simulator" -derivedDataPath "$DERIVED" build \
		CODE_SIGN_IDENTITY=- CODE_SIGNING_REQUIRED=NO CODE_SIGNING_ALLOWED=YES) || {
		grep -E "error:" "$LOGS/xcodebuild.log" | head -20 >&2
		return 1
	}
	echo "app: $(ls -d "$DERIVED/Build/Products/$IOS_CONFIGURATION-iphonesimulator/"*.app | head -1)"
}

sims() {
	step sims
	xcrun simctl list devices available | grep -E 'iPhone|iPad|-- iOS'
}

[ $# -gt 0 ] || { sed -n '2,20p' "$0"; exit 1; }
for s in "$@"; do
	case $s in
	all) tools; postgres; redis; [ -z "$BACKEND_CMD" ] || backend; [ ! -d "$APP_DIR" ] || ios; sims ;;
	tools | postgres | redis | backend | ios | sims) "$s" ;;
	*) echo "unknown step: $s" >&2; exit 1 ;;
	esac
done
step done
