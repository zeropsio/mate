/**
 * The organization's HQ, as this tab reaches it (ADR 0001, SPEC §3.3, §4).
 *
 * - **Which HQ:** the one its anchor names in the org's member list (`findOfficialHq`), read with
 *   the person's own token — never a project's name or tag, which anybody who can create a
 *   project could copy. The verdict — that HQ, or that there is none — is held in this page's
 *   memory (`hqVerdict.ts`), and a reader while it holds one reads no member list.
 * - **Through its door:** HQ's API answers a session HQ issued for a throwaway named for its
 *   project (`mate-door:<hqProjectId>:<nonce>`), deleted once the door takes it — one a try was
 *   not served with is presented again on the next, while young, and mints nothing. One API per account, org and
 *   HQ for the account's lifetime; its session is kept across loads as the Mates' are
 *   (`keptSessions.ts`, audit K7), so a load with a live one passes no door.
 * - **Whether it answers:** its structure stream (`hqStructure.ts`): healthy while it serves, and
 *   after it failed, `/health` read once per failed attempt while the tab is visible. An HQ that
 *   stops answering is `unavailable` from the stream's first failure, with that time (SPEC §4).
 * - **Its birth's ports:** Core comes from this very build, same-origin under `hq-core/`
 *   (`apps/hq/scripts/pack-core.ts`).
 */
import { accountThrowawayDebt } from "./throwawayDebt";
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
  type HqParts,
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
import { useCallback, useContext, useEffect, useMemo, useSyncExternalStore } from "react";

import { appBasePath } from "~/basePath";
import { randomUUID } from "~/lib/utils";

import { onAccountLifetimeClose } from "./accountLifetime";
import {
  forgetHqVerdict,
  forgetNoHqVerdict,
  keepHqVerdict,
  keepNoHqVerdict,
  noHq,
  useHqVerdict,
  type HqVerdictOwner,
} from "./hqVerdict";
import { keptHqSessions } from "./keptSessions";
import { useZeropsOrganizationMembersRead } from "./useZeropsMateOwners";
import { whenShown } from "./whenShown";
import { ZeropsDataContext } from "./zeropsDataContext";
import { useZeropsSessionOptional } from "./ZeropsSessionProvider";

export interface AccountHq {
  /**
   * `ready` once the member list was read, or while this page holds the verdict: only then is
   * `none` an answer to act on.
   */
  readonly status: "idle" | "loading" | "ready" | "failed";
  readonly hq: OfficialHq;
  /** The org's owners and admins: who sets an HQ up, and whom everybody else asks. */
  readonly admins: ReadonlyArray<ZeropsOrganizationMember>;
  /**
   * Reads the member list again, a held verdict of no official HQ forgotten — after a birth minted
   * the anchor.
   */
  readonly reread: () => void;
}

