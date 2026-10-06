import type { ZeropsFake } from "../zerops.ts";

/** Real client activity identifies builds by stack.build and the named embedded appVersion. */
export function installBuildProtocol(zerops: ZeropsFake) {
  zerops.writes.autoComplete = false;
  zerops.handlers.push(async (request) => {
    const path = request.url.pathname.replace(/^\/api\/rest\/public/u, "");
    if (request.method !== "PUT" || !/^\/app-version\/[^/]+\/build-and-deploy$/u.test(path))
      return undefined;
    const credential = request.headers.authorization?.replace(/^Bearer /u, "") ?? "";
    const response = await zerops.writes.handle(request, path, credential);
    const versionId = path.split("/")[2]!;
    const version = zerops.rows("app-version").find((row) => row.id === versionId);
    const process = zerops
      .rows("process")
      .find((row) => (row.appVersion as { id?: string } | null)?.id === versionId);
    if (process && version)
      zerops.put(
        "process",
        { ...process, actionName: "stack.build", appVersion: { ...version } },
        "entity-first",
      );
    return response;
  });
}

/** A failed attempt leaves the previous active version in place; terminal pipeline facts agree. */
export function endBuild(zerops: ZeropsFake, processId: string, outcome: "FINISHED" | "FAILED") {
  const process = zerops.rows("process").find((row) => row.id === processId)!;
  const active = zerops.rows("app-version").filter((row) => row.status === "ACTIVE");
  zerops.writes.transition(
    processId,
    outcome,
    outcome === "FAILED" ? "Storefront build failed" : undefined,
  );
  if (outcome === "FAILED")
    for (const previous of active) {
      const held = zerops.world.appVersions.get(previous.id);
      if (held) held.status = "ACTIVE";
      zerops.put("app-version", previous, "entity-first");
    }
  const versionId = (process.appVersion as { id: string }).id;
  const version = zerops.rows("app-version").find((row) => row.id === versionId)!;
  const terminal = { ...version, activationDate: outcome === "FINISHED" ? process.started : null };
  zerops.put("app-version", terminal, "entity-first");
  zerops.put(
    "process",
    { ...zerops.rows("process").find((row) => row.id === processId)!, appVersion: terminal },
    "entity-first",
  );
}
