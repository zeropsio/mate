import { describe, expect, it } from "vite-plus/test";
import { serviceForPreview } from "./serviceBrowserPolicy";

const origin = "https://web-2ff4-3000.prg1.zerops.app";
const services = [
  {
    hostname: "web",
    group: "runtimes" as const,
    routes: [{ url: origin, host: "web-2ff4-3000.prg1.zerops.app", port: 3000 }],
  },
];

describe("serviceForPreview", () => {
  it.each([
    "/",
    "/weather?city=Prague#today",
    "/mate/shortlink/pulls/4",
    "/mate/",
    "/%6date/shortlink/pulls/4",
  ])("previews a known service path %s", (path) => {
    expect(serviceForPreview(origin + path, services)).toBe("web");
  });
  it.each([
    "https://gitea.example/pulls/4",
    "https://other.prg1.zerops.app/",
    "https://web-2ff4-3000.prg1.zerops.app.attacker.example/",
    "https://user:password@web-2ff4-3000.prg1.zerops.app/",
    "mailto:hello@example.com",
  ])("leaves %s external", (url) => {
    expect(serviceForPreview(url, services)).toBeNull();
  });
  it("does not guess before topology arrives or after a route disappears", () => {
    expect(serviceForPreview(origin, undefined)).toBeNull();
    expect(serviceForPreview(origin, [])).toBeNull();
  });
  it("uses domain association regardless of scheme, port or service category", () => {
    expect(serviceForPreview("http://web-2ff4-3000.prg1.zerops.app:444/mate/", services)).toBe(
      "web",
    );
  });
});
