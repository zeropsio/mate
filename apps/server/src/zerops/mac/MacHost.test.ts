// @effect-diagnostics nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { describe, expect, it } from "vite-plus/test";

import {
  acceptMacRegistration,
  isIpv4InRange,
  knownHostsLine,
  macDeviceCommand,
  macHostPaths,
  type MacHostRecord,
  macRunCommand,
  macScreenshotCommand,
  macSshArgs,
  macStatusReport,
  renderMacStatus,
  macSshPort,
  macSyncArgs,
  parseMacCommand,
} from "./MacHost.ts";

const record: MacHostRecord = {
  address: "10.12.0.4",
  port: 22_417,
  user: "ales",
  hostKey: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIExampleHostKey",
  root: "/Users/ales/.zerops-mate/Prj0AAAAAAAAAAAAAAAAAA",
  workspace: "/Users/ales/ZeropsMate/Prj0AAAAAAAAAAAAAAAAAA",
  name: "Ales's Mac mini",
  macos: "26.1",
};
const paths = macHostPaths("/home/zerops/.t3");

describe("parseMacCommand", () => {
  it.each([
    [[], { _tag: "help" }],
    [["status"], { _tag: "status", json: false }],
    [["status", "--json"], { _tag: "status", json: true }],
    [["pair"], { _tag: "pair" }],
    [["sync"], { _tag: "sync" }],
    [["host"], { _tag: "host", remove: false }],
    [["host", "--remove"], { _tag: "host", remove: true }],
    [["run", "swift", "build"], { _tag: "run", command: ["swift", "build"] }],
    [
      ["device", "press", "@e4", "--settle"],
      { _tag: "device", args: ["press", "@e4", "--settle"], whileInUse: false },
    ],
    [
      ["device", "--while-in-use", "press", "@e4"],
      { _tag: "device", args: ["press", "@e4"], whileInUse: true },
    ],
    [["screenshot"], { _tag: "screenshot", out: undefined, whileInUse: false }],
    [["screenshot", "/tmp/a.png"], { _tag: "screenshot", out: "/tmp/a.png", whileInUse: false }],
    [
      ["screenshot", "--while-in-use", "/tmp/a.png"],
      { _tag: "screenshot", out: "/tmp/a.png", whileInUse: true },
    ],
  ] as const)("reads `mac %j` as the command an agent meant", (args, expected) => {
    expect(parseMacCommand(args)).toEqual(expected);
  });

  it.each([[["run"]], [["device"]], [["status", "now"]], [["build"]]] as const)(
    "answers `mac %j` with how to use it instead of guessing",
    (args) => {
      expect(parseMacCommand(args)._tag).toBe("usage");
    },
  );
});

describe("acceptMacRegistration", () => {
  const registration = (overrides: Partial<MacHostRecord>) =>
    JSON.stringify({ ...record, ...overrides });

  it("pairs a Mac that registers from inside the project VPN", () => {
    expect(acceptMacRegistration(registration({}), "10.12.0.0/22")).toEqual({ record });
  });

  it.each([
    [
      "an address outside the project VPN",
      registration({ address: "192.168.1.20" }),
      "10.12.0.0/22",
    ],
    ["a container that does not know its VPN", registration({}), undefined],
    ["a user name a shell would split", registration({ user: "ales; rm -rf ~" }), "10.12.0.0/22"],
    ["a host key that is not ed25519", registration({ hostKey: "ssh-rsa AAAA" }), "10.12.0.0/22"],
    ["an incomplete registration", JSON.stringify({ address: "10.12.0.4" }), "10.12.0.0/22"],
  ])("refuses a pairing with %s", (_, json, range) => {
    expect(acceptMacRegistration(json, range)).toHaveProperty("refused");
  });
});

describe("isIpv4InRange", () => {
  it.each([
    ["10.12.0.4", "10.12.0.0/22", true],
    ["10.12.3.255", "10.12.0.0/22", true],
    ["10.12.4.0", "10.12.0.0/22", false],
    ["10.11.240.9", "10.12.0.0/22", false],
    ["10.12.0.4", "10.12.0.4/32", true],
    ["not-an-ip", "10.12.0.0/22", false],
    ["10.12.0.300", "10.12.0.0/22", false],
  ])("places %s against %s as %s", (address, range, inside) => {
    expect(isIpv4InRange(address, range)).toBe(inside);
  });
});

