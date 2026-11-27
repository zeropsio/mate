import { expect, it } from "vite-plus/test";
import type { RepoListEntry } from "@t3tools/shared/hqChanges";
import {
  deleteFromMateKeeps,
  repositoryUpkeep,
  repositoryUpkeepGroups,
  type RepoRowActions,
  type RepositoryUpkeepEntry,
} from "./github/repoUpkeep.logic";

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
it("MN82: A repository's upkeep menu offers each verb only to who may change remotes and only where the repository's remote makes it mean something, the storage limit to who may set it, and Delete to whom HQ allows it, and is absent when nothing is offered; breaks: a person who may not change remotes is offered Disconnect, or a repository with no remote has no way to be connected from its page", () => {
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

// witness: apps/web/src/components/zerops/github/repoUpkeep.logic.ts | .filter((group) => group.length > 0) → .map((group) => group)
it("MN90: A repository's menu groups what it offers as the way out to its host, the remote's verbs, the storage limit and Delete, in that order, and holds no group nothing is offered in; breaks: a separator stands at the menu's start or end, or Delete stands among the remote's verbs", () => {
  const rows: Array<{ entries: RepositoryUpkeepEntry[]; groups: RepositoryUpkeepEntry[][] }> = [
    {
      entries: ["open", "change", "token", "disconnect", "limit", "delete"],
      groups: [["open"], ["change", "token", "disconnect"], ["limit"], ["delete"]],
    },
    { entries: ["connect", "delete"], groups: [["connect"], ["delete"]] },
    { entries: ["open"], groups: [["open"]] },
    { entries: ["limit"], groups: [["limit"]] },
    { entries: [], groups: [] },
    { entries: ["change", "unfollow", "limit"], groups: [["change", "unfollow"], ["limit"]] },
  ];
  for (const { entries, groups } of rows) expect(repositoryUpkeepGroups(entries)).toEqual(groups);
});

// witness: apps/web/src/components/zerops/github/repoUpkeep.logic.ts | return `${destination.label} on ${hostWords(url)} stays as it is.`; → return `${destination.label} on GitHub stays as it is.`;
it("MN139: A repository's Delete says what stays on the host of the remote HQ records for it, or of the one it follows, and nothing where its code goes nowhere; breaks: a GitLab repository's Delete says it stays on GitHub.", () => {
  const lab = { label: "gitlab.com/acme/code", href: "https://gitlab.com/acme/code" };
  const rows = [
    {
      repo: { remote: token },
      destination: lab,
      keeps: "gitlab.com/acme/code on GitLab stays as it is.",
    },
    { repo: { remote }, destination, keeps: "acme/code on GitHub stays as it is." },
    {
      repo: { remote: null, follows: "https://git.example.org/octo/lab.git" },
      destination: { label: "git.example.org/octo/lab", href: "https://git.example.org/octo/lab" },
      keeps: "git.example.org/octo/lab on git.example.org stays as it is.",
    },
    { repo: { remote: null }, destination: null, keeps: null },
  ];
  for (const { repo, destination: to, keeps } of rows)
    expect(deleteFromMateKeeps(repo, to)).toBe(keeps);
});
