import { describe, expect, it } from "@effect/vitest";
import { defaultImportHost } from "./source.ts";

describe("default import host policy", () => {
  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "::",
    "::1",
    "fe80::1",
    "fd00::1",
    "::ffff:127.0.0.1",
    "::ffff:10.0.0.1",
    "64:ff9b::a00:1",
    "localhost",
    "api.localhost",
    "db",
    "zcp.",
    "app.zerops",
    "zcp.rm1136a3.zerops-project",
    "svc.internal",
    "printer.local",
  ])("refuses %s", (host) => {
    expect(defaultImportHost(host)).toBe(false);
  });

  it.each(["github.com", "gitlab.example.com", "140.82.112.3", "2606:4700::1111"])(
    "allows %s",
    (host) => {
      expect(defaultImportHost(host)).toBe(true);
    },
  );
});
