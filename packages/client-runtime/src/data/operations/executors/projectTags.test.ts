import { describe, expect, it } from "vite-plus/test";

import { ZeropsApiClient, type ZeropsProject } from "../../../zerops/api.ts";
import { makeHarnessBrowser } from "../../../zerops/testing/browserTabs.ts";
import { makeFakeZeropsRest } from "../../../zerops/testing/fakeZeropsRest.ts";
import { makeProjectTagWriter, type ProjectTagSource } from "./projectTags.ts";

/**
 * One project on a platform with no conditional PUT: a write replaces its record — its name and its
 * tag list — wholesale. `between` runs another device's write at a named point of ours.
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
    writeProject: async (read, record) => {
      log.push("PUT");
      before = project.tagList ?? [];
      project = { ...project, ...record };
      if (afterWrite !== undefined) {
        // Another device read before our write landed, and writes its whole record after it.
        project = { ...project, name: read.name, tagList: afterWrite(before) };
        afterWrite = undefined;
      }
      return { ...project, ...record };
    },
  };
  return { source, log, tags: () => project.tagList ?? [], name: () => project.name };
}

describe("updateProjectTags' writer", () => {
  // Set up Mate on a plain project: the marker is added to the tags a fresh read holds at the
  // moment of the write — the owner's own and another writer's kept — and only the obsolete
  // metadata tags go.
  it("adds the Mate marker to a fresh project read, keeping the project's own tags", async () => {
    const rest = platform(["mate:face:rose:seal", "person:own"], {
      beforeRead: (tags) => [...tags, "theirs"],
    });
    const writer = makeProjectTagWriter({ source: rest.source });
    expect((await writer.write("p1", { kind: "mate" })).kind).toBe("written");
    expect(rest.tags()).toEqual(["person:own", "theirs", "mate"]);
    expect(rest.log).toEqual(["GET", "PUT", "GET"]);
  });

  it("a concurrent replacement fails visibly after one write", async () => {
    const rest = platform([], { afterWrite: () => ["theirs"] });
    const writer = makeProjectTagWriter({ source: rest.source });
    await expect(writer.write("p1", { kind: "mate" })).rejects.toMatchObject({ kind: "rejected" });
    expect(rest.log).toEqual(["GET", "PUT", "GET"]);
  });

  it("a patch the project already holds costs a read and writes nothing", async () => {
    const rest = platform(["mate"]);
    const writer = makeProjectTagWriter({ source: rest.source });

    const written = await writer.write("p1", { kind: "mate" });

    expect(written.kind).toBe("unchanged");
    expect(rest.log).toEqual(["GET"]);
  });

  it("gives up once other writers replaced its list every time, and says so", async () => {
    const rest = platform([]);
    const replaced: ProjectTagSource = {
      ...rest.source,
      // Every write lands and is at once replaced by a record without it.
      writeProject: async (project) => project,
    };
    const writer = makeProjectTagWriter({ source: replaced });

    await expect(writer.write("p1", { kind: "mate" })).rejects.toMatchObject({
      _tag: "ZeropsProjectTagWriteError",
      kind: "rejected",
      retryable: true,
    });
    expect(rest.log).toEqual(["GET", "GET"]);
  });

  it("one page serializes its own writes to a project with no locks at all", async () => {
    const rest = platform([]);
    const writer = makeProjectTagWriter({ source: rest.source });

    const [first, second] = await Promise.all([
      writer.write("p1", { kind: "mate" }),
      writer.write("p1", { kind: "mate" }),
    ]);

    expect([first.kind, second.kind]).toEqual(["written", "unchanged"]);
    expect(rest.tags()).toEqual(["mate"]);
    expect(rest.log).toEqual(["GET", "PUT", "GET", "GET"]);
  });

  it("two tabs declare one Mate at once: one writes, the other finds it written", async () => {
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

    const [declared, again] = await Promise.all([
      writerIn(first).write("p1", { kind: "mate" }),
      writerIn(second).write("p1", { kind: "mate" }),
    ]);

    expect([declared.kind, again.kind]).toEqual(["written", "unchanged"]);
    expect(rest.project("p1")?.tagList).toEqual(["person:own", "mate"]);
    // One tab's read, write and read-back, then the other's read: never interleaved.
    expect(rest.requests().map(({ route, tab }) => `${tab} ${route}`)).toEqual([
      `${first.id} GET /project/p1`,
      `${first.id} PUT /project/p1`,
      `${first.id} GET /project/p1`,
      `${second.id} GET /project/p1`,
    ]);
  });
});

// D3: a Mate's name is its project's, written through the same record a tag write puts back.
describe("a project renamed by the project's one writer", () => {
  it("renames on a fresh read and puts back every tag the platform holds", async () => {
    const rest = platform(["mate", "person:own", "mate:face:rose:seal"], {
      beforeRead: (tags: ReadonlyArray<string>) => [...tags, "theirs"],
    });
    const writer = makeProjectTagWriter({ source: rest.source });

    const renamed = await writer.rename("p1", "Nova");

    expect(renamed).toMatchObject({ kind: "written", project: { name: "Nova" } });
    expect([rest.name(), rest.tags()]).toEqual([
      "Nova",
      ["mate", "person:own", "mate:face:rose:seal", "theirs"],
    ]);
    expect(rest.log).toEqual(["GET", "PUT", "GET"]);
  });

  it("a name the project already has costs a read and writes nothing", async () => {
    const rest = platform(["mate"]);
    const writer = makeProjectTagWriter({ source: rest.source });

    expect((await writer.rename("p1", "One")).kind).toBe("unchanged");
    expect(rest.log).toEqual(["GET"]);
  });

  it("renames from the name it was planned from, and refuses a project renamed since, writing nothing", async () => {
    const rest = platform(["mate"]);
    const writer = makeProjectTagWriter({ source: rest.source });

    await expect(writer.rename("p1", "Nova", { from: "Other" })).rejects.toMatchObject({
      kind: "rejected",
      retryable: false,
      message: expect.stringContaining("renamed since"),
    });
    expect(rest.log).toEqual(["GET"]);
    expect(rest.name()).toBe("One");

    expect((await writer.rename("p1", "Nova", { from: "One" })).kind).toBe("written");
    // Already at the target: nothing to refuse, nothing to write.
    expect((await writer.rename("p1", "Nova", { from: "One" })).kind).toBe("unchanged");
  });

  it("a rename and a tag write to one project never undo each other", async () => {
    const rest = platform([]);
    const writer = makeProjectTagWriter({ source: rest.source });

    await Promise.all([writer.write("p1", { kind: "mate" }), writer.rename("p1", "Nova")]);

    expect([rest.name(), rest.tags()]).toEqual(["Nova", ["mate"]]);
  });

  // Security review 12: a rename puts back the tags of its own fresh read, under the lock, and its
  // read-back checks the Mate's marker too — a whole-record write from another browser in between
  // that dropped it fails visibly, never as a rename that went through.
  it("fails visibly where another writer's record dropped the Mate's marker", async () => {
    let project: ZeropsProject = {
      id: "p1",
      name: "One",
      status: "ACTIVE",
      tagList: ["mate", "person:own"],
    };
    const log: Array<string> = [];
    const writer = makeProjectTagWriter({
      source: {
        fetchProject: async () => {
          log.push("GET");
          return project;
        },
        writeProject: async (_read, record) => {
          log.push("PUT");
          // Ours lands, then another browser's record: our name, its tags without the marker.
          project = { ...project, name: record.name, tagList: ["person:own"] };
          return project;
        },
      },
    });

    await expect(writer.rename("p1", "Nova")).rejects.toMatchObject({ kind: "rejected" });
    expect(log).toEqual(["GET", "PUT", "GET"]);
  });

  it("names it again where another writer's record replaced the name", async () => {
    const rest = platform(["mate"], { afterWrite: (tags: ReadonlyArray<string>) => tags });
    const writer = makeProjectTagWriter({ source: rest.source });

    await expect(writer.rename("p1", "Nova")).rejects.toMatchObject({ kind: "rejected" });
    expect(rest.log).toEqual(["GET", "PUT", "GET"]);
  });
});