describe("the Mac's ssh port", () => {
  it("is fixed per project, so a Mac on several project VPNs runs one ssh server per Mate", () => {
    const projects = ["Prj0AAAAAAAAAAAAAAAAAA", "Prj1BBBBBBBBBBBBBBBBBB", "Prj2CCCCCCCCCCCCCCCCCC"];
    const ports = projects.map(macSshPort);
    expect(projects.map(macSshPort)).toEqual(ports);
    expect(new Set(ports).size).toBe(3);
    for (const port of ports) {
      expect(port).toBeGreaterThanOrEqual(22_000);
      expect(port).toBeLessThan(23_000);
    }
  });
});

describe("commands on the Mac", () => {
  it("mac status says whether macOS lets agent-device see and record apps, and how to fix it", () => {
    const status = renderMacStatus(
      macStatusReport({
        projectId: "Prj0AAAAAAAAAAAAAAAAAA",
        host: "zcp",
        record: { ...record, node: "/usr/local/bin/node" },
        probe: { code: 0, stdout: "access=Accessibility missing, Screen Recording allowed\n" },
      }),
    );
    expect(status.exitCode).toBe(1);
    expect(status.text).toContain(
      "turn on node under Accessibility (add /usr/local/bin/node with + if it is not listed)",
    );
    expect(status.text).toContain("ssh zcp mac host | sh");
  });

  it("asks the Mac itself every time, never through a connection an earlier command left open", () => {
    // The container's ssh config multiplexes every host for 10 minutes; through
    // a lingering connection a Mac whose ssh server is gone still looked ready.
    expect(macSshArgs(record, paths, "true")).toEqual(
      expect.arrayContaining(["ControlMaster=no", "ControlPath=none"]),
    );
    expect(macSyncArgs(record, paths, "/var/www/counter")).toEqual(
      expect.arrayContaining([expect.stringContaining("'ControlPath=none'")]),
    );
  });

  it("reaches only the paired Mac, with this Mate's key, without prompting", () => {
    const args = macSshArgs(record, paths, "true");
    expect(args).toEqual(
      expect.arrayContaining([
        "-i",
        "/home/zerops/.t3/mac/id_ed25519",
        "BatchMode=yes",
        "StrictHostKeyChecking=yes",
        "UserKnownHostsFile=/home/zerops/.t3/mac/known_hosts",
      ]),
    );
    expect(args.slice(-2)).toEqual(["ales@10.12.0.4", "true"]);
    expect(knownHostsLine(record)).toBe(`[10.12.0.4]:22417 ${record.hostKey}\n`);
  });

  it("copies the working directory into its own folder on the Mac, honouring .gitignore", () => {
    const args = macSyncArgs(record, paths, "/var/www/counter/");
    expect(args).toContain("--filter=:- .gitignore");
    expect(args).toContain("--delete");
    expect(args.slice(-2)).toEqual([
      "/var/www/counter/",
      "ales@10.12.0.4:/Users/ales/ZeropsMate/Prj0AAAAAAAAAAAAAAAAAA/counter/",
    ]);
  });

  it("runs a command in the Mac's copy, and says to sync first when there is none", () => {
    const command = macRunCommand(record, "/var/www/counter", ["swift", "build", "&&", "./run.sh"]);
    expect(command).toContain("cd '/Users/ales/ZeropsMate/Prj0AAAAAAAAAAAAAAAAAA/counter'");
    expect(command).toContain("run mac sync first");
    expect(command.endsWith("swift build && ./run.sh")).toBe(true);
  });

  it.each([
    [["snapshot", "-i"], "'snapshot' '-i' '--platform' 'macos'"],
    [["devices", "--platform", "ios"], "'devices' '--platform' 'ios'"],
    [["fill", "@e2", "it's done"], "'fill' '@e2' 'it'\\''s done' '--platform' 'macos'"],
  ])("aims agent-device %j at macOS apps unless a platform is given", (args, expected) => {
    expect(
      macDeviceCommand(record, args).endsWith(
        `'/Users/ales/.zerops-mate/Prj0AAAAAAAAAAAAAAAAAA/bin/agent-device' ${expected}`,
      ),
    ).toBe(true);
  });
});

