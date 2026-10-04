/**
 * crewDeployState — whether a self-deploy onto a crew host may still run, read
 * from the project's processes on the platform (`ZeropsRestartRead`). A
 * restart cuts off the turn that watched the deploy; the host's copies stay
 * frozen until the platform says its deploy ended.
 *
 * @module crewDeployState
 */

/** `running`: a process on the service has not ended; `unknown`: the platform could not say. */
export type DeployState = "running" | "settled" | "unknown";

const ENDED = new Set(["FINISHED", "FAILED", "CANCELED", "CANCELLED"]);

const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

/** Whether one of `processes` touches the service (by id, else by name) and has not ended. */
export const deployStateOf = (
  processes: ReadonlyArray<unknown>,
  service: { readonly host: string; readonly serviceId: string | undefined },
): DeployState => {
  const touches = (process: Record<string, unknown>) => {
    const named = (value: unknown) => {
      const entry = record(value);
      return (
        (service.serviceId !== undefined && entry?.["id"] === service.serviceId) ||
        entry?.["name"] === service.host
      );
    };
    const services = process["serviceStacks"];
    return (
      (service.serviceId !== undefined && process["serviceStackId"] === service.serviceId) ||
      process["serviceStackName"] === service.host ||
      (Array.isArray(services) && services.some(named))
    );
  };
  for (const value of processes) {
    const process = record(value);
    if (process === undefined || !touches(process)) continue;
    const status = process["status"];
    if (typeof status !== "string") return "unknown";
    if (!ENDED.has(status)) return "running";
  }
  return "settled";
};
