import type { CrewHost, Crewmate } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { crewTryOf, crewTryOpens, crewTryPress, crewTryStops, type CrewTry } from "./crewTry";

/** A writer on `appdev`, its app on crew port 3001 — or whatever a case gives it. */
function writer(fields: Partial<Pick<Crewmate, "handle" | "lane" | "host" | "app">> = {}) {
  return {
    handle: "world",
    host: "appdev",
    lane: {
      branch: "crew/world",
      ahead: 2,
      insertions: 40,
      deletions: 3,
      dirty: false,
      check: null,
      state: "ready",
      detail: null,
    },
    app: { state: "stopped", port: 3001, url: null },
    ...fields,
  } satisfies Pick<Crewmate, "handle" | "lane" | "host" | "app">;
}

function host(fields: Partial<CrewHost> = {}): CrewHost {
  return {
    host: "appdev",
    integration: null,
    crewPorts: [
      { port: 3001, routed: true },
      { port: 3002, routed: true },
    ],
    served: { by: "tree" },
    claim: { state: "none", handle: null, grantWaiting: false },
    ...fields,
  };
}

/** The project's routes: the dev server's own port, then the crew ports. */
const SERVICES = [
  {
    hostname: "appdev",
    routes: [
      { port: 3000, url: "https://appdev-3000.example.test" },
      { port: 3001, url: "https://appdev-3001.example.test" },
      { port: 3002, url: "https://appdev-3002.example.test" },
    ],
  },
];

const NO_CREW_PORTS = host({ crewPorts: [] });

describe("crewTryOf", () => {
  it.each<{
    readonly name: string;
    readonly crewmate: ReturnType<typeof writer>;
    readonly hosts: ReadonlyArray<CrewHost>;
    readonly services?: typeof SERVICES;
    readonly tries: CrewTry | null;
  }>([
    {
      name: "a reader or the lead: no copy to try",
      crewmate: writer({ lane: null, host: null, app: null }),
      hosts: [host()],
      tries: null,
    },
    {
      name: "its app running on its crew port: that port's address",
      crewmate: writer({ app: { state: "running", port: 3001, url: null } }),
      hosts: [host()],
      tries: { where: "own", state: { kind: "running", url: "https://appdev-3001.example.test" } },
    },
    {
      name: "its app running at an address the engine gives: that one",
      crewmate: writer({
        app: { state: "running", port: 3001, url: "https://world-app.example.test" },
      }),
      hosts: [host()],
      tries: { where: "own", state: { kind: "running", url: "https://world-app.example.test" } },
    },
    {
      name: "its app running on a port no route reaches yet: no address",
      crewmate: writer({ app: { state: "running", port: 3001, url: null } }),
      hosts: [host()],
      services: [],
      tries: { where: "own", state: { kind: "running", url: null } },
    },
    {
      name: "its app stopped: run first",
      crewmate: writer(),
      hosts: [host()],
      tries: { where: "own", state: { kind: "stopped" } },
    },
    {
      name: "no crew ports on its service: shown on the Mate's dev service",
      crewmate: writer({ app: { state: "stopped", port: null, url: null } }),
      hosts: [NO_CREW_PORTS],
      tries: { where: "dev", state: { kind: "show" } },
    },
    {
      name: "more crewmates than crew ports: shown on dev",
      crewmate: writer({ app: { state: "stopped", port: null, url: null } }),
      hosts: [host()],
      tries: { where: "dev", state: { kind: "show" } },
    },
    {
      name: "no run command: shown on dev",
      crewmate: writer({ app: { state: "none", port: 3001, url: null } }),
      hosts: [host()],
      tries: { where: "dev", state: { kind: "show" } },
    },
    {
      name: "asked to be shown by the crewmate itself: shown on dev",
      crewmate: writer({ app: { state: "none", port: null, url: null } }),
      hosts: [host({ claim: { state: "requested", handle: "world", grantWaiting: false } })],
      tries: { where: "dev", state: { kind: "show" } },
    },
    {
      name: "on its way to dev: wait for it",
      crewmate: writer({ app: { state: "none", port: null, url: null } }),
      hosts: [host({ claim: { state: "starting", handle: "world", grantWaiting: false } })],
      tries: { where: "dev", state: { kind: "showing" } },
    },
    {
      name: "shown on dev: the dev server's own address, not a crew port's",
      crewmate: writer({ app: { state: "none", port: null, url: null } }),
      hosts: [host({ claim: { state: "held", handle: "world", grantWaiting: false } })],
      tries: { where: "dev", state: { kind: "shown", url: "https://appdev-3000.example.test" } },
    },
    {
      name: "another crewmate's work on dev: nothing to press",
      crewmate: writer({ app: { state: "none", port: null, url: null } }),
      hosts: [host({ claim: { state: "held", handle: "rules", grantWaiting: false } })],
      tries: { where: "dev", state: { kind: "taken" } },
    },
    {
      name: "dev going back to the Mate's tree: nothing to press",
      crewmate: writer({ app: { state: "none", port: null, url: null } }),
      hosts: [host({ claim: { state: "releasing", handle: "world", grantWaiting: false } })],
      tries: { where: "dev", state: { kind: "taken" } },
    },
    {
      name: "a service the crew does not list: nothing to press",
      crewmate: writer({ app: { state: "none", port: null, url: null } }),
      hosts: [],
      tries: { where: "dev", state: { kind: "taken" } },
    },
  ])("$name", ({ crewmate, hosts, services, tries }) => {
    expect(crewTryOf(hosts, crewmate, services ?? SERVICES)).toEqual(tries);
  });
});

