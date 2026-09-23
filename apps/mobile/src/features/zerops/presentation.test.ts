import { describe, expect, it } from "@effect/vitest";
import type { ZeropsProject } from "@t3tools/client-runtime/zerops";
import type {
  ContainerReachability,
  Reachability,
} from "@t3tools/client-runtime/zerops/environments";

import type { MobileCandidate } from "./candidate-listing";
import { zeropsCandidatePresentation } from "./presentation";

const PROJECT = { id: "project-a", name: "Demo", status: "ACTIVE" } as ZeropsProject;
const NOW_MS = 1_000_000;

const candidate = (overrides: Partial<MobileCandidate> = {}): MobileCandidate => ({
  key: "project-a:service-a",
  project: PROJECT,
  group: "ready",
  presence: "known",
  service: { id: "service-a", name: "zcp", status: "ACTIVE" },
  containerOrigin: "https://zcp-demo.example.test",
  reachability: null,
  connectable: true,
  ...overrides,
});

/** A Mate whose container is a verdict of its own. */
const container = (verdict: ContainerReachability): Partial<MobileCandidate> => ({
  reachability: { kind: "container", container: verdict },
  connectable: false,
});

const present = (
  row: MobileCandidate,
  options?: Parameters<typeof zeropsCandidatePresentation>[2],
) => zeropsCandidatePresentation(row, NOW_MS, options);

describe("zeropsCandidatePresentation", () => {
  it.each<{
    readonly container: ContainerReachability;
    readonly label: string;
    readonly notice: string;
  }>([
    {
      container: { level: "restarting", by: "platform", overdue: false },
      label: "Restarting",
      notice: "Zerops is restarting this Mate.",
    },
    {
      container: { level: "restarting", by: "you", overdue: false },
      label: "Restarting",
      notice: "Restarting this Mate.",
    },
    {
      container: { level: "restarting", by: "announced", overdue: false },
      label: "Restarting",
      notice: "This Mate is restarting.",
    },
    {
      container: { level: "updating", overdue: false },
      label: "Updating",
      notice: "Updating this Mate.",
    },
  ])(
    "a restarting Mate shows the container verdict, never not-reachable: $notice",
    ({ container: verdict, label, notice }) => {
      const presentation = present(candidate(container(verdict)));

      expect(presentation).toMatchObject({ label, notice, action: null, section: "waiting" });
      expect(presentation.label).not.toBe("Unavailable");
      expect(presentation.notice).not.toMatch(/not answering|not reachable|isn't answering/u);
    },
  );

  it.each<{
    readonly name: string;
    readonly candidate: MobileCandidate;
    readonly label: string;
    readonly action: string | null;
    readonly section: string;
  }>([
    {
      name: "a connected Mate",
      candidate: candidate({
        group: "connected",
        reachability: { kind: "ready", notice: null },
        connectable: false,
      }),
      label: "Connected",
      action: "Open",
      section: "connected",
    },
    {
      name: "a Mate nothing wants yet whose container answered",
      candidate: candidate(),
      label: "Ready",
      action: "Connect",
      section: "ready",
    },
    {
      name: "a Mate whose container is not read yet",
      candidate: candidate({ connectable: false }),
      label: "Checking",
      action: null,
      section: "waiting",
    },
    {
      name: "a Mate on its way",
      candidate: candidate({
        reachability: { kind: "connecting", waitingOn: "exchange" },
        connectable: false,
      }),
      label: "Connecting",
      action: null,
      section: "waiting",
    },
    {
      name: "a Mate between two tries",
      candidate: candidate({
        reachability: {
          kind: "retrying",
          retryAtMs: NOW_MS + 4_000,
          last: { kind: "network" },
          restart: false,
        },
        connectable: false,
      }),
      label: "Connecting",
      action: "Try now",
      section: "waiting",
    },
    {
      name: "a Mate whose door refused the role",
      candidate: candidate({ reachability: { kind: "refused-role" }, connectable: false }),
      label: "Unavailable",
      action: null,
      section: "unavailable",
    },
    {
      name: "a project whose services are not read yet",
      candidate: candidate({
        key: "project-a",
        group: "unavailable",
        presence: "unknown",
        service: undefined,
        containerOrigin: undefined,
        connectable: false,
      }),
      label: "Checking",
      action: null,
      section: "waiting",
    },
    {
      name: "a container the platform is creating",
      candidate: candidate({
        group: "provisioning",
        reason: "container is starting (NEW)",
        connectable: false,
      }),
      label: "Starting",
      action: null,
      section: "waiting",
    },
    {
      name: "a project with no Mate container",
      candidate: candidate({
        key: "project-a",
        group: "unavailable",
        reason: "no Zerops Mate container in this project",
        service: undefined,
        containerOrigin: undefined,
        connectable: false,
      }),
      label: "Unavailable",
      action: null,
      section: "unavailable",
    },
    {
      name: "a stopped container",
      candidate: candidate(container({ level: "inactive", status: "STOPPED" })),
      label: "Not running",
      action: null,
      section: "unavailable",
    },
  ])("$name reads as $label", ({ candidate: row, label, action, section }) => {
    expect(present(row)).toMatchObject({ label, action, section });
  });

  it("says a platform reason only where no container verdict speaks", () => {
    expect(
      present(
        candidate({
          group: "unavailable",
          reason: "public access is off for this container",
          connectable: false,
        }),
      ).notice,
    ).toBe("public access is off for this container");
    expect(present(candidate(container({ level: "booting", overdue: true })))).toMatchObject({
      label: "Starting",
      pulsing: false,
      notice: "This Mate is taking longer than usual to start.",
    });
  });

  it("keeps a connected Mate open while its container restarts under it", () => {
    const notice: Reachability = {
      kind: "ready",
      notice: { level: "restarting", by: "you", overdue: false },
    };
    expect(
      present(candidate({ group: "connected", reachability: notice, connectable: false })),
    ).toMatchObject({ label: "Connected", action: "Open", notice: "Restarting this Mate." });
  });

  // Whose Mate it is outranks whatever its container is doing (D5).
  it.each<MobileCandidate>([
    candidate({ group: "connected", reachability: { kind: "ready", notice: null } }),
    candidate(),
    candidate(container({ level: "restarting", by: "platform", overdue: false })),
    candidate({ group: "unavailable", reason: "container is STOPPED", connectable: false }),
  ])("a listed Mate offers no verb, whatever its container is doing", (row) => {
    expect(present(row, { visibility: "listed" })).toMatchObject({
      label: "Not yours",
      tone: "off",
      action: null,
      notice: "Only its owner opens this Mate.",
    });
  });

  it("names the owner when the account can be read for one", () => {
    expect(present(candidate(), { visibility: "listed", ownerName: "Jan" }).notice).toBe(
      "Jan's Mate — only Jan opens it.",
    );
  });
});
