import { expect, it } from "vite-plus/test";
import type { RepoListEntry } from "@t3tools/shared/hqChanges";
import { repositoryUpkeep, type RepoRowActions } from "./github/repoUpkeep.logic";

const remote = {
  url: "https://github.com/acme/code.git",
  repositoryId: "7",
  keptAt: "2026-11-01T00:00:00Z",
  keptBy: "Alex",
  expiresAt: null,
  invalidSince: null,
  via: "app",
  githubAppId: 1,
} satisfies NonNullable<RepoListEntry["remote"]>;
const token = {
  ...remote,
  via: "token",
  githubAppId: null,
  url: "https://gitlab.com/acme/code.git",
} as const;
const destination = { label: "acme/code", href: "https://github.com/acme/code" };
const actions: RepoRowActions = {
  sendDisconnect: async () => {},
  replaceToken: async () => ({ ok: false, reason: "refused" }),
  unfollow: async () => {},
  deleteRepository: async () => {},
};

// witness: apps/web/src/components/zerops/github/repoUpkeep.logic.ts | writes && press === null && remote != null && actions.sendDisconnect !== undefined → press === null && remote != null && actions.sendDisconnect !== undefined
it("MN+1: A repository's upkeep menu offers each verb only to who may change remotes and only where the repository's remote makes it mean something, the storage limit to who may set it, and Delete to whom HQ allows it, and is absent when nothing is offered; breaks: a person who may not change remotes is offered Disconnect, or a repository with no remote has no way to be connected from its page", () => {
  const rows: Array<{ input: Parameters<typeof repositoryUpkeep>[0]; entries: string[] }> = [
    {
      input: {
        remote: null,
        follows: undefined,
        canDelete: { allow: true },
        destination: null,
        writes: true,
        press: null,
        actions,
        limit: true,
      },
      entries: ["connect", "limit", "delete"],
    },
    {
      input: {
        remote: null,
        follows: "https://github.com/acme/code",
        canDelete: { allow: true },
        destination,
        writes: true,
        press: null,
        actions,
        limit: true,
      },
      entries: ["change", "unfollow", "limit", "delete"],
    },
    {
      input: {
        remote,
        follows: undefined,
        canDelete: { allow: false, reason: "in_use:remote" },
        destination,
        writes: true,
        press: null,
        actions,
        limit: true,
      },
      entries: ["open", "change", "disconnect", "limit"],
    },
    {
      input: {
        remote: token,
        follows: undefined,
        canDelete: undefined,
        destination: { label: "gitlab.com/acme/code", href: "https://gitlab.com/acme/code" },
        writes: true,
        press: null,
        actions,
        limit: true,
      },
      entries: ["open", "change", "token", "disconnect", "limit"],
    },
    {
      input: {
        remote: token,
        follows: undefined,
        canDelete: { allow: true },
        destination,
        writes: true,
        press: "disconnecting",
        actions,
        limit: true,
      },
      entries: ["open", "limit", "delete"],
    },
    {
      input: {
        remote,
        follows: undefined,
        canDelete: undefined,
        destination,
        writes: false,
        press: null,
        actions,
        limit: false,
      },
      entries: ["open"],
    },
    {
      input: {
        remote: null,
        follows: undefined,
        canDelete: undefined,
        destination: null,
        writes: false,
        press: null,
        actions,
        limit: false,
      },
      entries: [],
    },
    {
      input: {
        remote: null,
        follows: undefined,
        canDelete: { allow: true },
        destination: null,
        writes: true,
        press: null,
        actions: { deleteRepository: async () => {} },
        limit: false,
      },
      entries: ["connect", "delete"],
    },
  ];
  for (const { input, entries } of rows) expect(repositoryUpkeep(input)).toEqual(entries);
});
