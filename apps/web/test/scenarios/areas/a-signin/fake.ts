import * as Effect from "effect/Effect";
import type { WebSocket } from "ws";
import { expect } from "@effect/vitest";
import { deadline } from "../../harness/http.ts";
import type { ScenarioDrivers, ScenarioExtension } from "../../harness/scenario.ts";
import { sessionDatabase } from "../../fakes/a-signin/database.ts";

const controls = new WeakMap<ScenarioDrivers, () => ReturnType<typeof sessionDatabase>>();

export const installSignIn: ScenarioExtension = (drivers) => {
  let database: ReturnType<typeof sessionDatabase> | undefined;
  controls.set(drivers, () => (database ??= sessionDatabase(drivers.core.url, drivers.owner)));
};

export function signInFaults(drivers: ScenarioDrivers) {
  const installed = controls.get(drivers);
  if (!installed) throw new Error("Install sign-in before creating fixtures");
  return installed();
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
  fault: "outage" | "expiry" | "refusal",
) {
  const database = signInFaults(drivers);
  if (fault === "outage") {
    await database.unavailable();
    try {
      await coreRechecks(drivers);
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
  if (fault === "refusal") {
    for (const socket of sockets) socket.close(4403, "scenario source refusal");
    expect(await deadline(closed, "HQ refused-source close")).toContain(4403);
  } else {
    await database.expires();
    await coreRechecks(drivers);
    expect(await deadline(closed, "Core expired-session close")).toContain(4401);
  }
}

/**
 * The Core's next session and role recheck of every socket: the real Core's comes when its wait
 * clock passes the recheck period; the embedded Core's runs on its own short period.
 */
export const coreRechecks = (drivers: ScenarioDrivers) =>
  drivers.core.kind === "external"
    ? Effect.runPromise(drivers.core.clock.advance(drivers.core.periods.streamRecheck))
    : Promise.resolve();

/**
 * The Core's next recheck, kept by every one of the browser's sockets in `links`: both rechecks of
 * each socket (the session's, the roles') ran and the real Core waited out the next ones, and every
 * socket open before it is still open, none ended and reopened.
 */
export const everySocketRechecked = (
  drivers: ScenarioDrivers,
  links: ReadonlyMap<WebSocket, WebSocket>,
) => {
  const core = drivers.core;
  if (core.kind !== "external") return Promise.resolve();
  const open = [...links.keys()];
  if (open.length === 0) throw new Error("No socket of the browser reaches the Core");
  const rechecks = (waits: ReadonlyArray<number>) =>
    waits.filter((ms) => ms === core.periods.streamRecheck).length;
  const before = rechecks(core.clock.waits());
  return Effect.runPromise(
    core.clock
      .advance(core.periods.streamRecheck)
      .pipe(
        Effect.andThen(
          core.clock.until(
            (waits) => rechecks(waits) >= before + 2 * open.length,
            "every socket waiting out the Core's next recheck",
          ),
        ),
        Effect.andThen(
          Effect.sync(() =>
            expect(
              open.filter((socket) => !links.has(socket)).length,
              "A socket ended at the Core's recheck",
            ).toBe(0),
          ),
        ),
      ),
  );
};

export const handoverCount = (drivers: ScenarioDrivers) =>
  drivers.zerops.requests.get("GET /authorize-app") ?? 0;

/**
 * The organization's member list as the organization's stalls it: each read the person's browser makes is
 * answered `ms` late. HQ's own reads (its token, `hq`) are not slowed: only the client's path is.
 */
export function slowMemberList(drivers: ScenarioDrivers, ms: number) {
  drivers.zerops.handlers.push(async (request) => {
    const bearer = request.headers.authorization?.replace(/^Bearer /u, "");
    if (
      bearer !== "hq" &&
      /^\/api\/rest\/public\/client\/[^/]+\/user\/list$/u.test(request.url.pathname)
    )
      await new Promise((resolve) => setTimeout(resolve, ms));
    return undefined;
  });
}

/**
 * A sensitive Shared value in project `projectId`'s vault, as the platform lists it (redacted)
 * and reveals it: the reveal answers `value` to whoever the platform lets see it.
 */
export function sensitiveSharedValue(
  drivers: ScenarioDrivers,
  projectId: string,
  key: string,
  value: string,
) {
  const id = `vault-${key}`;
  const project = drivers.zerops.rows("project").find((row) => row.id === projectId);
  if (!project) throw new Error(`Create project ${projectId} first`);
  const at = "2026-10-07T12:00:00.000Z";
  drivers.zerops.put("project", {
    ...project,
    envList: [
      {
        id,
        clientId: project.clientId,
        projectId,
        key,
        content: "<redacted>",
        type: "USER",
        editable: true,
        sensitive: true,
        internal: false,
        created: at,
        lastUpdate: at,
      },
    ],
  });
  drivers.zerops.handlers.push((request) =>
    request.method === "GET" && request.url.pathname.endsWith(`/project-env/${id}/reveal`)
      ? { body: { content: value } }
      : undefined,
  );
}
