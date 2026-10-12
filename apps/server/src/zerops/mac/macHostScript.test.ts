// @effect-diagnostics nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { afterEach, describe, expect, it } from "vite-plus/test";

import { MAC_VIEW_SCRIPT } from "./macViewScript.ts";
import {
  type MacHostScriptInput,
  renderMacHostFailure,
  renderMacHostScript,
  renderMacRemoveScript,
} from "./macHostScript.ts";

const PROJECT = "Prj0AAAAAAAAAAAAAAAAAA";
const input: MacHostScriptInput = {
  projectId: PROJECT,
  mateHost: "zcp",
  mateAddress: "10.11.240.9",
  vpnRange: "10.12.0.0/22",
  port: 22_417,
  mateKey: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIMateKey zerops-mate-it's",
  agentDeviceVersion: "0.21.24",
};

const scratch: string[] = [];
afterEach(() => {
  for (const dir of scratch.splice(0)) NodeFS.rmSync(dir, { recursive: true, force: true });
});

const BASE_TOOLS = ["awk", "rm", "sed", "cat", "id"];
/** A whole pairing also needs the tools it files and keys with. */
const PAIRING_TOOLS = ["mkdir", "chmod", "cut", "seq", "ssh-keygen", "dirname"];
const extraTools = (stubs: Record<string, string>) =>
  "npm" in stubs ? [...BASE_TOOLS, ...PAIRING_TOOLS] : BASE_TOOLS;

