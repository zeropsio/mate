import { inProcessCore } from "../../harness/hqCore.ts";
import type { WebSocket } from "ws";
import { expect } from "@effect/vitest";
import { deadline } from "../../harness/http.ts";
import type { ScenarioDrivers, ScenarioExtension } from "../../harness/scenario.ts";
import { sessionDatabase } from "../../fakes/a-signin/database.ts";

const controls = new WeakMap<ScenarioDrivers, () => ReturnType<typeof sessionDatabase>>();

export const installSignIn: ScenarioExtension = (drivers) => {
  let database: ReturnType<typeof sessionDatabase> | undefined;
  controls.set(
    drivers,
    () => (database ??= sessionDatabase(inProcessCore(drivers.core).url, drivers.owner)),
  );
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
    expect(await deadline(closed, "Core expired-session close")).toContain(4401);
  }
}

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
