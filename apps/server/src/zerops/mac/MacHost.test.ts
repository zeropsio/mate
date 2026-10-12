import { describe, expect, it } from "vite-plus/test";

import {
  acceptMacRegistration,
  isIpv4InRange,
  knownHostsLine,
  macDeviceCommand,
  macHostPaths,
  type MacHostRecord,
  macRunCommand,
  macSshArgs,
  macStatusCommand,
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
    [["status"], { _tag: "status" }],
    [["pair"], { _tag: "pair" }],
    [["sync"], { _tag: "sync" }],
    [["host"], { _tag: "host", remove: false }],
    [["host", "--remove"], { _tag: "host", remove: true }],
    [["run", "swift", "build"], { _tag: "run", command: ["swift", "build"] }],
    [
      ["device", "press", "@e4", "--settle"],
      { _tag: "device", args: ["press", "@e4", "--settle"] },
    ],
    [["screenshot"], { _tag: "screenshot", out: undefined }],
    [["screenshot", "/tmp/a.png"], { _tag: "screenshot", out: "/tmp/a.png" }],
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
    const command = macStatusCommand(record);
    expect(command).toContain("'/Users/ales/.zerops-mate/Prj0AAAAAAAAAAAAAAAAAA/bin/check-access'");
    expect(command).toContain("allow node under Accessibility and Screen Recording");
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
    expect(macDeviceCommand(record, args)).toBe(
      `'/Users/ales/.zerops-mate/Prj0AAAAAAAAAAAAAAAAAA/bin/agent-device' ${expected}`,
    );
  });
});
