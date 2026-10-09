import { useSyncExternalStore } from "react";
import { whenShown } from "./whenShown";
import type { HqCoreArtifact } from "@t3tools/client-runtime/zerops/hq";
import { appBasePath } from "~/basePath";

/**
 * Core's archive as gzip, whatever happened to it on the way: a static server may serve a gzip
 * file with `Content-Encoding: gzip`, and the browser then hands over what it unpacked (measured on
 * the rig, 2026-10-02: Core's build failed on the plain tar). An archive without gzip's magic
 * bytes is packed again here.
 */
async function asGzip(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) return bytes;
  const packed = new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(packed).arrayBuffer());
}

/**
 * Which Core this build carries under `base` (`hq-core/build.json`, `apps/hq/scripts/pack-core.ts`):
 * its identity, or `""` where it carries none — a dev server, a build that packed no Core.
 */
export async function readCarriedCoreBuild(
  fetch: typeof globalThis.fetch,
  base: string,
): Promise<string> {
  try {
    const response = await fetch(`${base}/build.json`, { cache: "no-store" });
    if (!response.ok) return "";
    const body = (await response.json()) as { readonly build?: unknown };
    return typeof body.build === "string" ? body.build : "";
  } catch {
    return "";
  }
}

/**
 * Core as this build carries it under `base` (`apps/hq/scripts/pack-core.ts`): its archive, by a
 * name no server takes for an encoding, the `zerops.yml` it deploys with, and its identity.
 */
export async function readBundledCore(
  fetch: typeof globalThis.fetch,
  base: string,
): Promise<HqCoreArtifact> {
  const [archive, yaml, build] = await Promise.all([
    fetch(`${base}/core.tgz.bin`, { cache: "no-store" }),
    fetch(`${base}/zerops.yml`, { cache: "no-store" }),
    readCarriedCoreBuild(fetch, base),
  ]);
  if (!archive.ok || !yaml.ok || build === "") {
    throw new Error("This build of the app carries no HQ to deploy.");
  }
  return {
    build,
    archive: await asGzip(new Uint8Array(await archive.arrayBuffer())),
    zeropsYaml: await yaml.text(),
  };
}

/** The Core this build carries, read from its own bundle: what a birth and HQ's update deploy. */
export const readCarriedCore = (): Promise<HqCoreArtifact> =>
  readBundledCore((input, init) => fetch(input, init), `${appBasePath()}/hq-core`);
/**
 * This tab's one read of the Core it carries — its build does not change under it — made for the
 * first reader in a shown tab, never in a hidden one.
 */
const carried: {
  build: string | undefined;
  /** Waiting for a shown tab, or sent. */
  asked: boolean;
  sent: boolean;
  readonly listeners: Set<() => void>;
  unwait: () => void;
} = { build: undefined, asked: false, sent: false, listeners: new Set(), unwait: () => undefined };

function subscribeCarried(listener: () => void): () => void {
  carried.listeners.add(listener);
  if (!carried.asked) {
    carried.asked = true;
    carried.unwait = whenShown(() => {
      carried.sent = true;
      void readCarriedCoreBuild(
        (input, init) => fetch(input, init),
        `${appBasePath()}/hq-core`,
      ).then((build) => {
        carried.build = build;
        for (const heard of carried.listeners) heard();
      });
    });
  }
  return () => {
    carried.listeners.delete(listener);
    if (carried.listeners.size > 0 || carried.sent) return;
    // Let go of before it went out: the next reader asks again.
    carried.unwait();
    carried.asked = false;
  };
}

const carriedBuild = () => carried.build;

/** The Core this build carries (`readCarriedCoreBuild`); `undefined` until read. */
export function useCarriedCoreBuild(): string | undefined {
  return useSyncExternalStore(subscribeCarried, carriedBuild, carriedBuild);
}
