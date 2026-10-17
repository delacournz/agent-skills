#!/usr/bin/env bash
# devbox.sh - drive a Namespace devbox from the agent's machine (Linux or macOS).
#
# Usage: devbox.sh <command> [args]
#
#   install                         Install the devbox CLI (and check for an ssh client)
#   auth [--wait [secs]]            Check login; start a device login if needed (exit 3 = waiting on user)
#   list                            List your devboxes as JSON
#   up <name> [create flags...]     Reuse <name> or create it, configure ssh, wait until reachable
#   sh <name> <command>             Run a SHORT command on the box (Homebrew on PATH)
#   run <name> <job> <command>      Start a LONG command in tmux session <job>, logged on the box
#   wait <name> <job> [secs]        Follow <job>'s progress lines until it exits; returns its exit code
#   tail <name> <job> [lines]       Print the end of <job>'s log
#   push <name> <local> <remote>    Copy a file or directory to the box
#   pull <name> <remote> <local>    Copy a file or directory from the box
#   screenshot <name> <udid|booted> <local.png>   Screenshot an iOS simulator, shrunk, copied back
#   down <name>                     Stop the box (disk is kept)
#
# Env:
#   DEVBOX_PLATFORM (macos/arm64)  DEVBOX_IMAGE (tahoe-slim)  DEVBOX_SIZE (l)
#   DEVBOX_SITE (unset = closest)  DEVBOX_IDLE (1h, auto-stop after idle)
#   DEVBOX_CHECKOUT (repo to check out, e.g. github.com/org/repo; unset = no checkout)
#   DEVBOX_PURPOSE  DEVBOX_LOGIN_LOG (/tmp/devbox-login.log)
set -euo pipefail

export PATH="$HOME/.local/bin:$PATH"

# Prepended to every remote command: a non-login ssh shell has no Homebrew on PATH.
REMOTE_ENV='export PATH=/opt/homebrew/bin:/opt/homebrew/sbin:/usr/local/bin:$PATH LANG=en_US.UTF-8;'
LOGIN_LOG=${DEVBOX_LOGIN_LOG:-/tmp/devbox-login.log}

die() { echo "devbox.sh: $*" >&2; exit 1; }
usage() { sed -n '2,25p' "$0" | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }
need() { [ -n "${2:-}" ] || die "$1 is required (see: devbox.sh help)"; }
host() { echo "$1.devbox.namespace"; }
valid_job() { [[ $1 =~ ^[A-Za-z0-9_-]+$ ]] || die "job name must match [A-Za-z0-9_-]+: $1"; }

# ssh with keepalives so a quiet command is not dropped; BatchMode so it never prompts.
rssh() {
	local name=$1
	shift
	ssh -o BatchMode=yes -o ServerAliveInterval=30 -o ConnectTimeout=20 "$(host "$name")" "$@"
}

# `devbox auth check` exits 0 either way, so read what it says.
logged_in() {
	local out
	out=$(devbox auth check 2>&1) || return 1
	[[ $out == *"Logged in"* && $out != *"Not logged in"* ]]
}

exists() { devbox list -o json 2>/dev/null | grep -q "\"name\": *\"$1\""; }

cmd_install() {
	if command -v devbox >/dev/null; then
		echo "devbox CLI: $(devbox version 2>/dev/null | head -1)"
	else
		curl -fsSL https://get.namespace.so/devbox/install.sh | bash
	fi
	command -v ssh >/dev/null || {
		echo "no ssh client. Install one, e.g.: apt-get install -y openssh-client" >&2
		exit 1
	}
	command -v rsync >/dev/null || echo "note: rsync not found, push/pull will use scp"
}

cmd_auth() {
	if logged_in; then
		echo "Logged in"
		return 0
	fi
	if ! pgrep -f 'devbox login' >/dev/null; then
		devbox login --browser=false >"$LOGIN_LOG" 2>&1 &
		sleep 3
	fi
	echo "Not logged in. Give the user this URL and code to approve (only if the page shows the same code):"
	cat "$LOGIN_LOG"
	if [ "${1:-}" = "--wait" ]; then
		local deadline=$((SECONDS + ${2:-600}))
		while [ $SECONDS -lt $deadline ]; do
			logged_in && { echo "Logged in"; return 0; }
			sleep 5
		done
		die "login not approved in time; run 'devbox.sh auth' again"
	fi
	exit 3
}

