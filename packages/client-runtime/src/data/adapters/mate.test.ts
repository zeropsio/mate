import { EnvironmentId } from "@t3tools/contracts";
import { AtomRegistry } from "effect/reactivity";
import { describe, expect, it } from "vite-plus/test";

import type { DescriptorFacts, Presence } from "../../zerops/environments/environmentMachine.ts";
import type {
  AccountGuards,
  ExchangeClock,
  ExchangeRequest,
} from "../../zerops/environments/exchange.ts";
import type { ProbeRead, ProbeReading } from "../../zerops/environments/probe.ts";
import type { ExchangeAnswer } from "../../zerops/identityExchange.ts";
import { linkKeys } from "../model.ts";
import { streamOf } from "../reducer.ts";
import { makeAccountStore, readsOfState, type AccountStore } from "../store.ts";
import { mateLink, mateLinks } from "../projections/mateLinks.ts";
import { makeMateAdapter, type MateAdapter, type MateTarget } from "./mate.ts";

const GRANTED: AccountGuards = {
  verified: true,

  zeropsState: "live",
};

const flush = async (): Promise<void> => {
  for (let hop = 0; hop < 50; hop += 1) await Promise.resolve();
};

function manualClock(): ExchangeClock & { readonly advance: (ms: number) => Promise<void> } {
  let mono = 0;
  const wallOffset = 1_800_000_000_000;
  let nextId = 0;
  const timers = new Map<number, { readonly at: number; readonly fire: () => void }>();
  return {
    now: () => ({ wall: mono + wallOffset, mono }),
    random: () => 0.5,
    setTimer: (delayMs, fire) => {
      const id = nextId;
      nextId += 1;
      timers.set(id, { at: mono + Math.max(0, delayMs), fire });
      return () => void timers.delete(id);
    },
    advance: async (ms) => {
      const end = mono + ms;
      for (;;) {
        let due: [number, { readonly at: number; readonly fire: () => void }] | undefined;
        for (const entry of timers)
          if (entry[1].at <= end && (due === undefined || entry[1].at < due[1].at)) due = entry;
        if (due === undefined) break;
        timers.delete(due[0]);
        mono = Math.max(mono, due[1].at);
        due[1].fire();
        await flush();
      }
      mono = end;
      await flush();
    },
  };
}

const descriptor = (projectId: string): DescriptorFacts => ({
  environmentId: EnvironmentId.make(`env-${projectId}`),
  serverVersion: "0.14.11",
  update: null,
  identity: "ok",
  identityCheckedAt: null,
});

const ready = (projectId: string): ProbeReading => ({
  kind: "ready",
  descriptor: descriptor(projectId),
  projectId,
  initAt: "init-1",
});

const present = (projectId: string): Presence => ({
  kind: "present",
  origin: `https://${projectId}.example`,
});

const target = (projectId: string, overrides: Partial<MateTarget> = {}): MateTarget => ({
  key: `${projectId}:zcp`,
  orgId: "org",
  presence: present(projectId),
  origin: `https://${projectId}.example`,
  platform: { project: "ACTIVE", service: "ACTIVE" },
  record: null,
  ...overrides,
});

interface Rig {
  readonly adapter: MateAdapter;
  readonly store: AccountStore;
  readonly clock: ReturnType<typeof manualClock>;
  readonly probes: Array<{ readonly origin: string; readonly ask: ProbeRead }>;
  readonly exchanges: Array<ExchangeRequest>;
  readonly installs: Array<string>;
  readonly intents: { value: string | null };
}

function rig(
  options: {
    readonly answer?: (request: ExchangeRequest) => ExchangeAnswer<string>;
    readonly reading?: (origin: string) => ProbeReading;
    readonly intents?: string | null;
  } = {},
): Rig {
  const clock = manualClock();
  const store = makeAccountStore(AtomRegistry.make());
  const probes: Array<{ readonly origin: string; readonly ask: ProbeRead }> = [];
  const exchanges: Array<ExchangeRequest> = [];
  const installs: Array<string> = [];
  const intents = { value: options.intents ?? null };
  const projectOf = (origin: string) => new URL(origin).hostname.split(".")[0] ?? "";
  const adapter = makeMateAdapter<string>({
    store,
    clock,
    exchange: async (request) => {
      exchanges.push(request);
      const projectId = request.key.split(":")[0] ?? "";
      return (
        options.answer?.(request) ?? {
          ok: true,
          environmentId: EnvironmentId.make(`env-${projectId}`),
          descriptor: descriptor(projectId),
          credential: `credential-${projectId}`,
        }
      );
    },
    install: async ({ key }) => {
      installs.push(key);
      return { ok: true };
    },
    readDescriptor: async (origin) => descriptor(projectOf(origin)),
    retryLink: () => undefined,
    retire: () => undefined,
    probe: async (origin, _signal, ask) => {
      probes.push({ origin, ask });
      return {
        reading: options.reading?.(origin) ?? ready(projectOf(origin)),
        sentAt: clock.now(),
      };
    },
    readInitAt: async () => "init-1",
    readMateFlag: async () => true,
    intents: {
      read: () => intents.value,
      write: (value) => {
        intents.value = value;
      },
    },
  });
  adapter.setAccount(GRANTED);
  adapter.setVisible(true);
  return { adapter, store, clock, probes, exchanges, installs, intents };
}

