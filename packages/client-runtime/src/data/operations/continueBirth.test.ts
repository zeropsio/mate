import { describe, expect, it, vi } from "vite-plus/test";
import type { SharedBirth } from "../projections/birthProgress.ts";
import { continueBirth, type ContinueBirthPorts } from "./continueBirth.ts";

const birth: SharedBirth = {
  id: "birth",
  appId: "app",
  appName: "Shop",
  face: "rose:seal",
  projectId: null,
  importProcessId: null,
  placement: "unknown",
  intent: {
    projectName: "Shop - Ada",
    recipe: { kind: "none" },
    agents: ["codex"],
    standUp: false,
    automated: false,
    placement: { role: "dev", name: "Ada", chief: false },
    location: null,
    userRoles: [],
  },
  progress: { phase: "creating-project", next: { kind: "create" }, reason: null },
  canContinue: true,
  canDelete: true,
};
const portsFor = (read: () => SharedBirth | undefined) =>
  ({
    read,
    bind: vi.fn(async (_birth: SharedBirth, _projectId: string) => {}),
    attach: vi.fn(async (_birth: SharedBirth) => {}),
    waitForPlacement: vi.fn(async (_projectId: string, _placement: "bound" | "attached") => read()),
    run: vi.fn(async (_birth: SharedBirth, _from: "create" | "import") => {}),
    recordImport: vi.fn(async (_birth: SharedBirth, _receipt: string) => {}),
  }) satisfies ContinueBirthPorts;

