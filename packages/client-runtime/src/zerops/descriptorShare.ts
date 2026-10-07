/**
 * The tab's one reader of each Mate's descriptor (`/.well-known/t3/environment`): the probe store,
 * the exchange driver, the door and the connection's own authorization all ask here, so one
 * connect reads it once (measured on v0.11.83: three to four reads of it per Mate per load).
 *
 * - A read in flight is joined by every reader that does not ask `fresh`.
 * - The latest settled read is served for `DESCRIPTOR_SHARE_MS` from when it was sent, on both
 *   clocks (a sleep stops the monotonic one), and only when it answered as a descriptor: a read
 *   that failed is never served, and it ends the one before it, so nobody is told a Mate is up
 *   after a later read found it away.
 * - `fresh` starts a read now, whatever is held: a container coming up, or a caller that waits for
 *   a reading started after it asked. Its answer is shared like any other.
 * - Each read is one header-less GET (no CORS preflight), ended at `DESCRIPTOR_READ_DEADLINE_MS`
 *   as `blocked`. A reader that gives up leaves the read to the others.
 */
import { ExecutionEnvironmentDescriptor } from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { readMatePath, type FetchLike, type MatePathReading } from "./containerHealth.ts";
import type { Instant } from "./environments/exchange.ts";
import type { ExchangeClock } from "./environments/exchange.ts";

/** How long a descriptor read is served to the readers after it. */
export const DESCRIPTOR_SHARE_MS = 10_000;
export const DESCRIPTOR_READ_DEADLINE_MS = 8_000;

/** One read of a Mate's descriptor, and when it was sent: a shared one may predate its reader. */
export interface DescriptorReading {
  readonly reading: MatePathReading;
  readonly sentAt: Instant;
}

export interface DescriptorShare {
  /** The descriptor document at this Mate base URL, as one read of it answered. */
  readonly read: (
    httpBaseUrl: string,
    options: { readonly fresh: boolean; readonly signal?: AbortSignal },
  ) => Promise<DescriptorReading>;
  /** The descriptor itself, shared; rejects when the Mate did not answer with one. */
  readonly descriptor: (
    httpBaseUrl: string,
    signal?: AbortSignal,
  ) => Promise<ExecutionEnvironmentDescriptor>;
  /** The descriptor a read sent within `DESCRIPTOR_SHARE_MS` answered with; null when none did. */
  readonly recent: (httpBaseUrl: string) => ExecutionEnvironmentDescriptor | null;
}

export interface DescriptorSharePorts {
  readonly clock: Pick<ExchangeClock, "now" | "setTimer">;
  readonly fetch: FetchLike;
}

interface Settled extends DescriptorReading {
  readonly descriptor: ExecutionEnvironmentDescriptor | null;
}

interface Slot {
  inFlight: Promise<DescriptorReading> | null;
  settled: Settled | null;
  /** The order reads were sent in: an older read settling late never replaces a newer one. */
  sent: number;
  settledOrder: number;
}

const decodeDescriptor = Schema.decodeUnknownOption(ExecutionEnvironmentDescriptor);

const descriptorOf = (reading: MatePathReading): ExecutionEnvironmentDescriptor | null =>
  reading.kind === "json" ? Option.getOrNull(decodeDescriptor(reading.body)) : null;

const keyOf = (httpBaseUrl: string): string => httpBaseUrl.replace(/\/+$/, "");

/** The read, or a rejection as soon as this reader's signal gives up on it. */
const until = <A>(read: Promise<A>, signal: AbortSignal | undefined): Promise<A> => {
  if (signal === undefined) return read;
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<A>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    read.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (cause: unknown) => {
        signal.removeEventListener("abort", abort);
        reject(cause);
      },
    );
  });
};

export function makeDescriptorShare(ports: DescriptorSharePorts): DescriptorShare {
  const { clock } = ports;
  const slots = new Map<string, Slot>();

  const slotFor = (key: string): Slot => {
    const existing = slots.get(key);
    if (existing !== undefined) return existing;
    const created: Slot = { inFlight: null, settled: null, sent: 0, settledOrder: 0 };
    slots.set(key, created);
    return created;
  };

  const servable = (slot: Slot | undefined): Settled | null => {
    const settled = slot?.settled ?? null;
    if (settled === null || settled.descriptor === null) return null;
    // Either clock past the window makes it stale: the monotonic one stands still while the
    // machine sleeps.
    const now = clock.now();
    const age = Math.max(now.mono - settled.sentAt.mono, now.wall - settled.sentAt.wall);
    return age <= DESCRIPTOR_SHARE_MS ? settled : null;
  };

  const start = (key: string, slot: Slot): Promise<DescriptorReading> => {
    slot.sent += 1;
    const order = slot.sent;
    const sentAt = clock.now();
    const controller = new AbortController();
    const cancelDeadline = clock.setTimer(DESCRIPTOR_READ_DEADLINE_MS, () => controller.abort());
    const read = readMatePath(
      `${key}/.well-known/t3/environment`,
      ports.fetch,
      controller.signal,
    ).then((reading) => {
      cancelDeadline();
      if (order > slot.settledOrder) {
        slot.settledOrder = order;
        slot.settled = { reading, sentAt, descriptor: descriptorOf(reading) };
      }
      if (slot.inFlight === read) slot.inFlight = null;
      return { reading, sentAt };
    });
    slot.inFlight = read;
    return read;
  };

  const read: DescriptorShare["read"] = (httpBaseUrl, { fresh, signal }) => {
    const key = keyOf(httpBaseUrl);
    const slot = slotFor(key);
    if (!fresh) {
      const held = servable(slot);
      if (held !== null) return Promise.resolve({ reading: held.reading, sentAt: held.sentAt });
      if (slot.inFlight !== null) return until(slot.inFlight, signal);
    }
    return until(start(key, slot), signal);
  };

  return {
    read,
    descriptor: async (httpBaseUrl, signal) => {
      const { reading } = await read(httpBaseUrl, { fresh: false, ...(signal ? { signal } : {}) });
      const descriptor = descriptorOf(reading);
      if (descriptor === null) {
        throw new Error(`The Mate at ${httpBaseUrl} did not answer with its descriptor.`);
      }
      return descriptor;
    },
    recent: (httpBaseUrl) => servable(slots.get(keyOf(httpBaseUrl)))?.descriptor ?? null,
  };
}