const read = (store: AccountStore) => readsOfState(store.state());

describe("makeMateAdapter", () => {
  it("settles queued observations when disposed before their reduction", async () => {
    const { adapter, store } = rig();
    adapter.setTargets([target("p1")]);
    const receipts = [adapter.settled(), adapter.settled()];
    adapter.dispose();
    const completed: number[] = [];
    receipts.forEach((receipt, index) => void receipt.then(() => completed.push(index)));
    await expect.poll(() => completed, { timeout: 1000 }).toEqual([0, 1]);
    expect(mateLinks.derive(read(store), null).containers.size).toBe(0);
    await adapter.settled();
  });

  it("probes no Mate nobody waits on: its container reads the platform alone", async () => {
    const { adapter, store, probes, exchanges } = rig();
    adapter.setTargets([
      target("p1"),
      target("p2", { platform: { project: "ACTIVE", service: "RESTARTING" } }),
    ]);
    await flush();
    expect(probes).toEqual([]);
    expect(exchanges).toEqual([]);
    const links = mateLinks.derive(read(store), null);
    expect([...links.containers.keys()]).toEqual(["p1:zcp", "p2:zcp"]);
    expect(links.containers.get("p2:zcp")?.state.level).toBe("restarting");
    expect(streamOf(store.state(), linkKeys.mate("p1")).demanded).toBe(false);
  });

  it("reads the route's Mate, exchanges at its door and goes live once installed", async () => {
    const { adapter, store, exchanges, installs } = rig();
    adapter.setTargets([target("p1"), target("p2")]);
    adapter.setDemand("route", ["p1:zcp"]);
    await flush();
    expect(exchanges.map((exchange) => exchange.key)).toEqual(["p1:zcp"]);
    expect(installs).toEqual(["p1:zcp"]);
    const link = mateLink.derive(read(store), "p1:zcp");
    expect(link?.environment.credential).toMatchObject({ kind: "held", installed: true });
    expect(link?.container.state.level).toBe("ready");
    const stream = streamOf(store.state(), linkKeys.mate("p1"));
    expect(stream).toMatchObject({ phase: "live", mode: "sampled" });
    expect(streamOf(store.state(), linkKeys.mate("p2")).demanded).toBe(false);
  });

  it("stops reading a Mate once nothing waits on it, and keeps what it read", async () => {
    const { adapter, store, clock, probes } = rig();
    adapter.setTargets([target("p1", { platform: { project: "ACTIVE", service: "ACTIVE" } })]);
    adapter.setDemand("screen", ["p1:zcp"]);
    await flush();
    const read1 = probes.length;
    adapter.setDemand("screen", []);
    await flush();
    await clock.advance(10 * 60_000);
    expect(probes.length).toBe(read1);
    expect(streamOf(store.state(), linkKeys.mate("p1")).phase).toBe("paused");
    expect(mateLink.derive(read(store), "p1:zcp")?.environment.credential.kind).toBe("held");
  });

  it("polls a container our verb restarts, keeps the intent across a reload, and ends it on a re-init", async () => {
    let initAt = "init-1";
    const first = rig({
      reading: (origin) => ({ ...ready(new URL(origin).hostname.split(".")[0] ?? ""), initAt }),
    });
    first.adapter.setTargets([target("p1")]);
    await flush();
    expect(first.adapter.intend("p1:zcp", { kind: "restart", initAt: "init-1" })).toBe(true);
    await flush();
    expect(streamOf(first.store.state(), linkKeys.mate("p1")).demanded).toBe(true);
    expect(first.intents.value).toContain('"kind":"restart"');
    const polled = first.probes.length;
    await first.clock.advance(4_000);
    expect(first.probes.length).toBeGreaterThan(polled);
    expect(mateLink.derive(read(first.store), "p1:zcp")?.container.state.level).toBe("restarting");

    const reloaded = rig({ intents: first.intents.value });
    reloaded.adapter.setTargets([target("p1")]);
    await flush();
    expect(mateLink.derive(read(reloaded.store), "p1:zcp")?.container.intent?.kind).toBe("restart");

    initAt = "init-2";
    await first.clock.advance(4_000);
    expect(mateLink.derive(read(first.store), "p1:zcp")?.container.intent).toBeNull();
    expect(first.intents.value).toBeNull();
  });

  it("refuses the link when the door refuses, until the person's Connect", async () => {
    let refuse = true;
    const { adapter, store } = rig({
      answer: (request) =>
        refuse
          ? {
              ok: false,
              failure: { class: "refusal", reason: { kind: "role" } },
              descriptor: descriptor(request.key.split(":")[0] ?? ""),
            }
          : {
              ok: true,
              environmentId: EnvironmentId.make("env-p1"),
              descriptor: descriptor("p1"),
              credential: "credential-p1",
            },
    });
    adapter.setTargets([target("p1")]);
    adapter.setDemand("route", ["p1:zcp"]);
    await flush();
    expect(streamOf(store.state(), linkKeys.mate("p1")).phase).toBe("refused");
    refuse = false;
    const outcome = await adapter.connect("p1:zcp", "user");
    expect(outcome).toEqual({ _tag: "Connected", environmentId: "env-p1" });
    expect(streamOf(store.state(), linkKeys.mate("p1")).phase).toBe("live");
  });

  it("keeps a Mate's facts through an outage: an unanswered probe changes its container, not its credential", async () => {
    let down = false;
    const { adapter, store, clock } = rig({
      reading: (origin) =>
        down ? { kind: "unreachable" } : ready(new URL(origin).hostname.split(".")[0] ?? ""),
    });
    adapter.setTargets([target("p1")]);
    adapter.setDemand("route", ["p1:zcp"]);
    await flush();
    down = true;
    adapter.request("p1:zcp");
    await clock.advance(100);
    const link = mateLink.derive(read(store), "p1:zcp");
    expect(link?.container.reading?.reading.kind).toBe("unreachable");
    expect(link?.environment.credential).toMatchObject({ kind: "held", installed: true });
  });

  it("writes nothing when a batch changes no Mate", async () => {
    const { adapter, store } = rig();
    adapter.setTargets([target("p1")]);
    await flush();
    const before = store.state().facts;
    adapter.setTargets([target("p1")]);
    await flush();
    expect(store.state().facts).toBe(before);
  });

  it("no longer shows a Mate the listing dropped, and keeps its reading", async () => {
    const { adapter, store } = rig();
    adapter.setTargets([target("p1"), target("p2")]);
    await flush();
    adapter.setTargets([target("p1")]);
    await flush();
    expect([...mateLinks.derive(read(store), null).machines.keys()]).toEqual(["p1:zcp"]);
    expect(mateLink.derive(read(store), "p2:zcp")?.shown).toBe(false);
  });

  it("connects none of a Mate held for its close-off, until it is let go", async () => {
    const { adapter, exchanges } = rig();
    adapter.setTargets([target("p1")]);
    adapter.setCloseOffHeld(["p1"]);
    adapter.setDemand("route", ["p1:zcp"]);
    await flush();
    expect(exchanges).toEqual([]);
    adapter.setCloseOffHeld([]);
    await flush();
    expect(exchanges.map((exchange) => exchange.key)).toEqual(["p1:zcp"]);
  });

  // Reading every listed Mate's descriptor and health check repeats remote work,
  // the stopped and unready ones failing with CORS errors in the console.
  it("reads a Mate once per connection attempt: the door's descriptor read stands for its container", async () => {
    const { adapter, store, probes, exchanges } = rig();
    adapter.setTargets([target("p1")]);
    adapter.setDemand("route", ["p1:zcp"]);
    await flush();
    expect(exchanges.map((exchange) => exchange.key)).toEqual(["p1:zcp"]);
    expect(probes).toEqual([]);
    expect(mateLink.derive(read(store), "p1:zcp")?.container.state.level).toBe("ready");
  });

  it.each(["STOPPED", "RESTARTING", "ACTION_FAILED"])(
    "never reads a Mate whose service Zerops reports %s, even on the route",
    async (status) => {
      const { adapter, probes, exchanges, clock } = rig();
      adapter.setTargets([target("p1", { platform: { project: "ACTIVE", service: status } })]);
      adapter.setDemand("route", ["p1:zcp"]);
      await flush();
      await clock.advance(10 * 60_000);
      expect(probes).toEqual([]);
      expect(exchanges).toEqual([]);
    },
  );

  it("backs off reading a Mate whose container stopped answering", async () => {
    const { adapter, probes, clock } = rig({ reading: () => ({ kind: "unreachable" }) });
    adapter.setTargets([target("p1")]);
    adapter.setDemand("route", ["p1:zcp"]);
    await flush();
    adapter.link(EnvironmentId.make("env-p1"), { phase: "connected" });
    await flush();
    adapter.link(EnvironmentId.make("env-p1"), { phase: "backoff", retryAtMs: null });
    await flush();
    await clock.advance(2 * 60_000);
    // A read on the drop, then the overdue ladder (10, 20, 40, 60 s): never every two seconds.
    expect(probes.length).toBeGreaterThan(0);
    expect(probes.length).toBeLessThanOrEqual(6);
  });

  // The owner's trace, 2026-10-06: every drawn Mate's descriptor was read again every 2 s.
  it.each([
    { name: "answering", reading: undefined, answers: true },
    { name: "not answering", reading: { kind: "unreachable" } as const, answers: false },
  ])(
    "ten drawn Mates, $name, are read only by their connection attempts over 60 s idle",
    async (row) => {
      const mates = Array.from({ length: 10 }, (_, at) => `d${at}`);
      const { adapter, clock, probes, exchanges } = rig({
        ...(row.reading === undefined ? {} : { reading: () => row.reading }),
        ...(row.answers
          ? {}
          : {
              answer: () => ({
                ok: false,
                failure: { class: "retryable", cause: { kind: "descriptor-unreachable" } },
                descriptor: null,
              }),
            }),
      });
      adapter.setTargets(mates.map((id) => target(id)));
      adapter.setDemand(
        "drawn",
        mates.map((id) => `${id}:zcp`),
      );
      await flush();
      await clock.advance(60_000);
      // No probe of its own: each read is its door's, once per connection attempt.
      expect(probes).toEqual([]);
      const perMate = mates.map((id) => exchanges.filter(({ key }) => key === `${id}:zcp`).length);
      if (row.answers) expect(perMate).toEqual(mates.map(() => 1));
      // Not answering, each attempt waits out the backoff ladder (2, 4, 8, 15, 30 s…).
      else for (const attempts of perMate) expect(attempts).toBeLessThanOrEqual(6);
    },
  );

  it("reads a Mate the person waits on while it is starting, backing off, never every two seconds", async () => {
    const { adapter, clock, probes } = rig({
      reading: () => ({ kind: "initializing", initAt: null }),
    });
    adapter.setTargets([target("p1", { platform: { project: "ACTIVE", service: "ACTIVE" } })]);
    adapter.setDemand("screen", ["p1:zcp"]);
    await flush();
    expect(adapter.intend("p1:zcp", { kind: "restart", initAt: "init-1" })).toBe(true);
    await flush();
    await clock.advance(60_000);
    expect(probes.length).toBeGreaterThan(0);
    expect(probes.length).toBeLessThanOrEqual(8);
  });

  it("reads a Mate again when Zerops pushes a change of its container's status", async () => {
    const { adapter, probes } = rig();
    adapter.setTargets([target("p1")]);
    adapter.setDemand("route", ["p1:zcp"]);
    await flush();
    const before = probes.length;
    adapter.setTargets([target("p1", { platform: { project: "ACTIVE", service: "RESTARTING" } })]);
    await flush();
    adapter.setTargets([target("p1")]);
    await flush();
    expect(probes.length).toBe(before + 1);
  });

  it("tells a Mate the person opened that is up but not answering at once, with one read beside its door", async () => {
    const { adapter, store, probes } = rig({
      answer: () => ({
        ok: false,
        failure: { class: "retryable", cause: { kind: "descriptor-unreachable" } },
        descriptor: null,
      }),
      reading: () => ({ kind: "not-answering", initAt: "init-1" }),
    });
    adapter.setTargets([target("p1")]);
    adapter.setDemand("route", ["p1:zcp"]);
    await flush();
    expect(probes.map(({ ask }) => ask)).toEqual([{ fresh: true, initAt: true }]);
    expect(mateLink.derive(read(store), "p1:zcp")?.container.reading?.reading.kind).toBe(
      "not-answering",
    );
  });

  it("reads nothing beside the door of a background Mate that does not answer", async () => {
    const { adapter, probes } = rig({
      answer: () => ({
        ok: false,
        failure: { class: "retryable", cause: { kind: "descriptor-unreachable" } },
        descriptor: null,
      }),
    });
    adapter.setTargets([target("p1")]);
    adapter.setDemand("drawn", ["p1:zcp"]);
    await flush();
    expect(probes).toEqual([]);
  });
});
