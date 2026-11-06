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

export async function endSessionCheck(drivers: ScenarioDrivers) {
  const database = signInFaults(drivers);
  await database.unavailable();
  try {
    await database.sawSessionRead();
  } finally {
    await database.returns();
  }
}

export const handoverCount = (drivers: ScenarioDrivers) =>
  drivers.zerops.requests.get("GET /authorize-app") ?? 0;

/** The browser's member-list reads stay unanswered until the case explicitly releases them. */
export function holdMemberList(drivers: ScenarioDrivers) {
  const held = Promise.withResolvers<void>();
  let released = false;
  drivers.zerops.handlers.push(async (request) => {
    if (/^\/api\/rest\/public\/client\/[^/]+\/user\/list$/u.test(request.url.pathname))
      await held.promise;
    return undefined;
  });
  return {
    get released() {
      return released;
    },
    release() {
      released = true;
      held.resolve();
    },
  };
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
