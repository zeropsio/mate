/**
 * CrewDefinition — a writer's lane: where its copy of the code lives. The crew
 * home's file format, parser and validation live in `@t3tools/shared/crewHome`.
 *
 * ## A writer's copy of the code
 *
 * A writer's lane is branch `crew/<handle>` checked out in `.crew/<handle>`
 * inside its service's tree (PRD Δ11): `<remotePath>/.crew/<handle>` on the
 * service, `<mountPath>/.crew/<handle>` through the zcp container's mount.
 * `crewLane` derives both from the service's `ZeropsRepository`, never from a
 * literal `/var/www`.
 *
 * @module CrewDefinition
 */
import type { ZeropsRepository } from "../ZeropsRepositorySource.ts";

/** A writer's copy of the code, in both of the paths that reach it. */
export interface CrewLane {
  readonly host: string;
  readonly handle: string;
  readonly branch: string;
  /** The service's tree through the zcp container's mount (`/var/www/<host>`). */
  readonly mountRoot: string;
  readonly mountDir: string;
  /** The service's tree on the service itself (`/var/www`). */
  readonly remoteRoot: string;
  readonly remoteDir: string;
}

export const crewLane = (
  repository: Pick<ZeropsRepository, "host" | "mountPath" | "remotePath">,
  handle: string,
): CrewLane => ({
  host: repository.host,
  handle,
  branch: `crew/${handle}`,
  mountRoot: repository.mountPath,
  mountDir: `${repository.mountPath}/.crew/${handle}`,
  remoteRoot: repository.remotePath,
  remoteDir: `${repository.remotePath}/.crew/${handle}`,
});
