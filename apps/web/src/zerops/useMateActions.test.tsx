/**
 * *Change face…* as `useMateActions` offers it, wherever a Mate is listed: beside Rename, where
 * the viewer may rename the Mate; its dialog opening on the face the Mate wears; a save that is
 * one write to the organization's HQ, closing once HQ takes it; and a refusal said in the dialog,
 * nothing else changed.
 */
import type { ZeropsMateFace } from "@t3tools/client-runtime/zerops";
import type { HqPlacement } from "@t3tools/client-runtime/zerops/hq";
import { EnvironmentId } from "@t3tools/contracts";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { ZeropsMenuAction } from "../components/zerops/ZeropsProjectMenu";
import { closeAccountLifetime, openAccountLifetime } from "./accountLifetime";
import { useMateActions, type MateActions } from "./useMateActions";
import type { ZeropsCandidatePresentation } from "./useZeropsCandidates";

interface FaceDialogProps {
  readonly open: boolean;
  readonly name: string;
  readonly face: ZeropsMateFace;
  readonly pending: boolean;
  readonly error: string | null;
  readonly onSave: (face: ZeropsMateFace) => void;
  readonly onCancel: () => void;
  readonly onOpenChangeComplete: (open: boolean) => void;
}

const mock = vi.hoisted(() => ({
  /** HQ's `PATCH /api/mates/{projectId}`, a write here being the promise the test answers. */
  updateMate: vi.fn(),
  roleCode: "OWNER",
  listing: { current: undefined as unknown },
  /** The press's marker on each container, by service id, as the store states it. */
  markers: new Map<string, boolean | "unknown" | "unread">(),
  dialog: { current: null as FaceDialogProps | null },
}));

vi.mock("./ZeropsSessionProvider", () => ({
  useZeropsSession: () => ({
    activeOrganization: {
      id: "org-acme",
      membershipId: "member-ada",
      name: "Acme",
      roleCode: mock.roleCode,
      canCreateProjects: true,
    },
    client: {},
    user: { id: "user-ada" },
  }),
}));
// The account's runtime: no platform command is answered here.
vi.mock("./zeropsDataContext", () => ({
  useZeropsData: () => ({
    organizationRef: (organizationId: string) => ({ organizationId }),
    projectRef: (organizationId: string, projectId: string) => ({ organizationId, projectId }),
    runtime: {
      commands: {},
      reads: { setupMarker: () => null },
      cells: { known: () => null },
    },
  }),
  runZeropsCommand: (command: Promise<unknown>) => command,
  // The organization's token list, not read: no key here reads as unhardened.
  useKnown: () => ({ state: "unread" }),
  // The press's marker on each container, as the case states it: absent unless it says.
  useZeropsAtomSelections: (selections: ReadonlyArray<readonly [string, unknown]>) =>
    new Map(selections.map(([serviceId]) => [serviceId, mock.markers.get(serviceId) ?? false])),
}));
vi.mock("./useZeropsCandidates", () => ({
  useZeropsCandidates: () => ({ listing: mock.listing.current, refresh: () => {} }),
  useTakenBotNames: () => ({ names: [], complete: true }),
}));
vi.mock("@tanstack/react-router", () => ({
  useRouter: () => ({ state: { matches: [] }, navigate: () => {} }),
}));
vi.mock("./useOpenMate", () => ({ useOpenMate: () => () => {} }));
vi.mock("../routes/-environmentTargets", () => ({
  useEnvironmentLinks: () => ({ linkTarget: () => undefined }),
}));
vi.mock("./inventoryContext", async () => {
  const { useState } = await import("react");
  return { useProjectDialog: () => useState(null) };
});
vi.mock("./useZeropsMateOwners", () => ({
  useZeropsOrganizationMembers: () => [],
  zeropsMateOwner: () => undefined,
}));
// The organization's official HQ, where a Mate's face is written.
vi.mock("./accountHq", async (original) => ({
  officialHq: (await original<typeof import("./accountHq")>()).officialHq,
  useAccountHq: () => ({
    status: "ready",
    hq: { kind: "official", projectId: "p-hq", address: "https://hq.example.test" },
    admins: [],
    reread: () => {},
  }),
  accountHqApi: () => ({ updateMate: mock.updateMate }),
}));
vi.mock("./projectOrderPreference", () => ({ useProjectOrderOptions: () => ({ order: "name" }) }));
// The dialog as the hook mounts it: what it is handed, and the two answers it gives.
vi.mock("../components/zerops/ZeropsChangeFaceDialog", () => ({
  ZeropsChangeFaceDialog: (props: FaceDialogProps) => {
    mock.dialog.current = props;
    return null;
  },
}));