cmd_up() {
	local name=$1
	shift
	need name "$name"
	logged_in || die "not logged in; run 'devbox.sh auth' first"
	if exists "$name"; then
		echo "reusing devbox $name"
	else
		local args=(--name "$name"
			--platform "${DEVBOX_PLATFORM:-macos/arm64}"
			--image "${DEVBOX_IMAGE:-tahoe-slim}"
			--size "${DEVBOX_SIZE:-l}"
			--auto_stop_idle_timeout "${DEVBOX_IDLE:-1h}"
			--purpose "${DEVBOX_PURPOSE:-agent work}")
		if [ -n "${DEVBOX_SITE:-}" ]; then
			args+=(--site "$DEVBOX_SITE" --closest=false)
		else
			args+=(--closest=true)
		fi
		if [ -n "${DEVBOX_CHECKOUT:-}" ]; then
			args+=(--checkout "$DEVBOX_CHECKOUT")
		else
			args+=(--no_checkout)
		fi
		echo "creating devbox $name: devbox create ${args[*]} $*"
		devbox create "${args[@]}" "$@"
	fi
	devbox configure-ssh "$name" >/dev/null 2>&1 || devbox configure-ssh >/dev/null
	# The first ssh also resumes a stopped box, which can take a minute or two.
	local deadline=$((SECONDS + 600))
	until rssh "$name" true 2>/dev/null; do
		[ $SECONDS -lt $deadline ] || die "$(host "$name") not reachable after 10 minutes; try 'devbox ssh $name'"
		sleep 10
	done
	rssh "$name" "$REMOTE_ENV echo ready: \$(hostname) \$(sw_vers -productVersion 2>/dev/null); uptime"
}

cmd_sh() {
	local name=$1
	shift
	need name "$name"
	need command "${1:-}"
	rssh "$name" "$REMOTE_ENV $*"
}

cmd_run() {
	local name=$1 job=${2:-}
	shift 2 || true
	need name "$name"
	need job "$job"
	need command "${1:-}"
	valid_job "$job"
	# Ship the command as a script on stdin so no quoting survives two shells.
	{
		echo "$REMOTE_ENV"
		echo "set -o pipefail"
		echo "$*"
	} | rssh "$name" "mkdir -p ~/devbox-logs && cat > ~/devbox-logs/$job.sh"
	rssh "$name" "$REMOTE_ENV
		command -v tmux >/dev/null || brew install -q tmux >/dev/null
		tmux kill-session -t $job 2>/dev/null || true
		: > ~/devbox-logs/$job.log
		tmux new-session -d -s $job \"bash ~/devbox-logs/$job.sh >> ~/devbox-logs/$job.log 2>&1; echo == EXIT \\\$? >> ~/devbox-logs/$job.log\"
		echo started $job, log: ~/devbox-logs/$job.log"
}

cmd_wait() {
	local name=$1 job=${2:-} timeout=${3:-3600}
	need name "$name"
	need job "$job"
	valid_job "$job"
	local deadline=$((SECONDS + timeout)) seen=0 lines code
	while [ $SECONDS -lt $deadline ]; do
		# Progress lines start with "== "; the job's last line is "== EXIT <code>".
		if lines=$(rssh "$name" "grep '^== ' ~/devbox-logs/$job.log 2>/dev/null" 2>/dev/null); then
			local total
			total=$(printf '%s\n' "$lines" | grep -c . || true)
			[ "$total" -gt "$seen" ] && printf '%s\n' "$lines" | tail -n +$((seen + 1)) && seen=$total
			if code=$(printf '%s\n' "$lines" | sed -n 's/^== EXIT \([0-9]*\)$/\1/p' | tail -1) && [ -n "$code" ]; then
				[ "$code" = 0 ] || rssh "$name" "tail -30 ~/devbox-logs/$job.log" >&2 || true
				return "$code"
			fi
		elif ! rssh "$name" true 2>/dev/null; then
			echo "box unreachable, retrying (it may have restarted: check 'uptime' and re-run the job)" >&2
		fi
		sleep 15
	done
	die "$job still running after ${timeout}s; check with: devbox.sh tail $name $job"
}

cmd_tail() {
	local name=$1 job=${2:-} n=${3:-40}
	need name "$name"
	need job "$job"
	valid_job "$job"
	rssh "$name" "tail -n $n ~/devbox-logs/$job.log"
}

copy() {
	if command -v rsync >/dev/null; then
		rsync -az -e "ssh -o BatchMode=yes" "$1" "$2"
	else
		scp -o BatchMode=yes -rq "$1" "$2"
	fi
}

cmd_push() { need name "$1"; need local "${2:-}"; need remote "${3:-}"; copy "$2" "$(host "$1"):$3"; }
cmd_pull() { need name "$1"; need remote "${2:-}"; need local "${3:-}"; copy "$(host "$1"):$2" "$3"; }

cmd_screenshot() {
	local name=$1 udid=${2:-booted} out=${3:-}
	need name "$name"
	need local.png "$out"
	rssh "$name" "$REMOTE_ENV xcrun simctl io $udid screenshot /tmp/devbox-shot.png >/dev/null && sips -Z 900 /tmp/devbox-shot.png >/dev/null"
	cmd_pull "$name" /tmp/devbox-shot.png "$out"
	echo "$out"
}

cmd_down() {
	need name "${1:-}"
	devbox shutdown "$1" --force
}

[ $# -gt 0 ] || usage 1
cmd=$1
shift
case $cmd in
install | auth | up | sh | run | wait | tail | push | pull | screenshot | down) "cmd_$cmd" "$@" ;;
list) devbox list -o json ;;
help | -h | --help) usage ;;
*) echo "unknown command: $cmd" >&2; usage 1 ;;
esac
