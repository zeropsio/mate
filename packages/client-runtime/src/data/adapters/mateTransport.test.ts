import { afterEach, expect, it, vi } from "vite-plus/test";

afterEach(() => {
  vi.unstubAllGlobals();
});

it("the browser transport uses the current fetch after it is loaded", async () => {
  vi.resetModules();
  const before = vi.fn().mockResolvedValue(new Response("before"));
  vi.stubGlobal("fetch", before);
  const { browserTransportFetch } = await import("./mateTransport.ts");

  const response = new Response("current");
  const current = vi.fn().mockResolvedValue(response);
  vi.stubGlobal("fetch", current);
  const init = { credentials: "include" as const };
  expect(await browserTransportFetch("https://mate.example.test/mate", init)).toBe(response);
  expect(current).toHaveBeenCalledWith("https://mate.example.test/mate", init);
  expect(before).not.toHaveBeenCalled();
});
