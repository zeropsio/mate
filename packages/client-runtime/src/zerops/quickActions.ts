/**
 * The quick actions the current project state makes sensible, and the message
 * each one puts in the composer.
 *
 * These are PROMPTS, never calls. Every change to a Zerops project goes through
 * the agent's MCP tools, so a quick action's whole job is to save the user
 * typing a sentence — it prefills the composer and stops there. Nothing here
 * reaches the Zerops API, and `ZeropsQuickActions.test.tsx` pins that the
 * component cannot.
 */
import type { ZeropsTopologyService, ZeropsTopologyView } from "./topology.ts";

export interface ZeropsQuickAction {
  readonly id: string;
  readonly label: string;
  readonly prompt: string;
}

/** Types that already provide a cache, so "Add Redis" would be noise. */
const CACHE_TYPE = /^(valkey|redis|keydb)[:@]/u;

/** The service a quick action should talk about: the project's first runtime. */
function primaryRuntime(
  services: ReadonlyArray<ZeropsTopologyService>,
): ZeropsTopologyService | undefined {
  return services.find((service) => service.group === "runtimes");
}

export function zeropsQuickActions(
  topology: ZeropsTopologyView | undefined,
): ReadonlyArray<ZeropsQuickAction> {
  if (topology === undefined) {
    return [];
  }

  const services = topology.services.filter((service) => service.group !== "infrastructure");
  if (services.length === 0) {
    // Nothing exists yet, so the only useful prompt is the one that starts it.
    return [
      {
        id: "bootstrap",
        label: "Build something",
        prompt: "Set up the infrastructure for a new app in this project.",
      },
    ];
  }

  const runtime = primaryRuntime(topology.services);
  const actions: ZeropsQuickAction[] = [];

  if (runtime !== undefined) {
    actions.push({
      id: "deploy",
      label: "Deploy",
      prompt: `Deploy ${runtime.hostname}.`,
    });
  }

  actions.push({
    id: "logs",
    label: "Show logs",
    prompt: `Show me the recent logs for ${runtime?.hostname ?? services[0]!.hostname}.`,
  });

  if (!services.some((service) => CACHE_TYPE.test(service.type))) {
    actions.push({
      id: "add-redis",
      label: "Add Redis",
      prompt: "Add a Valkey (Redis-compatible) service to this project and wire it up.",
    });
  }

  return actions;
}
