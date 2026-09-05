/**
 * A recipe derived from a live project's export — the interim source for
 * "Add stage" until zcp publishes real recipes into the store (`recipeStore.ts`,
 * hacks.md H-26).
 *
 * `GET /project/{id}/export` returns the platform's own import YAML for a
 * project (measured 2026-09-05). Three things stand between that and a recipe
 * this client may import into a sibling:
 *
 * - the `project:` block, which the import endpoint rejects outright;
 * - the `zcp` service, because a creation imports its own container and a
 *   second one would be a second agent in one environment;
 * - every `vault:` / `envSecrets:` block. The export redacts sensitive service
 *   values but it is not a scrubbed document — the project-level vault came
 *   back in clear — so nothing secret-shaped may travel, be shown or be stored.
 *
 * The export is lossy on purpose-built fields (`zeropsSetup`, `priority`,
 * `profile` did not survive a round trip), which is why this clones a
 * sibling's *shape* and does not replace a published recipe. It is line-based
 * like `recipeServicesYaml`: the export is machine-generated two-space YAML
 * with no comments, and re-emitting it through a serializer would buy nothing.
 *
 * @module recipeExport
 */

import { recipeServicesYaml } from "./recipeStore.ts";

export interface ExportedRecipe {
  /** Services-only import YAML, ready for `POST /project/{id}/service-stack/import`. */
  readonly servicesYaml: string;
  /** Hostnames of the services kept, in the export's order. */
  readonly services: ReadonlyArray<string>;
  /** Hostnames dropped because they are agent containers. */
  readonly droppedContainers: ReadonlyArray<string>;
  /** How many secret blocks were removed. Reported, never their contents. */
  readonly scrubbedBlocks: number;
}

const SERVICES_KEY = /^services:\s*$/u;
const ITEM_START = /^ {2}- /u;
const ITEM_TYPE = /^ {4}type:\s*(\S+)/u;
const ITEM_HOSTNAME = /^ {2}- hostname:\s*(\S+)|^ {4}hostname:\s*(\S+)/u;
const SECRET_BLOCK = /^(\s*)(vault|envSecrets):\s*$/u;
const CONTAINER_TYPE_PREFIX = "zcp@";

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

/**
 * The services a sibling could be given, from a project's export; `undefined`
 * when nothing importable is left — an environment that was only ever a
 * container has no application to clone.
 */
export function recipeFromProjectExport(exportYaml: string): ExportedRecipe | undefined {
  const lines = recipeServicesYaml(exportYaml).split("\n");
  const start = lines.findIndex((line) => SERVICES_KEY.test(line));
  if (start === -1) return undefined;

  // Everything under `services:` until the next top-level key.
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (line.trim().length > 0 && indentOf(line) === 0) {
      end = index;
      break;
    }
  }

  const items: Array<Array<string>> = [];
  for (let index = start + 1; index < end; index += 1) {
    const line = lines[index] ?? "";
    if (ITEM_START.test(line)) items.push([line]);
    else if (items.length > 0) items.at(-1)!.push(line);
  }

  const services: Array<string> = [];
  const droppedContainers: Array<string> = [];
  let scrubbedBlocks = 0;
  const kept: Array<string> = [];

  for (const item of items) {
    const hostname = hostnameOf(item);
    const type = item.map((line) => ITEM_TYPE.exec(line)?.[1]).find((value) => value !== undefined);
    if (type?.startsWith(CONTAINER_TYPE_PREFIX)) {
      if (hostname !== undefined) droppedContainers.push(hostname);
      continue;
    }
    const scrubbed = withoutSecretBlocks(item);
    scrubbedBlocks += scrubbed.removed;
    if (hostname !== undefined) services.push(hostname);
    kept.push(...scrubbed.lines);
  }

  if (services.length === 0) return undefined;

  return {
    servicesYaml: ["services:", ...kept].join("\n").replace(/\n+$/u, "").concat("\n"),
    services,
    droppedContainers,
    scrubbedBlocks,
  };
}

function hostnameOf(item: ReadonlyArray<string>): string | undefined {
  for (const line of item) {
    const match = ITEM_HOSTNAME.exec(line);
    if (match) return match[1] ?? match[2];
  }
  return undefined;
}

/** Drops each `vault:` / `envSecrets:` mapping and everything nested under it. */
function withoutSecretBlocks(item: ReadonlyArray<string>): {
  readonly lines: ReadonlyArray<string>;
  readonly removed: number;
} {
  const lines: Array<string> = [];
  let removed = 0;
  let skippingBelow: number | null = null;

  for (const line of item) {
    if (skippingBelow !== null) {
      const blank = line.trim().length === 0;
      if (blank || indentOf(line) > skippingBelow) continue;
      skippingBelow = null;
    }
    const secret = SECRET_BLOCK.exec(line);
    if (secret) {
      skippingBelow = secret[1]?.length ?? 0;
      removed += 1;
      continue;
    }
    lines.push(line);
  }

  return { lines, removed };
}
