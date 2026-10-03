/**
 * The organization's HQ, as this tab reaches it (ADR 0001, SPEC §3.3, §4).
 *
 * - **Which HQ:** the one its anchor names in the org's member list (`findOfficialHq`), read with
 *   the person's own token — never a project's name or tag, which anybody who can create a
 *   project could copy. The verdict — that HQ, or that there is none — is kept in this browser
 *   (`hqVerdict.ts`), and a load that keeps one reads no member list.
 * - **Through its door:** HQ's API answers a session HQ issued for a throwaway named for its
 *   project (`mate-door:<hqProjectId>:<nonce>`, deleted at once). One API per account, org and
 *   HQ for the account's lifetime; its session is kept across loads as the Mates' are
 *   (`keptSessions.ts`, audit K7), so a load with a live one passes no door.
 * - **Whether it answers:** `/health`, read while a surface shows it. An HQ that stops answering
 *   is `unavailable` from the first read that failed, and says so with that time (SPEC §4).
 * - **Its birth's ports:** Core comes from this very build, same-origin under `hq-core/`
 *   (`apps/hq/scripts/pack-core.ts`).
 */
import {
  findOfficialHq,
  HqError,
  HQ_NOT_OPEN,
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
import { useAtomValue } from "@effect/atom-react";
import * as Effect from "effect/Effect";
import { useCallback, useContext, useEffect, useMemo } from "react";
import { create } from "zustand";

import { appBasePath } from "~/basePath";
import { randomUUID } from "~/lib/utils";
import { hqStructureAtom } from "~/state/zerops";

import { onAccountLifetimeClose } from "./accountLifetime";
import {
  forgetHqVerdict,
  forgetNoHqVerdict,
  keepHqVerdict,
  keepNoHqVerdict,
  keptNoHq,
  NO_HQ_RECHECK_MS,
  useKeptHqVerdict,
  type HqVerdictOwner,
} from "./hqVerdict";
import { endHqSession, keptHqSessions } from "./keptSessions";
import { useZeropsOrganizationMembersRead } from "./useZeropsMateOwners";
import { ZeropsDataContext } from "./zeropsDataContext";
import { useZeropsSessionOptional } from "./ZeropsSessionProvider";

/** The origins an HQ's API answers (`HQ_CLIENT_ORIGINS`): this one, and the hosted app. */
export const HOSTED_APP_ORIGIN = "https://mate.zerops.io";

export interface AccountHq {
  /**
   * `ready` once the member list was read, or while this browser keeps the verdict: only then is
   * `none` an answer to act on.
   */
  readonly status: "idle" | "loading" | "ready" | "failed";
  readonly hq: OfficialHq;
  /** The org's owners and admins: who sets an HQ up, and whom everybody else asks. */
  readonly admins: ReadonlyArray<ZeropsOrganizationMember>;
  /**
   * Reads the member list again, a kept verdict of no official HQ forgotten — after a birth minted
   * the anchor.
   */
  readonly reread: () => void;
}

/**
 * How long HQ's structure stream may go unanswered before the member list is read again: once for
 * each outage, for an anchor an admin may have moved meanwhile.
 */
export const HQ_OUTAGE_RECHECK_MS = 10 * 60_000;

/** The outages the member list was read again for, by organization and when each began. */
const rechecked = new Set<string>();

/** The organization's HQ, as this browser keeps it, or else as its member list names it. */
export function useAccountHq(clientId: string | undefined): AccountHq {
  const data = useContext(ZeropsDataContext);
  const owner = useMemo<HqVerdictOwner | undefined>(
    () =>
      data === null || clientId === undefined
        ? undefined
        : { account: data.runtime.scope.account, clientId },
    [clientId, data],
  );
  const kept = useKeptHqVerdict(owner);
  const { members, status, settled } = useZeropsOrganizationMembersRead({
    clientId,
    enabled: clientId !== undefined && kept === undefined,
  });
  const named = useMemo(() => findOfficialHq(members), [members]);
  // What a read of the member list settles is this browser's verdict from then on: the official
  // HQ it names, or that it names none — never a list being read again.
  useEffect(() => {
    if (owner === undefined || !settled) return;
    if (named.kind === "official") keepHqVerdict(owner, named);
    if (named.kind === "none") keepNoHqVerdict(owner, Date.now());
  }, [named, owner, settled]);
  const structure = useAtomValue(hqStructureAtom);
  const outageSince =
    structure !== null && structure.organizationId === clientId ? structure.unavailableSince : null;
  const keptHq = kept === undefined || keptNoHq(kept) ? undefined : kept;
  useEffect(() => {
    if (clientId === undefined || keptHq === undefined || outageSince === null) return;
    const outage = `${clientId}@${String(outageSince)}`;
    if (rechecked.has(outage)) return;
    const timer = setTimeout(
      () => {
        rechecked.add(outage);
        forgetHqVerdict(clientId, keptHq);
      },
      Math.max(0, outageSince + HQ_OUTAGE_RECHECK_MS - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [clientId, keptHq, outageSince]);
  const hq = useMemo<OfficialHq>(
    () =>
      kept === undefined
        ? named
        : keptNoHq(kept)
          ? { kind: "none" }
          : { kind: "official", projectId: kept.projectId, address: kept.address },
    [kept, named],
  );
  const admins = useMemo(() => ownersAndAdmins(members), [members]);
  const reread = useCallback(() => {
    if (data === null || owner === undefined) return;
    const request: MembersCellRequest = {
      kind: "members",
      account: data.runtime.scope,
      organization: data.organizationRef(owner.clientId),
    };
    Effect.runFork(data.runtime.cells.invalidate(request));
    forgetNoHqVerdict(owner);
  }, [data, owner]);
  // A verdict of no official HQ stands a day, then the member list is read again.
  const keptNone = kept !== undefined && keptNoHq(kept) ? kept : undefined;
  useEffect(() => {
    if (keptNone === undefined) return;
    const timer = setTimeout(reread, Math.max(0, keptNone.noneAt + NO_HQ_RECHECK_MS - Date.now()));
    return () => clearTimeout(timer);
  }, [keptNone, reread]);
  return { status: kept === undefined ? status : "ready", hq, admins, reread };
}

const apis = new Map<string, HqApi>();
onAccountLifetimeClose(() => apis.clear());

/**
 * The organization's HQ, for a write in the product: the product opens only over an official HQ
 * (`hqGate.ts`), so this is that HQ; anywhere else it is a mistake, and throws.
 */
export function officialHq(accountHq: Pick<AccountHq, "hq">): HqEndpoint {
  if (accountHq.hq.kind !== "official") {
    throw new Error(HQ_NOT_OPEN);
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

/**
 * Whether HQ's health says it is not the organization's official HQ: its anchor is gone, names
 * another, or its own credentials are wrong — never merely a standby, or a Zerops it cannot check.
 */
export function saysNotOfficial(health: HqHealth): boolean {
  return health.kind === "not-ready" && health.official !== "ok" && health.official !== "unknown";
}

/**
 * HQ's API for this account and org, with the session the account kept for this HQ, else entered
 * through its door on the first call. A door that answers not serving, from an HQ whose health says
 * it is not the official one, makes this browser forget its verdict, so the member list is read
 * again.
 */
export function accountHqApi(client: ZeropsApiClient, clientId: string, hq: HqEndpoint): HqApi {
  const key = `${client.accountEpoch}:${clientId}:${hq.projectId}:${hq.address}`;
  const held = apis.get(key);
  if (held !== undefined) return held;
  const platform = zeropsThrowawayPlatform(client, { asked: true });
  const keptKey = `${clientId}:${hq.projectId}:${hq.address}`;
  const api = makeHqApi({
    address: hq.address,
    kept: {
      read: () => keptHqSessions.read(keptKey)?.token ?? null,
      keep: ({ token, expiresAt }) => {
        const expiresAtEpochMs = Date.parse(expiresAt);
        if (!Number.isFinite(expiresAtEpochMs)) return;
        // A session another tab kept meanwhile is revoked, never left live for its 12 hours.
        const displaced = keptHqSessions.keep(keptKey, {
          address: hq.address,
          token,
          expiresAtEpochMs,
        });
        if (displaced !== null) endHqSession(displaced);
      },
      forget: (token) => void keptHqSessions.forget(keptKey, token),
    },
    fetch: (input, init) => fetch(input, init),
    throughDoor: (use) =>
      connectThroughThrowaway({
        platform,
        clientId,
        projectId: hq.projectId,
        nonce: randomUUID(),
        connect: use,
      }).catch(async (cause: unknown) => {
        if (cause instanceof HqError && cause.code === "not_active") {
          const health = await readHqHealth((input, init) => fetch(input, init), hq.address);
          if (saysNotOfficial(health)) forgetHqVerdict(clientId, hq);
        }
        throw cause;
      }),
    openSocket: openBrowserSocket,
  });
  apis.set(key, api);
  return api;
}

/**
 * The official HQ of the organization in view, as the person reaches it: its address and its API;
 * `null` until its anchor is resolved, with no organization open, and outside a Zerops session.
 */
export function useOfficialHq(): { readonly address: string; readonly api: HqApi } | null {
  const session = useZeropsSessionOptional();
  const client = session?.client;
  const clientId = session?.activeOrganization?.id;
  const { hq } = useAccountHq(clientId);
  return useMemo(
    () =>
      client === undefined || clientId === undefined || hq.kind !== "official"
        ? null
        : { address: hq.address, api: accountHqApi(client, clientId, hq) },
    [client, clientId, hq],
  );
}

/** Where an HQ stands, as this tab last read it. */
export type HqStanding =
  | { readonly kind: "unknown" }
  | { readonly kind: "healthy" }
  /** Serving, while it cannot check Zerops right now: no outage, everything keeps using it. */
  | { readonly kind: "unchecked" }
  /** Not answering as the official HQ since `since` (wall ms): the last known state stays shown. */
  | { readonly kind: "unavailable"; readonly since: number };

/** The standing a health read leaves: an outage keeps the time it began. */
export function nextHqStanding(previous: HqStanding, health: HqHealth, nowMs: number): HqStanding {
  if (health.kind === "healthy" || health.kind === "unchecked") return { kind: health.kind };
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