describe("continuing a shared birth", () => {
  it("Decision: Continue is one operation, the same on every device: it performs only the steps the record proves undone, with the single-import discipline and the lost-answer reconciliation of birth-seam.md; an unknown outcome is shown as unknown with Delete only; an accepted import that failed blocks at that step with the reason (no re-import, no override, no deadline).", async () => {
    const create = portsFor(() => birth);
    expect(await continueBirth(create)).toBe("started");
    expect(create.run).toHaveBeenCalledExactlyOnceWith(birth, "create");
    const unknown = portsFor(() => ({
      ...birth,
      progress: { ...birth.progress, next: { kind: "unknown" } },
      canContinue: false,
    }));
    expect(await continueBirth(unknown)).toBe("unavailable");
    expect(unknown.run).not.toHaveBeenCalled();
    const failed = portsFor(() => ({
      ...birth,
      projectId: "p1",
      progress: { phase: "import-accepted", next: { kind: "blocked" }, reason: "No capacity." },
      canContinue: false,
    }));
    expect(await continueBirth(failed)).toBe("unavailable");
    expect(failed.run).not.toHaveBeenCalled();
    const receipt = {
      ...birth,
      projectId: "p1",
      placement: "attached" as const,
      progress: {
        phase: "container-starting" as const,
        next: { kind: "record-import" as const, receipt: "service-1" },
        reason: null,
      },
    };
    const accepted = portsFor(() => receipt);
    expect(await continueBirth(accepted)).toBe("started");
    expect(accepted.recordImport).toHaveBeenCalledExactlyOnceWith(receipt, "service-1");
    expect(accepted.run).not.toHaveBeenCalled();
  });

  it("re-reads the bound birth before continuing and stops if the person's role was lost", async () => {
    let current: SharedBirth = birthWithBind();
    const ports = portsFor(() => current);
    ports.bind.mockImplementation(async () => {
      current = {
        ...current,
        projectId: "p1",
        placement: "unplaced",
        canContinue: false,
        progress: { phase: "project-created", next: { kind: "import" }, reason: null },
      };
    });
    expect(await continueBirth(ports)).toBe("unavailable");
    expect(ports.bind).toHaveBeenCalledExactlyOnceWith(birthWithBind(), "p1");
    expect(ports.run).not.toHaveBeenCalled();
  });

  it("binds the one proven project and imports only when its placement is current", async () => {
    let current: SharedBirth = birthWithBind();
    const ports = portsFor(() => current);
    ports.bind.mockImplementation(async () => {
      current = {
        ...current,
        projectId: "p1",
        placement: "unplaced",
        progress: { phase: "project-created", next: { kind: "import" }, reason: null },
      };
    });
    expect(await continueBirth(ports)).toBe("started");
    expect(ports.run).toHaveBeenCalledExactlyOnceWith(current, "import");
    const unread = portsFor(() => ({ ...current, placement: "unknown" }));
    expect(await continueBirth(unread)).toBe("waiting");
    expect(unread.run).not.toHaveBeenCalled();
  });

  it("continues after HQ's bind answer only when its navigation shows that binding", async () => {
    let current: SharedBirth = birthWithBind();
    let acknowledge: () => void = () => {};
    let publish: () => void = () => {};
    const answered = new Promise<void>((resolve) => {
      acknowledge = resolve;
    });
    const changed = new Promise<void>((resolve) => {
      publish = resolve;
    });
    const ports = portsFor(() => current);
    ports.bind.mockImplementation(async () => {
      acknowledge();
    });
    const continued = continueBirth({
      ...ports,
      waitForPlacement: async () => {
        await changed;
        return current;
      },
    });
    await answered;
    expect(ports.run).not.toHaveBeenCalled();
    current = {
      ...current,
      projectId: "p1",
      placement: "unplaced",
      progress: { phase: "project-created", next: { kind: "import" }, reason: null },
    };
    publish();
    expect(await continued).toBe("started");
    expect(ports.run).toHaveBeenCalledExactlyOnceWith(current, "import");
  });

  it("records a recovered import after HQ's attachment appears in navigation", async () => {
    let current: SharedBirth = {
      ...birth,
      projectId: "p1",
      placement: "unplaced",
      progress: {
        phase: "container-starting",
        next: { kind: "record-import", receipt: "s1" },
        reason: null,
      },
    };
    let acknowledge: () => void = () => {};
    let publish: () => void = () => {};
    const answered = new Promise<void>((resolve) => {
      acknowledge = resolve;
    });
    const changed = new Promise<void>((resolve) => {
      publish = resolve;
    });
    const ports = portsFor(() => current);
    ports.attach.mockImplementation(async () => {
      acknowledge();
    });
    const continued = continueBirth({
      ...ports,
      waitForPlacement: async () => {
        await changed;
        return current;
      },
    });
    await answered;
    expect(ports.recordImport).not.toHaveBeenCalled();
    current = { ...current, placement: "attached" };
    publish();
    expect(await continued).toBe("started");
    expect(ports.recordImport).toHaveBeenCalledExactlyOnceWith(current, "s1");
  });

  it("attaches the recovered project before recording its already accepted import", async () => {
    let current: SharedBirth = {
      ...birth,
      projectId: "p1",
      placement: "unplaced",
      progress: {
        phase: "container-starting",
        next: { kind: "record-import", receipt: "service-1" },
        reason: null,
      },
    };
    const ports = portsFor(() => current);
    ports.attach.mockImplementation(async () => {
      current = { ...current, placement: "attached" };
    });
    expect(await continueBirth(ports)).toBe("started");
    expect(ports.attach).toHaveBeenCalledOnce();
    expect(ports.recordImport).toHaveBeenCalledExactlyOnceWith(current, "service-1");
    expect(ports.run).not.toHaveBeenCalled();
  });

  it("an accepted import continues only by attaching the unplaced Mate", async () => {
    const accepted: SharedBirth = {
      ...birth,
      projectId: "p1",
      importProcessId: "i1",
      placement: "unplaced",
      progress: {
        phase: "import-accepted",
        next: { kind: "wait", for: "service", attach: true },
        reason: null,
      },
    };
    const ports = portsFor(() => accepted);
    expect(await continueBirth(ports)).toBe("started");
    expect(ports.attach).toHaveBeenCalledExactlyOnceWith(accepted);
    expect(ports.run).not.toHaveBeenCalled();
    expect(ports.recordImport).not.toHaveBeenCalled();

    const attached = portsFor(() => ({
      ...accepted,
      placement: "attached",
      canContinue: false,
      progress: { ...accepted.progress, next: { kind: "wait", for: "hello", attach: false } },
    }));
    expect(await continueBirth(attached)).toBe("unavailable");
    expect(attached.attach).not.toHaveBeenCalled();
    expect(attached.run).not.toHaveBeenCalled();
  });
});

function birthWithBind(): SharedBirth {
  return {
    ...birth,
    progress: { phase: "creating-project", next: { kind: "bind", projectId: "p1" }, reason: null },
  };
}