/** The organization's HQ, as this page holds it, or else as its member list names it. */
export function useAccountHq(clientId: string | undefined): AccountHq {
  const data = useContext(ZeropsDataContext);
  const owner = useMemo<HqVerdictOwner | undefined>(
    () =>
      data === null || clientId === undefined
        ? undefined
        : { account: data.runtime.scope.account, clientId },
    [clientId, data],
  );
  const kept = useHqVerdict(owner);
  const { members, status, settled } = useZeropsOrganizationMembersRead({
    clientId,
    enabled: clientId !== undefined && kept === undefined,
  });
  const named = useMemo(() => findOfficialHq(members), [members]);
  // What a read of the member list settles is this page's verdict from then on: the official
  // HQ it names, or that it names none — never a list being read again.
  useEffect(() => {
    if (owner === undefined || !settled) return;
    if (named.kind === "official") keepHqVerdict(owner, named);
    if (named.kind === "none") keepNoHqVerdict(owner);
  }, [named, owner, settled]);
  const hq = useMemo<OfficialHq>(
    () =>
      kept === undefined
        ? named
        : noHq(kept)
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

/**
 * HQ's structure socket, as this browser opens it. Messages reach the shared client directly;
 * its pong is sent before liveness callbacks, with no timer or React scheduling in between.
 * Close codes pass through so the stream owner distinguishes rotation, going-away and refusal.
 */
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
 * it is not the official one, makes this page forget its verdict, so the member list is read
 * again.
 */
export function accountHqApi(client: ZeropsApiClient, clientId: string, hq: HqEndpoint): HqApi {
  const key = `${client.accountEpoch}:${clientId}:${hq.projectId}:${hq.address}`;
  const held = apis.get(key);
  if (held !== undefined) return held;
  const platform = zeropsThrowawayPlatform(client, {
    asked: true,
    debt: accountThrowawayDebt(client),
  });
  const keptKey = `${clientId}:${hq.projectId}:${hq.address}`;
  const api = makeHqApi({
    address: hq.address,
    kept: {
      read: () => keptHqSessions.read(keptKey)?.token ?? null,
      keep: ({ token, expiresAt }) => {
        const expiresAtEpochMs = Date.parse(expiresAt);
        if (!Number.isFinite(expiresAtEpochMs)) return;
        // A session another tab kept meanwhile may still be that tab's: it is never revoked from
        // here. It stays kept beside this one, so the account's close ends it with the rest.
        const displaced = keptHqSessions.keep(keptKey, {
          address: hq.address,
          token,
          expiresAtEpochMs,
        });
        if (displaced !== null)
          keptHqSessions.keep(`${keptKey}:displaced:${displaced.token}`, displaced);
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
        // A door HQ did not answer as serving — unreached, past its deadline, or not serving — did
        // not take the throwaway: its next try presents it again, while young, and mints nothing
        // (KRLS, 2026-10-03: eight throwaways in 21 s while the organization's reads stalled).
        keep: (outcome) =>
          !outcome.ok && outcome.cause instanceof HqError && outcome.cause.kind === "unavailable",
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
  const api =
    client === undefined || clientId === undefined || hq.kind !== "official"
      ? null
      : accountHqApi(client, clientId, hq);
  const address = hq.kind === "official" ? hq.address : null;
  return useMemo(
    () => (address === null || api === null ? null : { address, api }),
    [address, api],
  );
}

/** Where an HQ stands, as its stream last said it (`hqStandingAtom`). */
export type HqStanding =
  | { readonly kind: "unknown" }
  /**
   * Serving as the official HQ — `unchecked` while it cannot check Zerops right now: no outage,
   * everything keeps using it. `build` the Core it runs (`hq/update.ts`) and `parts` how they
   * stand, as its stream or its health says them; each absent while neither has yet.
   */
  | {
      readonly kind: "healthy" | "unchecked";
      readonly build?: string;
      readonly parts?: HqParts;
    }
  /** Not answering as the official HQ since `since` (wall ms): the last known state stays shown. */
  | { readonly kind: "unavailable"; readonly since: number };

/** The standing a health read leaves: an outage keeps the time it began. */
export function nextHqStanding(previous: HqStanding, health: HqHealth, nowMs: number): HqStanding {
  if (health.kind === "healthy" || health.kind === "unchecked") return health;
  return previous.kind === "unavailable" ? previous : { kind: "unavailable", since: nowMs };
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

/** What an HQ birth acts through, from this tab. */
export function hqBirthDeps(client: ZeropsApiClient): HqBirthDeps {
  return {
    platform: client,
    core: () => readBundledCore((input, init) => fetch(input, init), `${appBasePath()}/hq-core`),
    health: (address) => readHqHealth((input, init) => fetch(input, init), address),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => Date.now(),
    newBirthId: randomUUID,
    // HQ's key (`HQ_KEY_SECRET`) is drawn here, from WebCrypto, and goes only into HQ's env.
    randomBytes: (bytes) => crypto.getRandomValues(bytes),
  };
}

/** The birth's own input beside its record: the API Core reads. */
export function hqBirthSite(client: ZeropsApiClient): {
  readonly zeropsApi: string;
} {
  return {
    zeropsApi: `${client.baseUrl}/api/rest/public`,
  };
}