describe("macStatusReport", () => {
  const pairing = { projectId: "Prj0AAAAAAAAAAAAAAAAAA", host: "zcp" };
  const commands = {
    pairCommands: ["zcli vpn up Prj0AAAAAAAAAAAAAAAAAA", "ssh zcp mac host | sh"],
    removeCommand: "ssh zcp mac host --remove | sh",
  };
  const mac = {
    name: "Ales's Mac mini",
    user: "ales",
    address: "10.12.0.4",
    port: 22_417,
    macos: "26.1",
    agentDevice: "0.21.24",
    node: null,
  };
  const probe = (access: string) => ({
    code: 0,
    stdout: `macos=26.1\nagent-device=0.21.24\naccess=${access}\n`,
  });

  it.each([
    ["no Mac is paired", undefined, undefined, { stage: "not-paired", mac: null, missing: [] }],
    [
      "the Mac does not answer over the VPN",
      record,
      { code: 255, stdout: "" },
      { stage: "unreachable", mac: { ...mac, macos: null, agentDevice: null }, missing: [] },
    ],
    [
      "macOS has not allowed Accessibility",
      record,
      probe("Accessibility missing, Screen Recording allowed"),
      { stage: "needs-permissions", mac, missing: ["Accessibility"] },
    ],
    [
      "macOS has allowed neither",
      record,
      probe("Accessibility missing, Screen Recording missing"),
      { stage: "needs-permissions", mac, missing: ["Accessibility", "Screen Recording"] },
    ],
    [
      "the Mac cannot report its permissions yet",
      record,
      probe(""),
      { stage: "needs-permissions", mac, missing: ["Accessibility", "Screen Recording"] },
    ],
    [
      "everything works",
      record,
      probe("Accessibility allowed, Screen Recording allowed"),
      { stage: "ready", mac, missing: [] },
    ],
  ] as const)("tells the next step when %s", (_, paired, result, expected) => {
    expect(macStatusReport({ ...pairing, record: paired, probe: result })).toEqual({
      ...expected,
      ...commands,
    });
  });

  it("names the node the user has to allow, once the Mac reported it", () => {
    const report = macStatusReport({
      ...pairing,
      record: { ...record, node: "/opt/homebrew/Cellar/node/24.1.0/bin/node" },
      probe: probe("Accessibility missing, Screen Recording allowed"),
    });
    expect(report.mac?.node).toBe("/opt/homebrew/Cellar/node/24.1.0/bin/node");
  });
});

describe("a Mac the user is working on", () => {
  // Runs the remote command as the Mac would, with ioreg and agent-device stubbed.
  const onMac = (command: (paired: MacHostRecord) => string, idleSeconds: number) => {
    const home = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "mac-busy-"));
    try {
      const bin = NodePath.join(home, "bin");
      NodeFS.mkdirSync(bin);
      NodeFS.writeFileSync(
        NodePath.join(bin, "ioreg"),
        `#!/bin/sh\necho '    |   "HIDIdleTime" = ${idleSeconds * 1_000_000_000}'\n`,
        { mode: 0o755 },
      );
      NodeFS.writeFileSync(
        NodePath.join(bin, "agent-device"),
        `#!/bin/sh\necho "$@" >> "${home}/drove"\n`,
        { mode: 0o755 },
      );
      const result = NodeChildProcess.spawnSync(
        "/bin/sh",
        ["-c", command({ ...record, root: home })],
        {
          encoding: "utf8",
          env: { PATH: `${bin}:/usr/bin:/bin`, TMPDIR: home },
        },
      );
      const drove = NodeFS.existsSync(NodePath.join(home, "drove"))
        ? NodeFS.readFileSync(NodePath.join(home, "drove"), "utf8")
        : "";
      return { code: result.status, stderr: result.stderr, drove };
    } finally {
      NodeFS.rmSync(home, { recursive: true, force: true });
    }
  };

  it.each([
    ["press", (paired: MacHostRecord) => macDeviceCommand(paired, ["press", "@e4"])],
    ["open", (paired: MacHostRecord) => macDeviceCommand(paired, ["open", "com.example.app"])],
    ["snapshot", (paired: MacHostRecord) => macDeviceCommand(paired, ["snapshot", "-i"])],
    ["screenshot", (paired: MacHostRecord) => macScreenshotCommand(paired)],
  ])("does not take over their screen to %s while they work, and says why", (_, command) => {
    const { code, stderr, drove } = onMac(command, 3);
    expect(code).toBe(75);
    expect(drove).toBe("");
    expect(stderr).toContain("working on this Mac");
    expect(stderr).toContain("--while-in-use");
  });

  it("drives the Mac once the user has stepped away", () => {
    const { code, drove } = onMac((paired) => macDeviceCommand(paired, ["press", "@e4"]), 120);
    expect(code).toBe(0);
    expect(drove).toBe("press @e4 --platform macos\n");
  });

  it("with the user's go-ahead, drives the Mac while they work", () => {
    const { code, drove } = onMac(
      (paired) => macDeviceCommand(paired, ["press", "@e4"], { whileInUse: true }),
      3,
    );
    expect(code).toBe(0);
    expect(drove).toBe("press @e4 --platform macos\n");
  });

  it("lists apps and devices at any time, since that moves nothing on screen", () => {
    const { code, drove } = onMac((paired) => macDeviceCommand(paired, ["apps"]), 3);
    expect(code).toBe(0);
    expect(drove).toBe("apps --platform macos\n");
  });
});