/** A Mate of Acme Docs as HQ places it, wearing `face` as HQ records it ("" where none was picked). */
function mate(
  bot: string,
  tags: ReadonlyArray<string> = [],
  face = "",
): ZeropsCandidatePresentation {
  const id = `acme-docs-${bot.toLowerCase()}`;
  const hq: HqPlacement = {
    appId: "acme",
    appName: "Acme Docs",
    kind: "mate",
    mate: { name: bot, face },
  };
  return {
    key: `${id}:zcp`,
    group: "connected",
    presence: "known",
    environmentId: EnvironmentId.make(`env-${id}`),
    project: {
      id,
      name: `Acme Docs - ${bot}`,
      status: "ACTIVE",
      clientId: "org-acme",
      tagList: ["mate", ...tags],
      hq,
    },
    service: { id: `zcp-${id}`, name: "zcp", status: "ACTIVE" },
  } as ZeropsCandidatePresentation;
}

const FEN = mate("Fen");
const QUINN = mate("Quinn", [], "coral:gem");

/** Every value the hook handed back, the latest last. */
const seen: Array<MateActions> = [];
const actions = () => seen.at(-1)!;
function Probe() {
  const handed = useMateActions({
    registry: { registry: { groups: [] } },
    serverVersions: new Map(),
  });
  seen.push(handed);
  return <>{handed.dialogs}</>;
}

const mounted: ReactTestRenderer[] = [];
beforeEach(() => {
  openAccountLifetime("user-ada");
  mock.roleCode = "OWNER";
  mock.markers.clear();
  mock.dialog.current = null;
  mock.updateMate.mockReset();
  seen.length = 0;
  mock.listing.current = {
    state: "known",
    value: [FEN, QUINN],
    asOf: { ordinal: 1, atMs: 1_000 },
    coverage: "complete",
    freshness: { kind: "live" },
  };
});
afterEach(() => {
  for (const tree of mounted.splice(0)) {
    act(() => {
      tree.unmount();
    });
  }
  closeAccountLifetime();
});

function mount(): void {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  act(() => {
    mounted.push(create(<Probe />));
  });
}

const verbs = (candidate: ZeropsCandidatePresentation) =>
  actions()
    .actionsFor(candidate, { mate: true, groupId: "acme", role: "dev" } as never)
    .filter((entry): entry is ZeropsMenuAction => !("separator" in entry));

function openFace(candidate: ZeropsCandidatePresentation): void {
  const entry = verbs(candidate).find((verb) => verb.id === "face");
  act(() => {
    entry!.onSelect();
  });
}

