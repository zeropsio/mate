// @effect-diagnostics nodeBuiltinImport:off globalDate:off
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { describe, expect, it } from "vite-plus/test";

import {
  acceptMacRegistration,
  decodeMacViewRecord,
  isIpv4InRange,
  knownHostsLine,
  macDeviceCommand,
  macHostPaths,
  type MacHostRecord,
  macOpenCommand,
  macRunCommand,
  macScreenPoint,
  macScreenshotCommand,
  macShotPath,
  macSshArgs,
  macStatusReport,
  renderMacStatus,
  macSshPort,
  macSyncArgs,
  macViewStreamCommand,
  macViewShot,
  macViewTarget,
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
    [["open", "build/Counter+ Pro.app"], { _tag: "open", app: "build/Counter+ Pro.app" }],
    [
      ["device", "press", "@e4", "--settle"],
      { _tag: "device", args: ["press", "@e4", "--settle"], whileInUse: false },
    ],
    [
      ["device", "--while-in-use", "press", "@e4"],
      { _tag: "device", args: ["press", "@e4"], whileInUse: true },
    ],
    [["screenshot"], { _tag: "screenshot", out: undefined, whileInUse: false, screen: false }],
    [
      ["screenshot", "/tmp/a.png"],
      { _tag: "screenshot", out: "/tmp/a.png", whileInUse: false, screen: false },
    ],
    [
      ["screenshot", "--while-in-use", "/tmp/a.png"],
      { _tag: "screenshot", out: "/tmp/a.png", whileInUse: true, screen: false },
    ],
    [
      ["screenshot", "--screen", "--while-in-use"],
      { _tag: "screenshot", out: undefined, whileInUse: true, screen: true },
    ],
  ] as const)("reads `mac %j` as the command an agent meant", (args, expected) => {
    expect(parseMacCommand(args)).toEqual(expected);
  });

  it.each([
    [["run"]],
    [["device"]],
    [["status", "now"]],
    [["build"]],
    [["open"]],
    [["open", "Counter", "Notes"]],
  ] as const)("answers `mac %j` with how to use it instead of guessing", (args) => {
    expect(parseMacCommand(args)._tag).toBe("usage");
  });
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
    expect(macDeviceCommand(record, args)).toContain(
      `'/Users/ales/.zerops-mate/Prj0AAAAAAAAAAAAAAAAAA/bin/agent-device' ${expected}`,
    );
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

describe("the app the live view follows", () => {
  it.each([
    [["open", "com.example.Counter"], "com.example.Counter"],
    [["open", "Counter", "--relaunch"], "Counter"],
    [["open", "--platform", "macos", "com.example.Counter"], "com.example.Counter"],
    [["open", "--surface=app", "Counter"], "Counter"],
  ] as const)("mac device %j shows that app in the live view", (args, app) => {
    expect(macViewTarget(args)).toBe(app);
  });

  it.each([
    [["open"]],
    [["open", "--surface", "frontmost-app"]],
    [["press", "@e4"]],
    [[]],
  ] as const)("mac device %j leaves the live view on the app it showed", (args) => {
    expect(macViewTarget(args)).toBeUndefined();
  });

  it("reads back the app it recorded, and nothing from a broken record", () => {
    expect(decodeMacViewRecord(JSON.stringify({ app: "com.example.Counter", at: 5 }))).toEqual({
      app: "com.example.Counter",
      at: 5,
    });
    expect(decodeMacViewRecord("{")).toBeUndefined();
    expect(decodeMacViewRecord(JSON.stringify({ at: 5 }))).toBeUndefined();
  });

  it("asks the Mac's view helper for that app's window over the one ssh connection", () => {
    const home = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "mac-view-"));
    try {
      const bin = NodePath.join(home, "bin");
      NodeFS.mkdirSync(bin);
      NodeFS.writeFileSync(NodePath.join(bin, "curl"), `#!/bin/sh\nprintf '%s\\n' "$@"\n`, {
        mode: 0o755,
      });
      const result = NodeChildProcess.spawnSync(
        "/bin/sh",
        ["-c", macViewStreamCommand({ ...record, root: home }, "Counter & Co's", 2)],
        { encoding: "utf8", env: { PATH: `${bin}:/usr/bin:/bin` } },
      );
      expect(result.status).toBe(0);
      const args = result.stdout.trim().split("\n");
      expect(args).toEqual(
        expect.arrayContaining([
          `${home}/view.sock`,
          "http://mate/stream?app=Counter%20%26%20Co's&fps=2",
        ]),
      );
    } finally {
      NodeFS.rmSync(home, { recursive: true, force: true });
    }
  });
});

