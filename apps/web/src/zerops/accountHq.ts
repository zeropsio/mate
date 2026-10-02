/**
 * The organization's HQ, as this tab reaches it (ADR 0001, SPEC §3.3, §4).
 *
 * - **Which HQ:** the one its anchor names in the org's member list (`findOfficialHq`), read with
 *   the person's own token — never a project's name or tag, which anybody who can create a
 *   project could copy.
 * - **Through its door:** HQ's API answers a session HQ issued for a throwaway named for its
 *   project (`mate-door:<hqProjectId>:<nonce>`, deleted at once). One API per account, org and
 *   HQ, kept for the account's lifetime and in memory only, as the Mates' sessions are.
 * - **Whether it answers:** `/health`, read while a surface shows it. An HQ that stops answering
 *   is `unavailable` from the first read that failed, and says so with that time (SPEC §4).
 * - **Its birth's ports:** Core comes from this very build, same-origin under `hq-core/`
 *   (`apps/hq/scripts/pack-core.ts`).
 */
import {
  findOfficialHq,
  makeHqApi,
  ownersAndAdmins,
  readHqHealth,
  type HqApi,
  type HqBirthDeps,
  type HqCoreArtifact,
  type HqEndpoint,
  type HqHealth,
  type OfficialHq,
  type OpenHqSocket,
} from "@t3tools/client-runtime/zerops/hq";
import {
  connectThroughThrowaway,
  zeropsThrowawayPlatform,
} from "@t3tools/client-runtime/zerops/doorThrowaway";
import type { ZeropsApiClient, ZeropsOrganizationMember } from "@t3tools/client-runtime/zerops";
import type { MembersCellRequest } from "@t3tools/client-runtime/zerops/data";
import * as Effect from "effect/Effect";
import { useCallback, useContext, useEffect, useMemo } from "react";
import { create } from "zustand";

import { appBasePath } from "~/basePath";
import { randomUUID } from "~/lib/utils";

import { onAccountLifetimeClose } from "./accountLifetime";
import { useZeropsOrganizationMembersRead } from "./useZeropsMateOwners";
import { ZeropsDataContext } from "./zeropsDataContext";

/** The origins an HQ's API answers (`HQ_CLIENT_ORIGINS`): this one, and the hosted app. */
export const HOSTED_APP_ORIGIN = "https://mate.zerops.io";

export interface AccountHq {
  /** `ready` once the member list was read: only then is `none` an answer to act on. */
  readonly status: "idle" | "loading" | "ready" | "failed";
  readonly hq: OfficialHq;
  /** The org's owners and admins: who sets an HQ up, and whom everybody else asks. */
  readonly admins: ReadonlyArray<ZeropsOrganizationMember>;
  /** Reads the member list again — after a birth minted the anchor. */
  readonly reread: () => void;
}

/** The organization's HQ, as its member list names it. */
export function useAccountHq(clientId: string | undefined): AccountHq {
  const data = useContext(ZeropsDataContext);
  const { members, status } = useZeropsOrganizationMembersRead({
    clientId,
    enabled: clientId !== undefined,
  });
  const hq = useMemo(() => findOfficialHq(members), [members]);
  const admins = useMemo(() => ownersAndAdmins(members), [members]);
  const reread = useCallback(() => {
    if (data === null || clientId === undefined) return;
    const request: MembersCellRequest = {
      kind: "members",
      account: data.runtime.scope,
      organization: data.organizationRef(clientId),
    };
    Effect.runFork(data.runtime.cells.invalidate(request));
  }, [clientId, data]);
  return { status, hq, admins, reread };
}

const apis = new Map<string, HqApi>();
onAccountLifetimeClose(() => apis.clear());

/**
 * The organization's HQ, for a write in the product: the product opens only over an official HQ
 * (`hqGate.ts`), so this is that HQ; anywhere else it is a mistake, and throws.
 */
export function officialHq(accountHq: Pick<AccountHq, "hq">): HqEndpoint {
  if (accountHq.hq.kind !== "official") {
    throw new Error("This organization's HQ is not open here.");
  }
  return accountHq.hq;
}

/** HQ's structure socket, as this browser opens it. */
const openBrowserSocket: OpenHqSocket = (url, on) => {
  const socket = new WebSocket(url);
  socket.addEventListener("message", (event) => {
    if (typeof event.data === "string") on.message(event.data);
  });
  socket.addEventListener("close", (event) => on.close(event.code));
  return {
    // A pong to a socket already closing is lost with it.
    send: (data) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(data);
    },
    close: () => socket.close(),
  };
};

