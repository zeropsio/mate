import { expect, it } from "vite-plus/test";

import { serviceForPreview } from "./serviceBrowserPolicy.ts";

const origin = "https://web-2ff4-3000.prg1.zerops.app";
const services = [
  {
    hostname: "web",
    group: "runtimes" as const,
    routes: [{ url: origin, host: "web-2ff4-3000.prg1.zerops.app", port: 3000 }],
  },
];

// witness: packages/client-runtime/src/zerops/serviceBrowserPolicy.ts | service.routes.some((route) => new URL(route.url).hostname === url.hostname), → service.routes.some((route) => new URL(route.url).host === url.host),
it("ZV41: A link previews the service one of whose routes has its host, whatever its path, port or scheme", () => {
  for (const path of ["/", "/weather?city=Prague#today", "/mate/"]) {
    expect(serviceForPreview(origin + path, services)).toBe("web");
  }
  expect(serviceForPreview("http://web-2ff4-3000.prg1.zerops.app:444/mate/", services)).toBe("web");
});

// witness: packages/client-runtime/src/zerops/serviceBrowserPolicy.ts | if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) → if (url.protocol !== "http:" && url.protocol !== "https:")
it("ZV42: A link with credentials, outside HTTP or to a host no route has is never previewed, nor any link before the services are read", () => {
  for (const url of [
    "https://user:password@web-2ff4-3000.prg1.zerops.app/",
    "mailto:hello@example.com",
    "https://other.prg1.zerops.app/",
    "https://web-2ff4-3000.prg1.zerops.app.attacker.example/",
  ]) {
    expect(serviceForPreview(url, services)).toBeNull();
  }
  expect(serviceForPreview(origin, undefined)).toBeNull();
  expect(serviceForPreview(origin, [])).toBeNull();
});
