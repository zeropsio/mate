import { describe, expect, it } from "@effect/vitest";
import type { ZeropsProject } from "@t3tools/client-runtime/zerops";
import type { ContainerVerdict } from "@t3tools/client-runtime/zerops/environments";

import type { MobileCandidate } from "./candidate-listing";
import { zeropsCandidatePresentation } from "./presentation";

const PROJECT = { id: "project-a", name: "Demo", status: "ACTIVE" } as ZeropsProject;

const candidate = (overrides: Partial<MobileCandidate> = {}): MobileCandidate => ({
  key: "project-a:service-a",
  project: PROJECT,
  group: "ready",
  presence: "known",
  service: { id: "service-a", name: "zcp", status: "ACTIVE" },
  containerOrigin: "https://zcp-demo.example.test",
  container: { level: "ready" },
  ...overrides,
});

describe("zeropsCandidatePresentation", () => {
  it.each<{
    readonly container: ContainerVerdict;
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
    ({ container, label, notice }) => {
      const presentation = zeropsCandidatePresentation(candidate({ container }));

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
      candidate: candidate({ group: "connected" }),
      label: "Connected",
      action: "Open",
      section: "connected",
    },
    {
      name: "a Mate whose container answered",
      candidate: candidate(),
      label: "Ready",
      action: "Connect",
      section: "ready",
    },
    {
      name: "a Mate whose container is not read yet",
      candidate: candidate({ container: { level: "unknown" } }),
      label: "Checking",
      action: null,
      section: "waiting",
    },
    {
      name: "a project whose services are not read yet",
      candidate: candidate({
        key: "project-a",
        group: "unavailable",
        presence: "unknown",
        service: undefined,
        containerOrigin: undefined,
        container: { level: "unknown" },
      }),
      label: "Checking",
      action: null,
      section: "waiting",
    },
    {
      name: "a container the platform is creating",
      candidate: candidate({ group: "provisioning", reason: "container is starting (NEW)" }),
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
        container: { level: "unknown" },
      }),
      label: "Unavailable",
      action: null,
      section: "unavailable",
    },
    {
      name: "a stopped container",
      candidate: candidate({ container: { level: "inactive", status: "STOPPED" } }),
      label: "Not running",
      action: null,
      section: "unavailable",
    },
  ])("$name reads as $label", ({ candidate: row, label, action, section }) => {
    expect(zeropsCandidatePresentation(row)).toMatchObject({ label, action, section });
  });

  it("says a platform reason only where no container verdict speaks", () => {
    expect(
      zeropsCandidatePresentation(
        candidate({ group: "unavailable", reason: "public access is off for this container" }),
      ).notice,
    ).toBe("public access is off for this container");
    expect(
      zeropsCandidatePresentation(candidate({ container: { level: "booting", overdue: true } })),
    ).toMatchObject({
      label: "Starting",
      pulsing: false,
      notice: "This Mate is taking longer than usual to start.",
    });
  });

  it("keeps a connected Mate open while its container restarts under it", () => {
    expect(
      zeropsCandidatePresentation(
        candidate({
          group: "connected",
          container: { level: "restarting", by: "you", overdue: false },
        }),
      ),
    ).toMatchObject({ label: "Connected", action: "Open", notice: "Restarting this Mate." });
  });

  // Whose Mate it is outranks whatever its container is doing (D5).
  it.each<MobileCandidate>([
    candidate({ group: "connected" }),
    candidate(),
    candidate({ container: { level: "restarting", by: "platform", overdue: false } }),
    candidate({ group: "unavailable", reason: "container is STOPPED" }),
  ])("a listed Mate offers no verb, whatever its container is doing", (row) => {
    expect(zeropsCandidatePresentation(row, { visibility: "listed" })).toMatchObject({
      label: "Not yours",
      tone: "off",
      action: null,
      notice: "Only its owner opens this Mate.",
    });
  });

  it("names the owner when the account can be read for one", () => {
    expect(
      zeropsCandidatePresentation(candidate(), { visibility: "listed", ownerName: "Jan" }).notice,
    ).toBe("Jan's Mate — only Jan opens it.");
  });
});
