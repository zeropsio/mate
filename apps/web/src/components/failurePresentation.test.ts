import { describe, expect, it } from "vite-plus/test";
import type {
  FilesystemBrowseResult,
  VcsListRefsResult,
  VcsStatusResult,
} from "@t3tools/contracts";
import { baseRefPresentation } from "./DiffPanel.logic";
import { changedFilesPresentation } from "./GitActionsControl.logic";
import { folderListingPresentation } from "./CommandPalette.logic";

const read = <A>(data: A | null, error: string | null = null, isPending = false) => ({
  data,
  error,
  isPending,
  refresh: () => {},
});
const localRef = { name: "main", current: false, isDefault: true, worktreePath: null };
const refs: VcsListRefsResult = {
  refs: [],
  totalCount: 0,
  isRepo: true,
  hasPrimaryRemote: true,
  nextCursor: null,
};

describe("DiffPanel ref reads", () => {
  it.each([
    {
      source: "local",
      local: read<VcsListRefsResult>(null, "Local refs refused."),
      remote: read(refs),
      message: "Local refs refused.",
    },
    {
      source: "remote",
      local: read(refs),
      remote: read<VcsListRefsResult>(null, "Remote refs refused."),
      message: "Remote refs refused.",
    },
    {
      source: "loading",
      local: read<VcsListRefsResult>(null, null, true),
      remote: read(refs),
      message: "Loading refs...",
    },
    {
      source: "one failure with other source retained",
      expectedChoices: ["origin/main"],
      local: read<VcsListRefsResult>(null, "Local refs refused."),
      remote: read({
        ...refs,
        refs: [{ ...localRef, name: "origin/main", remoteName: "origin", isRemote: true }],
      }),
      message: "Local refs refused.",
    },
    {
      source: "retained after failure",
      expectedChoices: ["main"],
      local: read({ ...refs, refs: [localRef] }, "Local refs refused."),
      remote: read(refs),
      message: "Local refs refused.",
    },
    { source: "empty", local: read(refs), remote: read(refs), message: null },
  ])(
    "distinguishes $source from matching no refs",
    ({ local, remote, message, expectedChoices }) => {
      const shown = baseRefPresentation(local, remote);
      expect(shown.message).toBe(message);
      expect(shown.emptyMessage).toBe(message === null ? "No matching refs." : null);
      expect(shown.choices.map((choice) => choice.label)).toEqual(expectedChoices ?? []);
    },
  );
});

describe("GitActionsControl changed-files read", () => {
  it.each([
    {
      name: "failed",
      data: null,
      error: "Status refused.",
      pending: false,
      message: "Status refused.",
      empty: null,
    },
    {
      name: "loading",
      data: null,
      error: null,
      pending: true,
      message: "Loading changed files...",
      empty: null,
    },
    {
      name: "unavailable",
      data: null,
      error: null,
      pending: false,
      message: "Changed files unavailable.",
      empty: null,
    },
    {
      name: "empty",
      data: { workingTree: { files: [] } },
      error: null,
      pending: false,
      message: null,
      empty: "none",
    },
    {
      name: "retained empty after failure",
      data: { workingTree: { files: [] } },
      error: "Status refused.",
      pending: false,
      message: "Status refused.",
      empty: null,
    },
  ])("distinguishes $name from no changed files", ({ data, error, pending, message, empty }) => {
    const shown = changedFilesPresentation(read(data as VcsStatusResult | null, error, pending));
    expect(shown.message).toBe(message);
    expect(shown.emptyMessage).toBe(empty);
  });
});

describe("CommandPalette folder discovery", () => {
  it.each([
    {
      name: "failed",
      data: null,
      error: "Listing refused.",
      pending: false,
      message: "Listing refused.",
      create: false,
    },
    {
      name: "loading",
      data: null,
      error: null,
      pending: true,
      message: "Loading folders...",
      create: false,
    },
    {
      name: "unavailable",
      data: null,
      error: null,
      pending: false,
      message: "Folder listing unavailable.",
      create: false,
    },
    {
      name: "empty",
      data: { entries: [], parentPath: "/work" },
      error: null,
      pending: false,
      message: null,
      create: true,
    },
    {
      name: "retained after failure",
      data: { entries: [], parentPath: "/work" },
      error: "Listing refused.",
      pending: false,
      message: "Listing refused.",
      create: false,
    },
  ])(
    "distinguishes $name before suggesting folder creation",
    ({ data, error, pending, message, create }) => {
      const shown = folderListingPresentation(
        read(data as FilesystemBrowseResult | null, error, pending),
      );
      expect(shown.message).toBe(message);
      expect(shown.canInferCreation).toBe(create);
    },
  );
});
