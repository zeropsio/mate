import { describe, expect, it } from "vite-plus/test";

import { appShellWorkerMode, type AppShellWorkerSite } from "./appShellClient";

const hosted: AppShellWorkerSite = {
  mode: "app-shell",
  production: true,
  hosted: true,
  basePath: "",
  electron: false,
  serviceWorkers: true,
};

describe("where the app-shell worker runs", () => {
  it.each([
    { title: "the hosted client at its origin root registers it", site: hosted, mode: "app-shell" },
    {
      title: "a build that does not ask for it never registers it",
      site: { ...hosted, mode: undefined },
      mode: "none",
    },
    {
      title: "Vite's dev server never registers it",
      site: { ...hosted, production: false },
      mode: "none",
    },
    {
      title: "a Mate's container serving the client under /mate/ never registers it",
      site: { ...hosted, basePath: "/mate" },
      mode: "none",
    },
    {
      title: "a build pinned to a backend never registers it",
      site: { ...hosted, hosted: false },
      mode: "none",
    },
    {
      title: "the desktop app never registers it",
      site: { ...hosted, electron: true },
      mode: "none",
    },
    {
      title: "a browser without service workers is left alone",
      site: { ...hosted, serviceWorkers: false },
      mode: "none",
    },
    {
      title: "a retiring build unregisters it wherever it runs",
      site: { ...hosted, mode: "retire", electron: true },
      mode: "retire",
    },
  ] as const)("$title", ({ site, mode }) => {
    expect(appShellWorkerMode(site)).toBe(mode);
  });
});
