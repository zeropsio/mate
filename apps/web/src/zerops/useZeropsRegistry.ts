/**
 * The account's registry, as the store holds it.
 *
 * The registry is the tags on the account's Gitea project (`groupRegistry.ts`, D3): which groups
 * exist, what each one's Gitea org is called, and which projects belong to them. That project is
 * in the inventory like any other, and the org's socket keeps its tags live — so the registry is
 * derived from it, never read: a group another tab or another person names is here within the
 * push, and a write's own read-back enters the store before its command settles
 * (`data/restAdapter.ts`), so a writer sees what it wrote at once.
 *
 * An account with no Gitea has no registry: that is the empty one, not a failure. Not knowing yet
 * — no Gitea project while the inventory is still being read — is loading, never the empty
 * registry settled, which would drop every group from the tree. The inventory loses a project for
 * a moment whenever its socket is replaced: the registry last derived stands through that blink
 * (`heldThroughBlink.ts`), and never in another organization, which a switch leaves behind.
 */

import {
  parseZeropsRegistry,
  readZeropsToolKind,
  type ZeropsProject,
  type ZeropsRegistry,
} from "@t3tools/client-runtime/zerops";
import { useContext, useMemo } from "react";

import { useHeldThroughBlink } from "./heldThroughBlink";
import { HeldInventoryContext, InventoryContext } from "./inventoryContext";

const EMPTY: ZeropsRegistry = { groups: [], leaving: [], other: [] };

export interface ZeropsRegistryState {
  readonly registry: ZeropsRegistry;
  /** True while there is no Gitea project to read it from and the inventory is still read. */
  readonly loading: boolean;
}

/** The account's Gitea project in the organization, as held — withheld or not, services or not. */
export function findRegistryProject(
  projects: ReadonlyArray<ZeropsProject>,
  clientId: string | undefined,
): ZeropsProject | undefined {
  return projects.find(
    (project) =>
      readZeropsToolKind(project.tagList) === "gitea" &&
      (clientId === undefined || project.clientId === clientId),
  );
}

/** The registry of the organization `clientId`, from the inventory as held. */
export function useZeropsRegistry(clientId: string | undefined): ZeropsRegistryState {
  const held = useContext(HeldInventoryContext);
  const loadingInventory = useContext(InventoryContext)?.isLoading ?? false;
  const tags = useMemo(() => {
    const project = held === null ? undefined : findRegistryProject(held.projects, clientId);
    // A slug is `[a-z][a-z0-9-]*` and no tag holds a line break, so the key is unambiguous; it
    // keeps the registry the same object across every push that did not touch these tags.
    return project === undefined ? undefined : (project.tagList ?? []).join("\n");
  }, [clientId, held]);
  const found = useMemo(
    () =>
      tags === undefined ? undefined : parseZeropsRegistry(tags === "" ? [] : tags.split("\n")),
    [tags],
  );
  // No inventory at all is no scope — signed out — and holds nothing.
  const registry = useHeldThroughBlink(found, held === null ? undefined : (clientId ?? ""));
  return useMemo(
    () =>
      registry === undefined
        ? { registry: EMPTY, loading: held !== null && loadingInventory }
        : { registry, loading: false },
    [held, loadingInventory, registry],
  );
}

/** The Gitea org a group is registered under, or `undefined` while it is not. */
export function registryGroupSlug(
  registry: ZeropsRegistry,
  groupId: string | undefined,
): string | undefined {
  if (groupId === undefined) return undefined;
  return registry.groups.find((group) => group.groupId === groupId)?.slug;
}
