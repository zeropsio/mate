/**
 * *Change face…* as `useMateActions` offers it, wherever a Mate is listed: beside Rename, where
 * the viewer may rename the Mate; its dialog opening on the face the Mate wears; a save that is
 * the tag writer's one patch, closing once the platform takes it; and a refusal said in the
 * dialog, nothing else changed.
 */
import type { ZeropsMateFace } from "@t3tools/client-runtime/zerops";
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
  updateProjectTags: vi.fn(),
  roleCode: "OWNER",
  listing: { current: undefined as unknown },
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
// The account's runtime: the one tag command, a command here being the promise the test answers.
vi.mock("./zeropsDataContext", () => ({
  useZeropsData: () => ({
    organizationRef: (organizationId: string) => ({ organizationId }),
    projectRef: (organizationId: string, projectId: string) => ({ organizationId, projectId }),
    runtime: { commands: { updateProjectTags: mock.updateProjectTags } },
  }),
  runZeropsCommand: (command: Promise<unknown>) => command,
}));
vi.mock("./useZeropsCandidates", () => ({
  useZeropsCandidates: () => ({ listing: mock.listing.current, refresh: () => {} }),
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
vi.mock("./giteaProject", () => ({ useAccountGitea: () => undefined }));
vi.mock("./projectOrderPreference", () => ({ useProjectOrderOptions: () => ({ order: "name" }) }));
// The dialog as the hook mounts it: what it is handed, and the two answers it gives.
vi.mock("../components/zerops/ZeropsChangeFaceDialog", () => ({
  ZeropsChangeFaceDialog: (props: FaceDialogProps) => {
    mock.dialog.current = props;
    return null;
  },
}));

function mate(bot: string, tags: ReadonlyArray<string> = []): ZeropsCandidatePresentation {
  const id = `acme-docs-${bot.toLowerCase()}`;
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
      tagList: ["mate", "mate:g:acme", "mate:role:dev", `mate:bot:${bot}`, ...tags],
    },
    service: { id: `zcp-${id}`, name: "zcp", status: "ACTIVE" },
  } as ZeropsCandidatePresentation;
}

const FEN = mate("Fen");
const QUINN = mate("Quinn", ["mate:face:coral:gem"]);

/** Every value the hook handed back, the latest last. */
const seen: Array<MateActions> = [];
const actions = () => seen.at(-1)!;
function Probe() {
  const handed = useMateActions({
    registry: { registry: { groups: [], leaving: [], other: [] }, refresh: () => {} },
    serverVersions: new Map(),
  });
  seen.push(handed);
  return <>{handed.dialogs}</>;
}

const mounted: ReactTestRenderer[] = [];
beforeEach(() => {
  openAccountLifetime("user-ada");
  mock.roleCode = "OWNER";
  mock.dialog.current = null;
  mock.updateProjectTags.mockReset();
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

  it("saves through the tag writer's one patch, and closes once the platform takes it", async () => {
    let answer: (value: unknown) => void = () => {};
    mock.updateProjectTags.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    mount();
    openFace(FEN);
    expect(mock.dialog.current).toMatchObject({ open: true });
    act(() => {
      mock.dialog.current!.onSave({ tint: "rose", shape: "seal" });
    });
    expect(mock.updateProjectTags).toHaveBeenCalledWith(
      { organizationId: "org-acme", projectId: FEN.project.id },
      { kind: "mate-face", face: { tint: "rose", shape: "seal" } },
    );
    expect(mock.dialog.current).toMatchObject({ open: true, pending: true, error: null });
    await act(async () => {
      answer({ kind: "written" });
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
    expect(mock.updateProjectTags).not.toHaveBeenCalled();
  });

  it("says a refused write's reason in the dialog, and changes nothing else", async () => {
    mock.updateProjectTags.mockRejectedValue({
      _tag: "ZeropsDataAdapterError",
      kind: "rejected",
      message: "Zerops rejected the request (forbidden).",
    });
    mount();
    openFace(FEN);
    await act(async () => {
      mock.dialog.current!.onSave({ tint: "rose", shape: "seal" });
    });
    expect(mock.dialog.current).toMatchObject({
      open: true,
      pending: false,
      error: "Zerops rejected the request (forbidden).",
    });
    expect(mock.updateProjectTags).toHaveBeenCalledTimes(1);
    expect(actions().trouble).toBeNull();
  });
});
