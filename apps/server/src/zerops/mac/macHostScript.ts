/**
 * The shell scripts a Mac runs to pair with this Mate and to undo it. The user
 * runs `ssh zcp mac host | sh` on the Mac; the Mate renders the script with
 * this project's values, so the Mac needs nothing but the VPN and Node.js.
 *
 * Everything is the user's own: no admin rights, no Remote Login. The sshd
 * listens only on the Mac's address on this project's VPN; the agent-device
 * daemon runs as a LaunchAgent so macOS attributes its Accessibility and
 * Screen Recording permissions to it, not to whatever terminal ran the pairing.
 *
 * @module macHostScript
 */
import { shellQuote } from "./MacHost.ts";

export interface MacHostScriptInput {
  readonly projectId: string;
  /** How the Mac reaches this container over the VPN, for `ssh … mac register`. */
  readonly mateHost: string;
  /** This container's private address; the Mac routes to it through its VPN interface. */
  readonly mateAddress: string;
  readonly vpnRange: string;
  readonly port: number;
  readonly mateKey: string;
  readonly agentDeviceVersion: string;
}

const preamble = (projectId: string) => `#!/bin/sh
set -eu
PROJECT=${shellQuote(projectId)}
ROOT="$HOME/.zerops-mate/$PROJECT"
LABEL="io.zerops.mate.$PROJECT"
AGENTS="$HOME/Library/LaunchAgents"
DOMAIN="gui/$(id -u)"
say() { printf 'Zerops Mate: %s\\n' "$*" >&2; }
fail() { say "$*"; exit 1; }
[ "$(uname -s)" = Darwin ] || fail "run this on the Mac, not here."
`;