describe("opening an app for the person to watch", () => {
  /**
   * Runs `mac open` as the Mac would: a real ps and kill, with \`open\` recording
   * what it was asked and lsappinfo answering for the front app. The person
   * works in com.example.Editor; with \`stealsFront\`, the opened app activates
   * itself and takes the front.
   */
  const onMac = (
    app: string,
    prepare: (copy: string) => void = () => undefined,
    options: { readonly stealsFront?: boolean } = {},
  ) => {
    const home = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "mac-open-"));
    try {
      const bin = NodePath.join(home, "bin");
      const copy = NodePath.join(home, "ZeropsMate", "app");
      NodeFS.mkdirSync(bin);
      NodeFS.mkdirSync(copy, { recursive: true });
      const front = NodePath.join(home, "front");
      NodeFS.writeFileSync(
        front,
        '"CFBundleIdentifier"="com.example.Editor"\n"LSBundlePath"="/Applications/Editor.app"\n"LSDisplayName"="Editor"\n',
      );
      const steal = options.stealsFront
        ? `case "$1" in -g) shift; case "$1" in -b) k=CFBundleIdentifier; shift;; -a) k=LSDisplayName; shift;; *) k=LSBundlePath;; esac; printf '"%s"="%s"\\n' "$k" "$1" > "${front}";; esac\n`
        : "";
      NodeFS.writeFileSync(
        NodePath.join(bin, "open"),
        `#!/bin/sh\necho "$@" >> "${home}/opened"\n${steal}`,
        { mode: 0o755 },
      );
      NodeFS.writeFileSync(NodePath.join(bin, "sleep"), "#!/bin/sh\n", { mode: 0o755 });
      NodeFS.writeFileSync(
        NodePath.join(bin, "lsappinfo"),
        `#!/bin/sh\ncase "$3" in bundleid) k=CFBundleIdentifier;; bundlepath) k=LSBundlePath;; *) k=LSDisplayName;; esac\ncase "$1" in front) echo 'ASN:0x0-0x1:';; info) grep "^\\"$k\\"=" "${front}";; esac\n`,
        { mode: 0o755 },
      );
      prepare(copy);
      const result = NodeChildProcess.spawnSync(
        "/bin/sh",
        [
          "-c",
          macOpenCommand(
            { ...record, root: home, workspace: NodePath.join(home, "ZeropsMate") },
            "/var/www/app",
            app,
          ),
        ],
        { encoding: "utf8", env: { PATH: `${bin}:/usr/bin:/bin`, HOME: home } },
      );
      const opened = NodeFS.existsSync(NodePath.join(home, "opened"))
        ? NodeFS.readFileSync(NodePath.join(home, "opened"), "utf8")
        : "";
      return { code: result.status, stdout: result.stdout, stderr: result.stderr, opened, copy };
    } finally {
      NodeFS.rmSync(home, { recursive: true, force: true });
    }
  };
  const buildApp = (copy: string, name: string) => {
    const macos = NodePath.join(copy, "build", `${name}.app`, "Contents", "MacOS");
    NodeFS.mkdirSync(macos, { recursive: true });
    const executable = NodePath.join(macos, name);
    NodeFS.writeFileSync(executable, "#!/bin/sh\nwhile :; do sleep 1; done\n", { mode: 0o755 });
    return { app: NodeFS.realpathSync(NodePath.join(copy, "build", `${name}.app`)), executable };
  };

  it("opens the app built in the Mac's copy behind the person's windows, and names it for the live view", () => {
    let built = "";
    const { code, stdout, opened } = onMac("build/Counter+ Pro.app", (copy) => {
      built = buildApp(copy, "Counter+ Pro").app;
    });
    expect(code).toBe(0);
    expect(opened).toBe(`-g ${built}\n`);
    expect(stdout.trim().split("\n").at(-1)).toBe(built);
  });

  // Whether a process still runs an app's executable; one that quit is gone or a zombie.
  const runsApp = (pid: number | undefined) =>
    pid !== undefined &&
    NodeChildProcess.spawnSync("ps", ["-p", String(pid), "-o", "command="], {
      encoding: "utf8",
    }).stdout.includes(".app/Contents/MacOS/");

  it("quits the copy of that build still running, so a rebuild is what opens", () => {
    let running: NodeChildProcess.ChildProcess | undefined;
    let other: NodeChildProcess.ChildProcess | undefined;
    try {
      const { code } = onMac("build/Counter+ Pro.app", (copy) => {
        running = NodeChildProcess.spawn(buildApp(copy, "Counter+ Pro").executable, [], {
          stdio: "ignore",
        });
        other = NodeChildProcess.spawn(buildApp(copy, "Notes").executable, [], { stdio: "ignore" });
        NodeChildProcess.spawnSync("sleep", ["0.3"]);
      });
      expect(code).toBe(0);
      expect(runsApp(running?.pid)).toBe(false);
      expect(runsApp(other?.pid)).toBe(true);
    } finally {
      running?.kill("SIGKILL");
      other?.kill("SIGKILL");
    }
  });

  it.each([
    ["an installed app's bundle id", "com.example.Counter", "-g -b com.example.Counter\n"],
    ["an installed app's name", "Counter Pro", "-g -a Counter Pro\n"],
  ])("opens %s in the background too", (_, app, expected) => {
    const { code, stdout, opened } = onMac(app);
    expect(code).toBe(0);
    expect(opened).toBe(expected);
    expect(stdout.trim()).toBe(app);
  });

  it.each([
    ["the app it built", "build/Counter.app", true],
    ["an installed app by bundle id", "com.example.Counter", false],
    ["an installed app by name", "Counter", false],
  ])(
    "gives the front back to the person's app when %s activates itself on launch",
    (_, app, built) => {
      const { code, opened } = onMac(
        app,
        (copy) => {
          if (built) buildApp(copy, "Counter");
        },
        { stealsFront: true },
      );
      expect(code).toBe(0);
      expect(opened.trim().split("\n").at(-1)).toBe("-b com.example.Editor");
    },
  );

  it("leaves the person's front app alone when the opened app stays behind", () => {
    const { opened } = onMac("com.example.Counter");
    expect(opened).toBe("-g -b com.example.Counter\n");
  });

  it("says to build the app first when the Mac's copy has none at that path", () => {
    const { code, stderr, opened } = onMac("build/Missing.app");
    expect(code).toBe(66);
    expect(opened).toBe("");
    expect(stderr).toContain("build/Missing.app");
  });
});