describe("useMateActions — Change face…", () => {
  it.each([
    { who: "an org owner", role: "OWNER", offered: true },
    { who: "an org admin", role: "ADMIN", offered: true },
    { who: "a member on a colleague's Mate", role: "BASIC_USER", offered: false },
    { who: "a read-only member", role: "READ_ONLY", offered: false },
  ])("$who: offered $offered, right after Rename Mate as Rename is", ({ role, offered }) => {
    mock.roleCode = role;
    mount();
    const ids = verbs(FEN).map((verb) => verb.id);
    expect(ids.includes("face")).toBe(offered);
    expect(ids.includes("rename-agent")).toBe(offered);
    if (offered) {
      expect(ids.indexOf("face")).toBe(ids.indexOf("rename-agent") + 1);
      expect(verbs(FEN).find((verb) => verb.id === "face")?.label).toBe("Change face…");
    }
    expect(actions().changeFace(FEN) !== undefined).toBe(offered);
  });

  it.each([
    {
      who: "a Mate wearing its name's tint",
      candidate: FEN,
      face: { tint: "sand", shape: "seal" },
    },
    {
      who: "a Mate whose face was picked",
      candidate: QUINN,
      face: { tint: "coral", shape: "gem" },
    },
  ])("opens its dialog on the face $who wears", ({ candidate, face }) => {
    mount();
    openFace(candidate);
    expect(mock.dialog.current).toMatchObject({ face, pending: false, error: null });
  });

  it("saves to HQ in one write, and closes once HQ takes it", async () => {
    let answer: (value: unknown) => void = () => {};
    mock.updateMate.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    mount();
    openFace(FEN);
    expect(mock.dialog.current).toMatchObject({ open: true });
    await act(async () => {
      mock.dialog.current!.onSave({ tint: "rose", shape: "seal" });
    });
    // Fen wore its name's tint: its name keeps its place among the names the tints are shared
    // out over (`changedMateFace`).
    expect(mock.updateMate).toHaveBeenCalledWith(FEN.project.id, { face: "rose:seal:named" });
    expect(mock.dialog.current).toMatchObject({ open: true, pending: true, error: null });
    await act(async () => {
      answer(undefined);
    });
    // It closes the way a dialog does, fading over the face it saved, still saying Saving…
    expect(mock.dialog.current).toMatchObject({ open: false, pending: true });
    act(() => {
      mock.dialog.current!.onOpenChangeComplete(false);
    });
    mock.dialog.current = null;
    act(() => {
      mounted[0]!.update(<Probe />);
    });
    expect(mock.dialog.current).toBeNull();
  });

  it("closes the way a dialog does on Cancel too, and then is gone", () => {
    mount();
    openFace(FEN);
    act(() => {
      mock.dialog.current!.onCancel();
    });
    expect(mock.dialog.current).toMatchObject({ open: false, pending: false });
    act(() => {
      mock.dialog.current!.onOpenChangeComplete(false);
    });
    mock.dialog.current = null;
    act(() => {
      mounted[0]!.update(<Probe />);
    });
    expect(mock.dialog.current).toBeNull();
    expect(mock.updateMate).not.toHaveBeenCalled();
  });

  it("says a refused write's reason in the dialog, and changes nothing else", async () => {
    mock.updateMate.mockRejectedValue(new Error("HQ refused the change (forbidden)."));
    mount();
    openFace(FEN);
    await act(async () => {
      mock.dialog.current!.onSave({ tint: "rose", shape: "seal" });
    });
    expect(mock.dialog.current).toMatchObject({
      open: true,
      pending: false,
      error: "HQ refused the change (forbidden).",
    });
    expect(mock.updateMate).toHaveBeenCalledTimes(1);
    expect(actions().trouble).toBeNull();
  });
});

// A Mate its press left open — marker present, no mate:closed-off, past the grace — is finished by
// whoever may: an owner or an admin, or, for its close-off, the member who added it. Read off the
// store's markers, so a reload keeps it (pass 28 review).
describe("useMateActions — Finish setup on a Mate its press left open", () => {
  const LONG_AGO = "2026-09-01T10:00:00Z";
  const left = (made: { readonly by?: string; readonly container?: boolean } = {}) => {
    const base = mate("Ivo", made.by === undefined ? [] : [`mate:standup:${made.by}`]);
    const { service, ...rest } = base;
    return {
      ...rest,
      group: "ready",
      project: { ...base.project, created: LONG_AGO },
      ...(made.container === false ? {} : { service }),
    } as ZeropsCandidatePresentation;
  };
  const offered = (candidate: ZeropsCandidatePresentation) =>
    verbs(candidate).some((verb) => verb.id === "finish-setup");
  const listing = (candidate: ZeropsCandidatePresentation) => {
    mock.listing.current = {
      state: "known",
      value: [candidate],
      asOf: { ordinal: 1, atMs: 1_000 },
      coverage: "complete",
      freshness: { kind: "live" },
    };
  };

  it.each([
    { who: "an owner", role: "OWNER", by: "user-eva", container: true, want: true },
    {
      who: "the member who added it",
      role: "BASIC_USER",
      by: "user-ada",
      container: true,
      want: true,
    },
    { who: "another member", role: "BASIC_USER", by: "user-eva", container: true, want: false },
    // Nothing for a close-off to finish: an owner or an admin makes its container.
    {
      who: "the member who added it, with no container",
      role: "BASIC_USER",
      by: "user-ada",
      container: false,
      want: false,
    },
  ])("$who: offered $want", ({ role, by, container, want }) => {
    mock.roleCode = role;
    const candidate = left({ by, container });
    if (candidate.service !== undefined) mock.markers.set(candidate.service.id, true);
    listing(candidate);
    mount();
    expect(offered(candidate)).toBe(want);
  });

  it("offers nothing where the marker reads absent: an older Mate, made before the press", () => {
    mock.roleCode = "BASIC_USER";
    const candidate = left({ by: "user-ada" });
    listing(candidate);
    mount();
    expect(offered(candidate)).toBe(false);
  });
});