/** HQ's API for this account and org, entered through its door on the first call. */
export function accountHqApi(client: ZeropsApiClient, clientId: string, hq: HqEndpoint): HqApi {
  const key = `${client.accountEpoch}:${clientId}:${hq.projectId}:${hq.address}`;
  const held = apis.get(key);
  if (held !== undefined) return held;
  const platform = zeropsThrowawayPlatform(client, { asked: true });
  const api = makeHqApi({
    address: hq.address,
    fetch: (input, init) => fetch(input, init),
    throughDoor: (use) =>
      connectThroughThrowaway({
        platform,
        clientId,
        projectId: hq.projectId,
        nonce: randomUUID(),
        connect: use,
      }),
    openSocket: openBrowserSocket,
  });
  apis.set(key, api);
  return api;
}

/** Where an HQ stands, as this tab last read it. */
export type HqStanding =
  | { readonly kind: "unknown" }
  | { readonly kind: "healthy" }
  /** Not answering as the official HQ since `since` (wall ms): the last known state stays shown. */
  | { readonly kind: "unavailable"; readonly since: number };

/** The standing a health read leaves: an outage keeps the time it began. */
export function nextHqStanding(previous: HqStanding, health: HqHealth, nowMs: number): HqStanding {
  if (health.kind === "healthy") return { kind: "healthy" };
  return previous.kind === "unavailable" ? previous : { kind: "unavailable", since: nowMs };
}

/** How often a shown HQ's health is read. */
export const HQ_HEALTH_EVERY_MS = 30_000;

const useHqStandings = create<{ readonly byAddress: Readonly<Record<string, HqStanding>> }>(() => ({
  byAddress: {},
}));
onAccountLifetimeClose(() => useHqStandings.setState({ byAddress: {} }));

/** The HQ at `address`, read now and every {@link HQ_HEALTH_EVERY_MS} while shown. */
export function useHqStanding(address: string | undefined): HqStanding {
  const standing = useHqStandings((state) =>
    address === undefined ? undefined : state.byAddress[address],
  );
  useEffect(() => {
    if (address === undefined) return;
    const controller = new AbortController();
    const read = () =>
      void readHqHealth((input, init) => fetch(input, init), address, controller.signal).then(
        (health) => {
          if (controller.signal.aborted) return;
          useHqStandings.setState((state) => ({
            byAddress: {
              ...state.byAddress,
              [address]: nextHqStanding(
                state.byAddress[address] ?? { kind: "unknown" },
                health,
                Date.now(),
              ),
            },
          }));
        },
      );
    read();
    const timer = setInterval(read, HQ_HEALTH_EVERY_MS);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [address]);
  return standing ?? { kind: "unknown" };
}

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
 * Core as this build carries it under `base` (`apps/hq/scripts/pack-core.ts`): its archive, by a
 * name no server takes for an encoding, and the `zerops.yml` it deploys with.
 */
export async function readBundledCore(
  fetch: typeof globalThis.fetch,
  base: string,
): Promise<HqCoreArtifact> {
  const [archive, yaml] = await Promise.all([
    fetch(`${base}/core.tgz.bin`, { cache: "no-store" }),
    fetch(`${base}/zerops.yml`, { cache: "no-store" }),
  ]);
  if (!archive.ok || !yaml.ok) {
    throw new Error("This build of the app carries no HQ to deploy.");
  }
  return {
    archive: await asGzip(new Uint8Array(await archive.arrayBuffer())),
    zeropsYaml: await yaml.text(),
  };
}

/** What an HQ birth acts through, from this tab. */
export function hqBirthDeps(client: ZeropsApiClient): HqBirthDeps {
  return {
    platform: client,
    core: () => readBundledCore((input, init) => fetch(input, init), `${appBasePath()}/hq-core`),
    health: (address) => readHqHealth((input, init) => fetch(input, init), address),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => Date.now(),
    newBirthId: randomUUID,
  };
}

/** The birth's own inputs beside its record: the origins HQ answers, the API Core reads. */
export function hqBirthSite(client: ZeropsApiClient): {
  readonly origins: ReadonlyArray<string>;
  readonly zeropsApi: string;
} {
  return {
    origins: [window.location.origin, HOSTED_APP_ORIGIN],
    zeropsApi: `${client.baseUrl}/api/rest/public`,
  };
}
