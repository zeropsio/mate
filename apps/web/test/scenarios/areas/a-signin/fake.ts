import type { WebSocket } from "ws";
import { expect } from "@effect/vitest";
import { deadline } from "../../harness/http.ts";
import type { ScenarioDrivers, ScenarioExtension } from "../../harness/scenario.ts";
import { sessionDatabase } from "../../fakes/a-signin/database.ts";

const controls = new WeakMap<ScenarioDrivers, ReturnType<typeof sessionDatabase>>();

export const installSignIn: ScenarioExtension = (drivers) => {
  controls.set(drivers, sessionDatabase(drivers.core.url, drivers.owner));
};

export function signInFaults(drivers: ScenarioDrivers) {
  const installed = controls.get(drivers);
  if (!installed) throw new Error("Install sign-in before creating fixtures");
  return installed;
}

export function secondOrganization(drivers: ScenarioDrivers) {
  drivers.zerops.world.organizations.set("OTHER", {
    name: "Second",
    settings: { locationList: [] },
  });
}

export async function endSessionCheck(
  drivers: ScenarioDrivers,
  sockets: WebSocket[],
  fault: "outage" | "expiry",
) {
  const database = signInFaults(drivers);
  if (fault === "outage") {
    await database.unavailable();
    try {
      await database.sawSessionRead();
    } finally {
      await database.returns();
    }
    return;
  }
  expect(sockets.length, "A live real-Core structure stream is required").toBeGreaterThan(0);
  const closed = Promise.all(
    sockets.map(
      (socket) => new Promise<number>((resolve) => socket.once("close", (code) => resolve(code))),
    ),
  );
  await database.expires();
  expect(await deadline(closed, "Core expired-session close")).toContain(4401);
}

export const handoverCount = (drivers: ScenarioDrivers) =>
  drivers.zerops.requests.get("GET /authorize-app") ?? 0;

/** Hold the browser's member-list replies; Core's own token reads remain live. */
export function holdMemberList(drivers: ScenarioDrivers) {
  const pending = new Set<() => void>();
  const release = () => {
    for (const resolve of pending) resolve();
    pending.clear();
  };
  drivers.cleanup.push(async () => release());
  drivers.zerops.handlers.push(async (request) => {
    const bearer = request.headers.authorization?.replace(/^Bearer /u, "");
    if (
      bearer !== "hq" &&
      /^\/api\/rest\/public\/client\/[^/]+\/user\/list$/u.test(request.url.pathname)
    )
      await new Promise<void>((resolve) => pending.add(resolve));
    return undefined;
  });
  return { release, pending: () => pending.size };
}
