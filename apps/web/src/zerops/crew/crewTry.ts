/**
 * *Try its work* — a crewmate's menu on the conversation's line, and *Try it*
 * on a finished crew task's result row: the writer's work tried before any of
 * it is in the Mate's code. A writer whose app runs on its own crew port
 * opens that app, run first while it is stopped; one whose app cannot run on
 * its own — no crew port, or no run command — has its copy shown on the
 * Mate's dev service (*Show on dev*, the request and the grant at once) and
 * opens the dev address once dev serves it. A reader and the lead have no
 * copy, and nothing to try.
 *
 * Every state is read off the crew snapshot (its hosts: the crew ports and
 * the Show-on-dev claim) and the project's routes, which hold the addresses
 * the engine does not know.
 *
 * Pure: no clock, no I/O.
 */
import type { CrewHost, Crewmate } from "@t3tools/contracts";

/** Where a crewmate's work stands for trying, and the address it opens at once it can. */
export type CrewTryState =
  /** Its own app runs; `null` while no route reaches its port. */
  | { readonly kind: "running"; readonly url: string | null }
  /** Its own app is stopped: a press runs it, then opens it. */
  | { readonly kind: "stopped" }
  /** Dev serves its copy; `null` while the dev service has no route of its own. */
  | { readonly kind: "shown"; readonly url: string | null }
  /** Its copy is on its way to dev: a press waits for it. */
  | { readonly kind: "showing" }
  /** Dev serves the Mate's tree: a press shows its copy there, then opens it. */
  | { readonly kind: "show" }
  /** Dev shows another crewmate's work, or is going back to the tree. */
  | { readonly kind: "taken" };

export interface CrewTry {
  /** Its own app (`own`), or the Mate's dev service (`dev`): what the menu's line says it opens. */
  readonly where: "own" | "dev";
  readonly state: CrewTryState;
}

/** The project's services as the topology reads them; `undefined` while it is unread. */
export type CrewTryServices =
  | ReadonlyArray<{
      readonly hostname: string;
      readonly routes: ReadonlyArray<{ readonly port: number; readonly url: string }>;
    }>
  | undefined;

export function crewTryOf(
  hosts: ReadonlyArray<CrewHost>,
  crewmate: Pick<Crewmate, "handle" | "lane" | "host" | "app">,
  services: CrewTryServices,
): CrewTry | null {
  if (crewmate.lane === null || crewmate.host === null) return null;
  const host = hosts.find((candidate) => candidate.host === crewmate.host);
  const routes = services?.find((service) => service.hostname === crewmate.host)?.routes ?? [];
  const app = crewmate.app;
  if (
    host !== undefined &&
    host.crewPorts.length > 0 &&
    app !== null &&
    app.port !== null &&
    app.state !== "none"
  ) {
    if (app.state === "stopped") return { where: "own", state: { kind: "stopped" } };
    const port = app.port;
    const url = app.url ?? routes.find((route) => route.port === port)?.url ?? null;
    return { where: "own", state: { kind: "running", url } };
  }
  if (host === undefined) return { where: "dev", state: { kind: "taken" } };
  const { state, handle } = host.claim;
  const own = handle === crewmate.handle;
  if (own && state === "held") {
    // The dev server's own address: the service's route that is no crew port.
    const crewPorts = new Set(host.crewPorts.map((entry) => entry.port));
    const url = routes.find((route) => !crewPorts.has(route.port))?.url ?? null;
    return { where: "dev", state: { kind: "shown", url } };
  }
  if (own && state === "starting") return { where: "dev", state: { kind: "showing" } };
  if (state === "none" || state === "requested") return { where: "dev", state: { kind: "show" } };
  return { where: "dev", state: { kind: "taken" } };
}

/**
 * What a press does: open the address, run the app or show the copy on dev
 * and open it once it can, or wait for a copy already on its way. `null`
 * where nothing can be opened: no address yet, another's work on dev, or —
 * showing on dev being a turn of the crewmate's own — its turn running.
 */
export type CrewTryPress =
  | { readonly kind: "open"; readonly url: string }
  | { readonly kind: "run" }
  | { readonly kind: "show" }
  | { readonly kind: "wait" };

export function crewTryPress(tries: CrewTry, working: boolean): CrewTryPress | null {
  const { state } = tries;
  switch (state.kind) {
    case "running":
    case "shown":
      return state.url === null ? null : { kind: "open", url: state.url };
    case "stopped":
      return { kind: "run" };
    case "showing":
      return { kind: "wait" };
    case "show":
      return working ? null : { kind: "show" };
    case "taken":
      return null;
  }
}

/** The address a press waiting on the work opens, once the work can be opened. */
export function crewTryOpens(tries: CrewTry): string | null {
  const { state } = tries;
  return state.kind === "running" || state.kind === "shown" ? state.url : null;
}

/** *Stop its app*: offered only while its own app runs. */
export function crewTryStops(tries: CrewTry): boolean {
  return tries.where === "own" && tries.state.kind === "running";
}