export const renderMacHostScript = (
  input: MacHostScriptInput,
): string => `${preamble(input.projectId)}
MATE_HOST=${shellQuote(input.mateHost)}
MATE_ADDRESS=${shellQuote(input.mateAddress)}
VPN_RANGE=${shellQuote(input.vpnRange)}
PORT=${shellQuote(String(input.port))}
MATE_KEY=${shellQuote(input.mateKey)}
AGENT_DEVICE=${shellQuote(`agent-device@${input.agentDeviceVersion}`)}
WORKSPACE="$HOME/ZeropsMate/$PROJECT"
ME=$(id -un)

in_range() {
  echo "$1 $2" | awk '{ split($1, a, "."); split($2, r, "/"); split(r[1], b, ".");
    s = 2 ^ (32 - r[2]); x = ((a[1] * 256 + a[2]) * 256 + a[3]) * 256 + a[4];
    y = ((b[1] * 256 + b[2]) * 256 + b[3]) * 256 + b[4]; exit !(int(x / s) == int(y / s)) }'
}
json() { printf '"%s"' "$(printf '%s' "$1" | sed 's/\\\\/\\\\\\\\/g; s/"/\\\\"/g')"; }
xml() { printf '%s' "$1" | sed 's/&/\\&amp;/g; s/</\\&lt;/g; s/>/\\&gt;/g'; }

# The Mac's own address on this project's VPN: the one it reaches the Mate from.
IF=$(route -n get "$MATE_ADDRESS" 2>/dev/null | awk '/interface:/ { print $2 }')
ADDRESS=$([ -n "$IF" ] && ifconfig "$IF" | awk '/inet / { print $2; exit }' || true)
if [ -z "$ADDRESS" ] || ! in_range "$ADDRESS" "$VPN_RANGE"; then
  fail "this Mac is not on the project VPN. Connect it first: zcli vpn up $PROJECT"
fi
NODE=$(command -v node) || fail "Node.js is missing. Install it (brew install node, or nodejs.org), then run this again."
NPM=$(command -v npm) || fail "npm is missing. Install Node.js with npm, then run this again."

say "installing agent-device into $ROOT"
mkdir -p "$ROOT/bin" "$ROOT/sshd" "$ROOT/logs" "$ROOT/agent-device/state" "$WORKSPACE" "$AGENTS"
chmod 700 "$ROOT"
"$NPM" install --silent --no-audit --no-fund --prefix "$ROOT/agent-device" "$AGENT_DEVICE" >/dev/null
CLI="$ROOT/agent-device/node_modules/agent-device/bin/agent-device.mjs"
DAEMON="$ROOT/agent-device/node_modules/agent-device/dist/src/internal/daemon.js"
[ -f "$CLI" ] && [ -f "$DAEMON" ] || fail "agent-device did not install as expected."

# The Mate runs agent-device through this wrapper; it reaches the daemon below.
cat > "$ROOT/bin/agent-device" <<EOF
#!/bin/sh
export AGENT_DEVICE_STATE_DIR="$ROOT/agent-device/state" AGENT_DEVICE_MACOS_APP_BACKEND=native
exec "$NODE" "$CLI" "\\$@"
EOF
chmod 755 "$ROOT/bin/agent-device"

# What macOS lets the daemon do; mac status runs it too. It reads the frontmost app, so nothing moves.
cat > "$ROOT/bin/check-access" <<'EOF'
#!/bin/sh
AD="$(dirname "$0")/agent-device"
SHOT="\${TMPDIR:-/tmp}/zerops-mate-access-$$.png"
"$AD" open --platform macos --surface frontmost-app >/dev/null 2>&1
NODES=$("$AD" snapshot --platform macos 2>/dev/null | awk '/^Snapshot:/ { print $2 }')
"$AD" screenshot "$SHOT" --platform macos >/dev/null 2>&1 && RECORDING=allowed || RECORDING=missing
rm -f "$SHOT"
"$AD" close --platform macos >/dev/null 2>&1
[ "\${NODES:-0}" -gt 0 ] 2>/dev/null && ACCESSIBILITY=allowed || ACCESSIBILITY=missing
echo "Accessibility $ACCESSIBILITY, Screen Recording $RECORDING"
[ "$ACCESSIBILITY" = allowed ] && [ "$RECORDING" = allowed ]
EOF
chmod 755 "$ROOT/bin/check-access"

# The Mate's way in: an sshd of your own, on the VPN address only, for its key only.
[ -f "$ROOT/sshd/host_key" ] || ssh-keygen -q -t ed25519 -N '' -C "zerops-mate-$PROJECT" -f "$ROOT/sshd/host_key"
printf '%s\\n' "$MATE_KEY" > "$ROOT/sshd/authorized_keys"
chmod 600 "$ROOT/sshd/authorized_keys"
cat > "$ROOT/sshd/sshd_config" <<EOF
ListenAddress $ADDRESS
Port $PORT
HostKey $ROOT/sshd/host_key
AuthorizedKeysFile $ROOT/sshd/authorized_keys
AllowUsers $ME
PasswordAuthentication no
KbdInteractiveAuthentication no
UsePAM no
PidFile $ROOT/sshd/sshd.pid
SetEnv "PATH=$PATH"
EOF
/usr/sbin/sshd -t -f "$ROOT/sshd/sshd_config" || fail "the ssh server configuration was refused."

agent() {
  label="$LABEL.$1"; shift
  {
    printf '%s\\n' '<?xml version="1.0" encoding="UTF-8"?>' \\
      '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">' \\
      '<plist version="1.0"><dict>' "<key>Label</key><string>$label</string>" '<key>ProgramArguments</key><array>'
    for arg in "$@"; do printf '<string>%s</string>\\n' "$(xml "$arg")"; done
    printf '%s\\n' '</array><key>RunAtLoad</key><true/><key>KeepAlive</key><true/>' \\
      '<key>ThrottleInterval</key><integer>10</integer>' \\
      "<key>StandardErrorPath</key><string>$(xml "$ROOT/logs/$label.log")</string></dict></plist>"
  } > "$AGENTS/$label.plist"
  launchctl bootout "$DOMAIN/$label" 2>/dev/null || true
  for attempt in 1 2 3 4 5; do
    launchctl bootstrap "$DOMAIN" "$AGENTS/$label.plist" 2>/dev/null && return 0
    sleep 1
  done
  fail "macOS would not start $label."
}

say "starting the ssh server on $ADDRESS:$PORT and the agent-device daemon"
rm -f "$ROOT/agent-device/state/daemon.json"
agent sshd /usr/sbin/sshd -D -f "$ROOT/sshd/sshd_config" -E "$ROOT/logs/sshd.log"
agent agent-device /usr/bin/env "PATH=$PATH" AGENT_DEVICE_DAEMON_SERVER_MODE=http \\
  "AGENT_DEVICE_STATE_DIR=$ROOT/agent-device/state" AGENT_DEVICE_MACOS_APP_BACKEND=native "$NODE" "$DAEMON"
for attempt in $(seq 1 20); do
  [ -f "$ROOT/agent-device/state/daemon.json" ] && nc -z "$ADDRESS" "$PORT" 2>/dev/null && break
  [ "$attempt" = 20 ] && fail "the ssh server or the agent-device daemon did not come up; see $ROOT/logs."
  sleep 1
done

say "registering with the Mate"
NAME=$(scutil --get ComputerName 2>/dev/null || hostname)
HOST_KEY=$(cut -d ' ' -f 1,2 "$ROOT/sshd/host_key.pub")
printf '{"address":%s,"port":%s,"user":%s,"hostKey":%s,"root":%s,"workspace":%s,"name":%s,"macos":%s}' \\
  "$(json "$ADDRESS")" "$PORT" "$(json "$ME")" "$(json "$HOST_KEY")" "$(json "$ROOT")" \\
  "$(json "$WORKSPACE")" "$(json "$NAME")" "$(json "$(sw_vers -productVersion)")" |
  ssh -o BatchMode=yes "$MATE_HOST" mac register

restart_daemon() {
  rm -f "$ROOT/agent-device/state/daemon.json"
  launchctl kickstart -k "$DOMAIN/$LABEL.agent-device" >/dev/null 2>&1 || true
  for attempt in $(seq 1 15); do
    [ -f "$ROOT/agent-device/state/daemon.json" ] && return 0
    sleep 1
  done
}

if ACCESS=$("$ROOT/bin/check-access"); then
  say "paired. The Mate works in $WORKSPACE."
  exit 0
fi
NODE_FILE=$(realpath "$NODE" 2>/dev/null || echo "$NODE")
say "macOS has to let the agent-device daemon see and record apps ($ACCESS)."
say "In System Settings > Privacy & Security, turn on node under Accessibility and under Screen Recording."
say "If node is not listed, add it with + (press Cmd-Shift-G and paste $NODE_FILE)."
open "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture" 2>/dev/null || true
open "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility" 2>/dev/null || true
say "waiting for both (up to 5 minutes; Ctrl-C to stop, then run this again)..."
for attempt in $(seq 1 30); do
  sleep 10
  # Screen Recording applies to a process only once it restarts.
  restart_daemon
  if ACCESS=$("$ROOT/bin/check-access"); then
    say "paired. The Mate works in $WORKSPACE."
    exit 0
  fi
done
fail "paired, but $ACCESS. Allow node in both lists, then run this again."
`;

export const renderMacRemoveScript = (projectId: string): string => `${preamble(projectId)}
for name in sshd agent-device; do
  launchctl bootout "$DOMAIN/$LABEL.$name" 2>/dev/null || true
  rm -f "$AGENTS/$LABEL.$name.plist"
done
rm -rf "$ROOT"
say "removed this Mate's ssh server and agent-device from this Mac. Copies in $HOME/ZeropsMate/$PROJECT are yours to keep or delete."
`;

/** What `ssh zcp mac host | sh` runs when the Mate cannot render a script. */
export const renderMacHostFailure = (message: string): string =>
  `#!/bin/sh\nprintf 'Zerops Mate: %s\\n' ${shellQuote(message)} >&2\nexit 1\n`;