describe("a screenshot of the app the Mac tab shows", () => {
  const frame = {
    type: "frame",
    size: 3,
    mimeType: "image/jpeg",
    width: 2,
    height: 2,
    bounds: { x: 0, y: 0, width: 1, height: 1 },
    inUse: true,
    bytes: new Uint8Array([1, 2, 3]),
  } as const;

  it("is the live view's first frame, taken while the person works, since nothing moves on screen", () => {
    expect(macViewShot([{ type: "tick", inUse: true }, frame])).toEqual({
      _tag: "frame",
      bytes: frame.bytes,
      mimeType: "image/jpeg",
    });
  });

  it.each(["no-app", "no-window", "no-capture"] as const)(
    "falls back to the screen's own screenshot when the view answers %s",
    (status) => {
      expect(macViewShot([{ type: "state", status, inUse: false }])).toEqual({
        _tag: "none",
        status,
      });
    },
  );

  it("keeps reading while the view has sent no frame yet", () => {
    expect(macViewShot([{ type: "tick", inUse: false }])).toBeUndefined();
  });

  it.each([
    ["/tmp/shot.png", "image/jpeg", "/tmp/shot.jpg"],
    ["/tmp/shot.png", "image/png", "/tmp/shot.png"],
    ["/tmp/shot.JPEG", "image/png", "/tmp/shot.png"],
    ["/tmp/shot", "image/jpeg", "/tmp/shot.jpg"],
  ])("saves %s as a %s picture at %s, named for what it holds", (out, mimeType, path) => {
    expect(macShotPath(out, mimeType)).toBe(path);
  });
});

describe("a click in the live view", () => {
  it.each([
    // A Retina capture is twice the window's size in points.
    [
      { x: 230, y: 408 },
      { x: 215, y: 254 },
    ],
    [
      { x: 0, y: 0 },
      { x: 100, y: 50 },
    ],
    [
      { x: 460, y: 816 },
      { x: 330, y: 458 },
    ],
  ])("at image pixel %j lands on the Mac's screen at %j", (pixel, point) => {
    expect(
      macScreenPoint(
        { x: 100, y: 50, width: 230, height: 408 },
        { width: 460, height: 816 },
        pixel,
      ),
    ).toEqual(point);
  });
});

describe("the Mate's own clicks", () => {
  // Steps run in one Mac home, as a session of commands would: each with the idle time ioreg reports.
  const session = (
    steps: ReadonlyArray<{ readonly idle: number; readonly drovePast?: number }>,
  ) => {
    const home = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "mac-own-"));
    try {
      const bin = NodePath.join(home, "bin");
      NodeFS.mkdirSync(bin);
      NodeFS.writeFileSync(
        NodePath.join(bin, "agent-device"),
        `#!/bin/sh\necho "$@" >> "${home}/drove"\n`,
        { mode: 0o755 },
      );
      return steps.map((step) => {
        NodeFS.writeFileSync(
          NodePath.join(bin, "ioreg"),
          `#!/bin/sh\necho '    |   "HIDIdleTime" = ${step.idle * 1_000_000_000}'\n`,
          { mode: 0o755 },
        );
        if (step.drovePast !== undefined) {
          NodeFS.writeFileSync(
            NodePath.join(home, "last-drive"),
            String(Math.floor(Date.now() / 1000) - step.drovePast),
          );
        }
        return NodeChildProcess.spawnSync(
          "/bin/sh",
          ["-c", macDeviceCommand({ ...record, root: home }, ["press", "12", "34"])],
          { encoding: "utf8", env: { PATH: `${bin}:/usr/bin:/bin` } },
        ).status;
      });
    } finally {
      NodeFS.rmSync(home, { recursive: true, force: true });
    }
  };

  it("never make the Mac look busy to the Mate's next click", () => {
    // The first click finds the Mac idle; the second sees only the input the first one made.
    expect(session([{ idle: 120 }, { idle: 1 }])).toEqual([0, 0]);
  });

  it("do not hide someone working on the Mac after the Mate's last click", () => {
    expect(session([{ idle: 3, drovePast: 30 }])).toEqual([75]);
  });
});
