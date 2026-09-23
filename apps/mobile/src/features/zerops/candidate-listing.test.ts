import { describe, expect, it } from "vite-plus/test";
import { EnvironmentId } from "@t3tools/contracts";
import type { ZeropsProject } from "@t3tools/client-runtime/zerops";
import { makeContainerStore } from "@t3tools/client-runtime/zerops/environments";
import type { Known } from "@t3tools/client-runtime/zerops/knowledge";
import type { CandidateRow } from "@t3tools/client-runtime/zerops/projections";

import { candidatePickerBody, mobileCandidates, type MobileCandidate } from "./candidate-listing";

const NOW_MS = 1_000_000;

const PROJECT = {
  id: "project-a",
  name: "Demo",
  status: "ACTIVE",
  clientId: "org-a",
} as ZeropsProject;

const row = (overrides: Partial<MobileCandidate> = {}): MobileCandidate => ({
  key: "project-a:service-a",
  project: PROJECT,
  group: "ready",
  presence: "known",
  service: { id: "service-a", name: "zcp", status: "ACTIVE" },
  containerOrigin: "https://zcp-demo.example.test",
  container: { level: "ready" },
  ...overrides,
});

const known = (
  value: ReadonlyArray<MobileCandidate>,
  coverage: "complete" | "partial",
): Known<ReadonlyArray<MobileCandidate>> => ({
  state: "known",
  value,
  asOf: { ordinal: 1, atMs: NOW_MS - 10 },
  coverage,
  freshness: { kind: "live" },
});

describe("candidatePickerBody", () => {
  it.each<{ readonly name: string; readonly listing: Known<ReadonlyArray<MobileCandidate>> }>([
    { name: "unread", listing: { state: "unread", waitingFor: null } },
    { name: "being read", listing: { state: "reading", sinceMs: NOW_MS - 50, attempt: 1 } },
  ])("an unread listing is a placeholder, never empty: $name", ({ listing }) => {
    const body = candidatePickerBody(listing, NOW_MS);

    expect(body).toMatchObject({
      kind: "notice",
      region: "placeholder",
      message: { text: "Reading your projects…" },
    });
    expect(body.kind).not.toBe("none");
  });

  it("says no project is there only off a complete listing", () => {
    expect(candidatePickerBody(known([], "complete"), NOW_MS)).toEqual({ kind: "none" });
    expect(candidatePickerBody(known([], "partial"), NOW_MS)).toMatchObject({
      kind: "notice",
      message: { text: "Still reading…" },
    });
    expect(
      candidatePickerBody(
        {
          state: "failed",
          failure: { kind: "timeout", afterMs: 15_000 },
          atMs: NOW_MS,
          attempt: 1,
          retryAtMs: null,
        },
        NOW_MS,
      ),
    ).toMatchObject({
      kind: "notice",
      region: "message",
      message: { text: "Couldn't read your projects. Zerops didn't answer." },
      affordance: { kind: "retry", label: "Try again" },
    });
  });

  it("draws the rows read so far, with the notice a listing known in part carries", () => {
    const rows = [row()];

    expect(candidatePickerBody(known(rows, "complete"), NOW_MS)).toEqual({
      kind: "rows",
      rows,
      notice: null,
    });
    expect(candidatePickerBody(known(rows, "partial"), NOW_MS)).toMatchObject({
      kind: "rows",
      rows,
      notice: { message: { text: "Still reading…" } },
    });
    expect(
      candidatePickerBody(
        known([row({ presence: "unknown", group: "unavailable" })], "complete"),
        NOW_MS,
      ),
    ).toMatchObject({ kind: "rows", notice: { message: { text: "Still reading…" } } });
  });
});

const listed = (
  value: ReadonlyArray<CandidateRow>,
  coverage: "complete" | "partial" = "complete",
): Known<ReadonlyArray<CandidateRow>> => ({
  state: "known",
  value,
  asOf: { ordinal: 1, atMs: NOW_MS - 10 },
  coverage,
  freshness: { kind: "live" },
});

const platformRow = (projectId: string): CandidateRow => ({
  key: `${projectId}:service-a`,
  project: { ...PROJECT, id: projectId },
  group: "ready",
  presence: "known",
  service: { id: "service-a", name: "zcp", status: "ACTIVE" },
  containerOrigin: `https://zcp-${projectId}.example.test`,
});

describe("mobileCandidates", () => {
  const NOTHING_CONNECTED = new Map();
  const NO_CONTAINERS = new Map();

  it("lists every organization's rows as one listing, as known as its least known organization", () => {
    const a = platformRow("project-a");
    const b = platformRow("project-b");
    const both = mobileCandidates({
      organizations: [listed([a]), listed([b])],
      connectedOrigins: NOTHING_CONNECTED,
      containers: NO_CONTAINERS,
      nowMs: NOW_MS,
    });
    const oneUnread = mobileCandidates({
      organizations: [listed([a]), { state: "unread", waitingFor: null }],
      connectedOrigins: NOTHING_CONNECTED,
      containers: NO_CONTAINERS,
      nowMs: NOW_MS,
    });

    expect(both).toMatchObject({ state: "known", coverage: "complete" });
    expect(both.state === "known" ? both.value.map((row) => row.key) : []).toEqual([a.key, b.key]);
    expect(oneUnread).toMatchObject({ state: "known", coverage: "partial" });
    expect(oneUnread.state === "known" ? oneUnread.value.map((row) => row.key) : []).toEqual([
      a.key,
    ]);
  });

  it("lets a failed organization speak for a listing none of whose organizations is known", () => {
    const failed: Known<ReadonlyArray<CandidateRow>> = {
      state: "failed",
      failure: { kind: "transport", detail: "down" },
      atMs: NOW_MS,
      attempt: 2,
      retryAtMs: NOW_MS + 4_000,
    };

    expect(
      mobileCandidates({
        organizations: [{ state: "reading", sinceMs: NOW_MS, attempt: 1 }, failed],
        connectedOrigins: NOTHING_CONNECTED,
        containers: NO_CONTAINERS,
        nowMs: NOW_MS,
      }),
    ).toBe(failed);
    expect(
      candidatePickerBody(
        mobileCandidates({
          organizations: [],
          connectedOrigins: NOTHING_CONNECTED,
          containers: NO_CONTAINERS,
          nowMs: NOW_MS,
        }),
        NOW_MS,
      ),
    ).toEqual({ kind: "none" });
  });

  it("joins each row with the environment this device connected and its container's verdict", () => {
    const store = makeContainerStore({
      clock: { now: () => ({ wall: NOW_MS, mono: NOW_MS }), setTimer: () => () => undefined },
      probe: () => new Promise(() => undefined),
      readMateFlag: () => Promise.resolve("unknown"),
      intents: { read: () => null, write: () => undefined },
    });
    const a = platformRow("project-a");
    const b = platformRow("project-b");
    store.setTargets([
      {
        key: b.key,
        origin: b.containerOrigin ?? null,
        platform: { project: "ACTIVE", service: "RESTARTING" },
      },
    ]);
    const environmentId = EnvironmentId.make("environment-a");

    const listing = mobileCandidates({
      organizations: [listed([a, b])],
      connectedOrigins: new Map([["https://zcp-project-a.example.test", environmentId]]),
      containers: store.machines(),
      nowMs: NOW_MS,
    });

    expect(listing.state === "known" ? listing.value : []).toMatchObject([
      { key: a.key, group: "connected", environmentId, container: { level: "unknown" } },
      { key: b.key, group: "ready", container: { level: "restarting", by: "platform" } },
    ]);
    store.dispose();
  });
});