/** Runs a script under sh as a Mac would, with some commands replaced by stubs. */
const runOnFakeMac = (script: string, stubs: Record<string, string>) => {
  const home = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "mac-home-"));
  const bin = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "mac-bin-"));
  scratch.push(home, bin);
  // Only the stubs and the few real tools the scripts lean on: nothing else, node included.
  for (const tool of extraTools(stubs)) {
    // A stub replaces the tool; never link one, or writing the stub would write through the link.
    if (tool in stubs) continue;
    const real = ["/usr/bin", "/bin"]
      .map((dir) => NodePath.join(dir, tool))
      .find(NodeFS.existsSync);
    if (real) NodeFS.symlinkSync(real, NodePath.join(bin, tool));
  }
  for (const [name, body] of Object.entries(stubs)) {
    NodeFS.writeFileSync(NodePath.join(bin, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  }
  const run = () =>
    NodeChildProcess.spawnSync("/bin/sh", ["-s"], {
      input: script,
      encoding: "utf8",
      env: { HOME: home, PATH: bin },
    });
  return { home, run };
};

describe("the scripts the Mate hands a Mac", () => {
  it.each([
    ["pairing", renderMacHostScript(input)],
    ["removal", renderMacRemoveScript(PROJECT)],
    ["failure", renderMacHostFailure("this container does not know its project VPN.")],
  ])("the %s script is valid sh", (_, script) => {
    const check = NodeChildProcess.spawnSync("sh", ["-n"], { input: script, encoding: "utf8" });
    expect(check.stderr).toBe("");
    expect(check.status).toBe(0);
  });

  it("refuses to run anywhere but a Mac", () => {
    const mac = runOnFakeMac(renderMacHostScript(input), { uname: "echo Linux" });
    const result = mac.run();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("run this on the Mac");
  });

  it("refuses to pair a Mac that is not on the project VPN, and installs nothing", () => {
    const mac = runOnFakeMac(renderMacHostScript(input), {
      uname: "echo Darwin",
      route: "echo '  interface: en0'",
      ifconfig: "printf '\\tinet 192.168.1.20 netmask 0xffffff00\\n'",
    });
    const result = mac.run();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      `not on the project VPN. Connect it first: zcli vpn up ${PROJECT}`,
    );
    expect(NodeFS.existsSync(NodePath.join(mac.home, ".zerops-mate"))).toBe(false);
  });

  it("asks for Node.js on a Mac that is on the VPN but has none", () => {
    const mac = runOnFakeMac(renderMacHostScript(input), {
      uname: "echo Darwin",
      route: "echo '  interface: utun5'",
      ifconfig: "printf '\\tinet 10.12.0.4 --> 10.12.0.4 netmask 0xffffffff\\n'",
    });
    const result = mac.run();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Node.js is missing");
  });

  it("lets only the Mate's key in, on the Mac's VPN address only", () => {
    const script = renderMacHostScript(input);
    expect(script).toContain("ListenAddress $ADDRESS");
    expect(script).toContain("PasswordAuthentication no");
    expect(script).toContain(`printf '%s\\n' "$MATE_KEY" > "$ROOT/sshd/authorized_keys"`);
    expect(script).toContain(
      "MATE_KEY='ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIMateKey zerops-mate-it'\\''s'",
    );
  });

  it("removing the pairing stops both background services and deletes their files", () => {
    const mac = runOnFakeMac(renderMacRemoveScript(PROJECT), {
      uname: "echo Darwin",
      launchctl: `echo "$@" >> "$HOME/launchctl.log"`,
      id: "echo 501",
    });
    const root = NodePath.join(mac.home, ".zerops-mate", PROJECT);
    const agents = NodePath.join(mac.home, "Library", "LaunchAgents");
    NodeFS.mkdirSync(NodePath.join(root, "sshd"), { recursive: true });
    NodeFS.mkdirSync(agents, { recursive: true });
    for (const name of ["sshd", "agent-device"]) {
      NodeFS.writeFileSync(NodePath.join(agents, `io.zerops.mate.${PROJECT}.${name}.plist`), "");
    }

    const result = mac.run();

    expect(result.status).toBe(0);
    expect(NodeFS.existsSync(root)).toBe(false);
    expect(NodeFS.readdirSync(agents)).toEqual([]);
    const log = NodeFS.readFileSync(NodePath.join(mac.home, "launchctl.log"), "utf8");
    expect(log).toContain(`bootout gui/501/io.zerops.mate.${PROJECT}.sshd\n`);
    expect(log).toContain(`bootout gui/501/io.zerops.mate.${PROJECT}.agent-device\n`);
  });

  it("removing the pairing stops the live view too", () => {
    const mac = runOnFakeMac(renderMacRemoveScript(PROJECT), {
      uname: "echo Darwin",
      launchctl: `echo "$@" >> "$HOME/launchctl.log"`,
      id: "echo 501",
    });
    const agents = NodePath.join(mac.home, "Library", "LaunchAgents");
    NodeFS.mkdirSync(agents, { recursive: true });
    NodeFS.writeFileSync(NodePath.join(agents, `io.zerops.mate.${PROJECT}.view.plist`), "");

    expect(mac.run().status).toBe(0);
    expect(NodeFS.readdirSync(agents)).toEqual([]);
    expect(NodeFS.readFileSync(NodePath.join(mac.home, "launchctl.log"), "utf8")).toContain(
      `bootout gui/501/io.zerops.mate.${PROJECT}.view\n`,
    );
  });

  it("pairing leaves the live view running as the user's node, with its helper written intact", () => {
    // A Mac on the VPN with node and npm; launchd starts what it is given at once.
    const state = `$HOME/.zerops-mate/${PROJECT}/agent-device/state`;
    const mac = runOnFakeMac(renderMacHostScript(input), {
      uname: "echo Darwin",
      route: "echo '  interface: utun5'",
      ifconfig: "printf '\\tinet 10.12.0.4 --> 10.12.0.4 netmask 0xffffffff\\n'",
      node: `case "$2" in snapshot) echo 'Snapshot: 12 nodes';; esac; exit 0`,
      realpath: `echo "$1"`,
      npm: [
        `while [ "$1" != --prefix ]; do shift; done; P="$2/node_modules/agent-device"`,
        `mkdir -p "$P/bin" "$P/dist/src/internal" && : > "$P/bin/agent-device.mjs" && : > "$P/dist/src/internal/daemon.js"`,
      ].join("\n"),
      launchctl: `echo "$@" >> "$HOME/launchctl.log"; case "$*" in bootstrap*agent-device*) : > "${state}/daemon.json";; esac`,
      nc: "exit 0",
      sleep: "exit 0",
      scutil: "echo 'Test Mac'",
      sw_vers: "echo 26.1",
      ssh: "cat > /dev/null",
      open: "exit 0",
    });

    const result = mac.run();

    expect(result.stderr).toContain("paired.");
    expect(result.status).toBe(0);
    const root = NodePath.join(mac.home, ".zerops-mate", PROJECT);
    expect(NodeFS.readFileSync(NodePath.join(root, "bin", "view.mjs"), "utf8")).toBe(
      MAC_VIEW_SCRIPT,
    );
    const plist = NodeFS.readFileSync(
      NodePath.join(mac.home, "Library", "LaunchAgents", `io.zerops.mate.${PROJECT}.view.plist`),
      "utf8",
    );
    expect(plist).toContain(`<string>${NodePath.join(root, "bin", "view.mjs")}</string>`);
    expect(plist).toMatch(/<array>\s*<string>[^<]*\/node<\/string>/u);
    expect(NodeFS.readFileSync(NodePath.join(mac.home, "launchctl.log"), "utf8")).toContain(
      `bootstrap gui/501 ${NodePath.join(mac.home, "Library", "LaunchAgents", `io.zerops.mate.${PROJECT}.view.plist`)}`,
    );
  });

  it("a daemon that has just started gets a few tries before System Settings opens on anyone's screen", () => {
    // The first permission check after the daemon starts sees nothing; the next one sees the app.
    const state = `$HOME/.zerops-mate/${PROJECT}/agent-device/state`;
    const mac = runOnFakeMac(renderMacHostScript(input), {
      uname: "echo Darwin",
      route: "echo '  interface: utun5'",
      ifconfig: "printf '\\tinet 10.12.0.4 --> 10.12.0.4 netmask 0xffffffff\\n'",
      node: [
        `case "$2" in snapshot)`,
        `  n=$(cat "$HOME/snapshots" 2>/dev/null || echo 0); n=$((n + 1)); echo "$n" > "$HOME/snapshots"`,
        `  if [ "$n" -ge 2 ]; then echo 'Snapshot: 12 nodes'; else echo 'Snapshot: 0 nodes'; fi;;`,
        `esac; exit 0`,
      ].join("\n"),
      realpath: `echo "$1"`,
      npm: [
        `while [ "$1" != --prefix ]; do shift; done; P="$2/node_modules/agent-device"`,
        `mkdir -p "$P/bin" "$P/dist/src/internal" && : > "$P/bin/agent-device.mjs" && : > "$P/dist/src/internal/daemon.js"`,
      ].join("\n"),
      launchctl: `case "$*" in bootstrap*agent-device*) : > "${state}/daemon.json";; esac`,
      nc: "exit 0",
      sleep: "exit 0",
      scutil: "echo 'Test Mac'",
      sw_vers: "echo 26.1",
      ssh: "cat > /dev/null",
      open: `echo "$@" >> "$HOME/opened"`,
    });

    const result = mac.run();

    expect(result.stderr).toContain("paired.");
    expect(result.status).toBe(0);
    expect(NodeFS.existsSync(NodePath.join(mac.home, "opened"))).toBe(false);
  });

  it("a Mac piping a failed render into sh sees why and stops", () => {
    const result = NodeChildProcess.spawnSync("sh", ["-s"], {
      input: renderMacHostFailure("mac works only inside a Zerops Mate container."),
      encoding: "utf8",
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toBe("Zerops Mate: mac works only inside a Zerops Mate container.\n");
  });
});
