/**
 * crewPorts — a dev service's crew ports (PRD §5.7): which ports its
 * `zerops.yaml` declares for crewmates' apps, which crewmate takes which, and
 * which ports *Add crew ports* asks Fen to declare.
 *
 * A service's ports come only from `run.ports` of its setup in `zerops.yaml`
 * plus a deploy, so the engine reads them and never writes them. The setup is
 * the one named after the service (`setup: appdev`), else `dev`, else the only
 * one. Its first port is the service's own dev server; every other
 * `httpSupport: true` port from 3001 up is a crew port.
 *
 * Whether the subdomain routes a port (`httpRouting`) is the platform's to
 * say, not the file's: a port read here is declared, not yet known routed.
 *
 * @module crewPorts
 */
import { parse as parseYaml } from "yaml";

/** The lowest crew port (PRD §5.7: 3001–3004 by default). */
export const CREW_PORT_FLOOR = 3001;

export interface DeclaredPorts {
  /** The service's own dev server port, the setup's first. */
  readonly main: number | null;
  readonly crew: ReadonlyArray<number>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const setupFor = (
  setups: ReadonlyArray<Record<string, unknown>>,
  host: string,
): Record<string, unknown> | undefined =>
  setups.find((setup) => setup.setup === host) ??
  setups.find((setup) => setup.setup === "dev") ??
  (setups.length === 1 ? setups[0] : undefined);

/** The crew ports `zerops.yaml` declares for `host`, or undefined when it has no setup for it. */
export const readDeclaredPorts = (text: string, host: string): DeclaredPorts | undefined => {
  let doc: unknown;
  try {
    doc = parseYaml(text);
  } catch {
    return undefined;
  }
  if (!isRecord(doc) || !Array.isArray(doc.zerops)) return undefined;
  const setup = setupFor(doc.zerops.filter(isRecord), host);
  if (setup === undefined) return undefined;
  const run = isRecord(setup.run) ? setup.run : {};
  const ports = (Array.isArray(run.ports) ? run.ports : [])
    .filter(isRecord)
    .filter((entry): entry is { port: number; httpSupport?: unknown } =>
      Number.isInteger(entry.port),
    );
  const main = ports[0]?.port ?? null;
  return {
    main,
    crew: ports
      .filter(
        (entry) =>
          entry.httpSupport === true && entry.port >= CREW_PORT_FLOOR && entry.port !== main,
      )
      .map((entry) => entry.port),
  };
};

/**
 * A crew port for each crewmate on one service, in the order given: a
 * crewmate keeps a port it has that is still declared; the rest take the free
 * ones, lowest first; a crewmate left over has none ("No free crew port").
 */
export const assignCrewPorts = (
  ports: ReadonlyArray<number>,
  members: ReadonlyArray<{ readonly handle: string; readonly crewPort: number | null }>,
): ReadonlyMap<string, number | null> => {
  const kept = new Map<string, number>();
  for (const member of members) {
    if (member.crewPort !== null && ports.includes(member.crewPort)) {
      kept.set(member.handle, member.crewPort);
    }
  }
  const taken = new Set(kept.values());
  const free = ports.filter((port) => !taken.has(port)).toSorted((a, b) => a - b);
  return new Map(
    members.map((member) => [member.handle, kept.get(member.handle) ?? free.shift() ?? null]),
  );
};

/** The next `count` ports from 3001 that the service declares for nothing. */
export const proposeCrewPorts = (
  declared: DeclaredPorts | undefined,
  count: number,
): ReadonlyArray<number> => {
  const used = new Set<number | null>([...(declared?.crew ?? []), declared?.main ?? null]);
  const ports: Array<number> = [];
  for (let port = CREW_PORT_FLOOR; ports.length < count; port += 1) {
    if (!used.has(port)) ports.push(port);
  }
  return ports;
};
