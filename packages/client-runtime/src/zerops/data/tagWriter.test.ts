import { describe, expect, it } from "vite-plus/test";

import { ZeropsApiClient, type ZeropsProject } from "../api.ts";
import { makeHarnessBrowser } from "../testing/browserTabs.ts";
import { makeFakeZeropsRest } from "../testing/fakeZeropsRest.ts";
import { makeProjectTagWriter, type ProjectTagSource } from "./tagWriter.ts";

/**
 * One project on a platform with no conditional PUT: a write replaces the tag list wholesale.
 * `between` runs another device's write at a named point of ours.
 */
function platform(
  tags: ReadonlyArray<string>,
  between: {
    readonly beforeRead?: (tags: ReadonlyArray<string>) => ReadonlyArray<string>;
    readonly afterWrite?: (tags: ReadonlyArray<string>) => ReadonlyArray<string>;
  } = {},
) {
  let project: ZeropsProject = { id: "p1", name: "One", status: "ACTIVE", tagList: tags };
  const log: Array<string> = [];
  let beforeRead = between.beforeRead;
  let afterWrite = between.afterWrite;
  let before: ReadonlyArray<string> = tags;
  const source: ProjectTagSource = {
    fetchProject: async () => {
      if (beforeRead !== undefined) {
        project = { ...project, tagList: beforeRead(project.tagList ?? []) };
        beforeRead = undefined;
      }
      log.push("GET");
      return project;
    },
    writeProjectTags: async (_read, tagList) => {
      log.push("PUT");
      before = project.tagList ?? [];
      project = { ...project, tagList };
      if (afterWrite !== undefined) {
        // Another device read before our write landed, and writes its whole list after it.
        project = { ...project, tagList: afterWrite(before) };
        afterWrite = undefined;
      }
      return { ...project, tagList };
    },
  };
  return { source, log, tags: () => project.tagList ?? [] };
}

describe("updateProjectTags' writer", () => {
  it.each([
    {
      when: "it wrote after the list our caller last saw",
      between: { beforeRead: (tags: ReadonlyArray<string>) => [...tags, "theirs"] },
      requests: ["GET", "PUT", "GET"],
    },
    {
      when: "its whole list replaced ours after our write",
      between: { afterWrite: (tags: ReadonlyArray<string>) => [...tags, "theirs"] },
      requests: ["GET", "PUT", "GET", "PUT", "GET"],
    },
  ])("a concurrent writer's change survives our patch when $when", async (row) => {
    const rest = platform(["mate:tool:gitea"], row.between);
    const writer = makeProjectTagWriter({ source: rest.source });

    const written = await writer.write("p1", { kind: "agent-name", name: "Vera" });

    expect(written.kind).toBe("written");
    expect(rest.tags()).toEqual(
      expect.arrayContaining(["mate:tool:gitea", "theirs", "mate:bot:Vera", "mate"]),
    );
    expect(rest.log).toEqual(row.requests);
  });

  it("a face changed puts back every tag the platform holds, and only its face changes", async () => {
    const held = [
      "mate:g:g1",
      "mate:role:dev",
      "mate:bot:Ada",
      "mate",
      "mate:face:coral:gem",
      "person:own",
    ];
    const rest = platform(held, {
      beforeRead: (tags: ReadonlyArray<string>) => [...tags, "theirs"],
    });
    const writer = makeProjectTagWriter({ source: rest.source });

    const written = await writer.write("p1", {
      kind: "mate-face",
      face: { tint: "sky", shape: "seal" },
    });

    expect(written.kind).toBe("written");
    expect([...rest.tags()].sort()).toEqual(
      [
        ...held.filter((tag) => tag !== "mate:face:coral:gem"),
        "theirs",
        "mate:face:sky:seal",
      ].sort(),
    );
    expect(rest.log).toEqual(["GET", "PUT", "GET"]);
  });

  it("a patch the project already holds costs a read and writes nothing", async () => {
    const rest = platform(["mate:bot:Vera", "mate"]);
    const writer = makeProjectTagWriter({ source: rest.source });

    const written = await writer.write("p1", { kind: "agent-name", name: "Vera" });

    expect(written.kind).toBe("unchanged");
    expect(rest.log).toEqual(["GET"]);
  });

  it("gives up once other writers replaced its list every time, and says so", async () => {
    const rest = platform([]);
    const replaced: ProjectTagSource = {
      ...rest.source,
      // Every write lands and is at once replaced by a list without it.
      writeProjectTags: async (project) => project,
    };
    const writer = makeProjectTagWriter({ source: replaced });

    await expect(writer.write("p1", { kind: "agent-name", name: "Vera" })).rejects.toMatchObject({
      _tag: "ZeropsDataAdapterError",
      kind: "rejected",
      retryable: true,
    });
    expect(rest.log).toEqual(["GET", "GET", "GET", "GET"]);
  });

  it("one page serializes its own writes to a project with no locks at all", async () => {
    const rest = platform([]);
    const writer = makeProjectTagWriter({ source: rest.source });

    await Promise.all([
      writer.write("p1", { kind: "agent-signer", agentId: "codex", userId: "u1" }),
      writer.write("p1", { kind: "agent-name", name: "Vera" }),
    ]);

    expect(rest.tags()).toEqual(
      expect.arrayContaining(["mate:signer:codex:u1", "mate:bot:Vera", "mate"]),
    );
    expect(rest.log).toEqual(["GET", "PUT", "GET", "GET", "PUT", "GET"]);
  });

  it("two tabs write different tags to one project; neither is lost", async () => {
    const rest = makeFakeZeropsRest();
    rest.addUser({
      user: {
        id: "user-1",
        email: "person@example.test",
        clientUserList: [{ id: "cu-1", clientId: "org-1", roleCode: "OWNER" }],
      },
      password: "secret",
    });
    rest.addProject({
      id: "p1",
      clientId: "org-1",
      name: "Acme - Vera",
      status: "ACTIVE",
      tagList: ["person:own"],
    });
    const browser = makeHarnessBrowser();
    const writerIn = (tab: ReturnType<typeof browser.openTab>) => {
      const client = new ZeropsApiClient({ fetch: rest.fetchFor(tab) });
      client.restoreSession(rest.issueSession("user-1"));
      return makeProjectTagWriter({ source: client, locks: tab.locks });
    };
    const first = browser.openTab();
    const second = browser.openTab();

    const [named, signed] = await Promise.all([
      writerIn(first).write("p1", { kind: "agent-name", name: "Vera" }),
      writerIn(second).write("p1", { kind: "agent-signer", agentId: "codex", userId: "u1" }),
    ]);

    expect([named.kind, signed.kind]).toEqual(["written", "written"]);
    expect(rest.project("p1")?.tagList).toEqual(
      expect.arrayContaining(["person:own", "mate:bot:Vera", "mate", "mate:signer:codex:u1"]),
    );
    // One tab's read, write and read-back, then the other's: never interleaved.
    expect(rest.requests().map(({ route, tab }) => `${tab} ${route}`)).toEqual([
      `${first.id} GET /project/p1`,
      `${first.id} PUT /project/p1`,
      `${first.id} GET /project/p1`,
      `${second.id} GET /project/p1`,
      `${second.id} PUT /project/p1`,
      `${second.id} GET /project/p1`,
    ]);
  });
});
