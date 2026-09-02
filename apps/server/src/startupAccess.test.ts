import { assert, expect, it } from "@effect/vitest";

import {
  buildPairingUrl,
  formatHeadlessServeOutput,
  formatZeropsServeOutput,
  renderTerminalQrCode,
  resolveHeadlessConnectionHost,
  resolveHeadlessConnectionString,
  resolveListeningPort,
  resolveStartupAccessMode,
} from "./startupAccess.ts";
import { resolveZeropsEnvironment } from "./zerops/ZeropsEnvironment.ts";

const zeropsTestEnvironment = resolveZeropsEnvironment({
  projectId: "nTV3oMB2SS634ImDJnQckg",
  apiHost: undefined,
  allowedOrigins: [],
  membershipTtlSeconds: undefined,
});

it("prefers localhost when no explicit host is configured", () => {
  expect(resolveHeadlessConnectionHost(undefined)).toBe("localhost");
  expect(resolveHeadlessConnectionString(undefined, 3773)).toBe("http://localhost:3773");
});

it("keeps explicit bind hosts in the connection string", () => {
  expect(resolveHeadlessConnectionString("127.0.0.1", 3773)).toBe("http://127.0.0.1:3773");
  expect(resolveHeadlessConnectionString("::1", 3773)).toBe("http://[::1]:3773");
});

it("resolves wildcard hosts to a concrete external interface when one is available", () => {
  const connectionString = resolveHeadlessConnectionString("0.0.0.0", 3773, {
    en0: [
      {
        address: "192.168.1.42",
        netmask: "255.255.255.0",
        family: "IPv4",
        mac: "00:00:00:00:00:00",
        internal: false,
        cidr: "192.168.1.42/24",
      },
    ],
    lo0: [
      {
        address: "127.0.0.1",
        netmask: "255.0.0.0",
        family: "IPv4",
        mac: "00:00:00:00:00:00",
        internal: true,
        cidr: "127.0.0.1/8",
      },
    ],
  });

  expect(connectionString).toBe("http://192.168.1.42:3773");
});

it("prefers the actual bound port when an http server address is available", () => {
  expect(resolveListeningPort({ port: 4123 }, 3773)).toBe(4123);
  expect(resolveListeningPort("pipe", 3773)).toBe(3773);
  expect(resolveListeningPort(null, 3773)).toBe(3773);
});

it("builds a pairing URL that embeds the token in the hash", () => {
  expect(buildPairingUrl("http://192.168.1.42:3773", "PAIRCODE")).toBe(
    "http://192.168.1.42:3773/pair#token=PAIRCODE",
  );
});

// A container reached through a reverse proxy publishes the server under a path
// prefix; the pair route hangs off it, not off the origin root that the prefix
// shares with something else.
it("builds a pairing URL below the prefix the connection string carries", () => {
  expect(buildPairingUrl("https://container.example.test/mate", "PAIRCODE")).toBe(
    "https://container.example.test/mate/pair#token=PAIRCODE",
  );
  expect(buildPairingUrl("https://container.example.test/mate/", "PAIRCODE")).toBe(
    "https://container.example.test/mate/pair#token=PAIRCODE",
  );
});

it("renders terminal QR codes as a multi-line unicode block grid", () => {
  const qrCode = renderTerminalQrCode("http://192.168.1.42:3773/pair#token=PAIRCODE");

  assert.isTrue(qrCode.includes("█"));
  assert.isTrue(qrCode.split("\n").length > 10);
});

it("formats headless serve output with the connection string, token, pairing url, and qr code", () => {
  const output = formatHeadlessServeOutput({
    connectionString: "http://192.168.1.42:3773",
    token: "PAIRCODE",
    pairingUrl: "http://192.168.1.42:3773/pair#token=PAIRCODE",
  });

  expect(output).toContain("Connection string: http://192.168.1.42:3773");
  expect(output).toContain("Token: PAIRCODE");
  expect(output).toContain("Pairing URL: http://192.168.1.42:3773/pair#token=PAIRCODE");
  assert.isTrue(output.includes("█") || output.includes("▀") || output.includes("▄"));
});

it("chooses the Zerops announcement over either minting path", () => {
  // Both upstream boot paths mint an administrative-bootstrap credential -
  // headless prints it, browser turns it into a /pair link. Inside a Zerops
  // project neither runs, so nothing an operator can read from the unit's
  // output is a credential.
  for (const startupPresentation of ["headless", "browser"] as const) {
    assert.strictEqual(
      resolveStartupAccessMode({ zerops: zeropsTestEnvironment, startupPresentation }),
      "zerops",
    );
  }
});

it("leaves both minting paths alone outside a Zerops project", () => {
  assert.strictEqual(
    resolveStartupAccessMode({ zerops: undefined, startupPresentation: "headless" }),
    "headless",
  );
  assert.strictEqual(
    resolveStartupAccessMode({ zerops: undefined, startupPresentation: "browser" }),
    "browser",
  );
});

it("announces the Zerops door without minting anything to announce", () => {
  const output = formatZeropsServeOutput("http://127.0.0.1:3773");

  expect(output).toContain("http://127.0.0.1:3773");
  // The three things upstream prints, none of which may appear here.
  expect(output).not.toContain("Token:");
  expect(output).not.toContain("/pair");
  expect(output).not.toContain("#token=");
  // And no QR code, which is only ever a rendering of a credential.
  assert.isFalse(output.includes("\u2588"));
});