describe("crewTryPress", () => {
  it.each<{
    readonly name: string;
    readonly tries: CrewTry;
    readonly working?: boolean;
    readonly press: ReturnType<typeof crewTryPress>;
  }>([
    {
      name: "a running app opens",
      tries: { where: "own", state: { kind: "running", url: "https://appdev-3001.example.test" } },
      press: { kind: "open", url: "https://appdev-3001.example.test" },
    },
    {
      name: "a running app with no address has nothing to open",
      tries: { where: "own", state: { kind: "running", url: null } },
      press: null,
    },
    {
      name: "a stopped app runs, then opens",
      tries: { where: "own", state: { kind: "stopped" } },
      press: { kind: "run" },
    },
    {
      name: "a stopped app runs while the crewmate works too",
      tries: { where: "own", state: { kind: "stopped" } },
      working: true,
      press: { kind: "run" },
    },
    {
      name: "work shown on dev opens there",
      tries: { where: "dev", state: { kind: "shown", url: "https://appdev-3000.example.test" } },
      press: { kind: "open", url: "https://appdev-3000.example.test" },
    },
    {
      name: "work on its way to dev waits, then opens",
      tries: { where: "dev", state: { kind: "showing" } },
      press: { kind: "wait" },
    },
    {
      name: "work not on dev is shown there between its turns",
      tries: { where: "dev", state: { kind: "show" } },
      press: { kind: "show" },
    },
    {
      name: "never while its turn runs",
      tries: { where: "dev", state: { kind: "show" } },
      working: true,
      press: null,
    },
    {
      name: "never over another's work",
      tries: { where: "dev", state: { kind: "taken" } },
      press: null,
    },
  ])("$name", ({ tries, working, press }) => {
    expect(crewTryPress(tries, working ?? false)).toEqual(press);
  });
});

describe("crewTryOpens and crewTryStops", () => {
  it.each<{ readonly tries: CrewTry; readonly opens: string | null; readonly stops: boolean }>([
    {
      tries: { where: "own", state: { kind: "running", url: "https://appdev-3001.example.test" } },
      opens: "https://appdev-3001.example.test",
      stops: true,
    },
    { tries: { where: "own", state: { kind: "running", url: null } }, opens: null, stops: true },
    { tries: { where: "own", state: { kind: "stopped" } }, opens: null, stops: false },
    {
      tries: { where: "dev", state: { kind: "shown", url: "https://appdev-3000.example.test" } },
      opens: "https://appdev-3000.example.test",
      stops: false,
    },
    { tries: { where: "dev", state: { kind: "showing" } }, opens: null, stops: false },
    { tries: { where: "dev", state: { kind: "show" } }, opens: null, stops: false },
  ])("opens $opens once ready, and stops only its own running app", ({ tries, opens, stops }) => {
    expect(crewTryOpens(tries)).toBe(opens);
    expect(crewTryStops(tries)).toBe(stops);
  });
});
