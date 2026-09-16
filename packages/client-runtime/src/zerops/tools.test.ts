import { describe, expect, it } from "vite-plus/test";

import type { ZeropsProject, ZeropsService } from "./api.ts";
import {
  deriveGiteaState,
  formatToolTag,
  partitionZeropsToolProjects,
  planGiteaProjectSetup,
  readZeropsToolKind,
  type ZeropsGiteaSetupInput,
  type ZeropsGiteaStepState,
} from "./tools.ts";

/** The probe project as the platform actually returned it, 2026-09-05. */
const GITEA_PROJECT: ZeropsProject = {
  id: "VX2ruYMlTGOrTBfVBmS45Q",
  name: "mate-gitea",
  status: "ACTIVE",
  publicZone: "s7cg2lbb37ebf9fao4ts4408bp0.prg1-zerops.zone",
  zeropsSubdomainHost: "926",
  tagList: ["mate:tool:gitea"],
};

function service(name: string, status: string, extra: Partial<ZeropsService> = {}): ZeropsService {
  return { id: name, name, status, isSystem: false, ...extra };
}

/** The `web` service as measured: subdomain access on, ports 2222/tcp and 3000/http. */
const WEB_ACTIVE = service("web", "ACTIVE", {
  subdomainAccess: true,
  ports: [
    { port: 2222, protocol: "tcp", scheme: "tcp" },
    { port: 3000, protocol: "tcp", scheme: "http" },
  ],
});

const RECIPE_SERVICES = [
  service("db", "ACTIVE"),
  service("volume", "ACTIVE"),
  WEB_ACTIVE,
  service("broker", "ACTIVE"),
];

function stepState(
  state: ReturnType<typeof deriveGiteaState>,
  id: string,
): ZeropsGiteaStepState | undefined {
  return state.steps.find((step) => step.id === id)?.state;
}

describe("tool tags", () => {
  it("formats the tag", () => {
    expect(formatToolTag("gitea")).toBe("mate:tool:gitea");
  });

  it.each([
    { name: "reads a known kind", tagList: ["mate:tool:gitea"], expected: "gitea" },
    { name: "ignores an unknown kind", tagList: ["mate:tool:jenkins"], expected: undefined },
    { name: "ignores an ordinary project", tagList: ["mate:g:aaa"], expected: undefined },
    { name: "ignores no tags at all", tagList: undefined, expected: undefined },
  ])("$name", ({ tagList, expected }) => {
    expect(readZeropsToolKind(tagList)).toBe(expected);
  });
});

describe("partitionZeropsToolProjects", () => {
  it("takes tools out of the list the group tree is built from", () => {
    const app: ZeropsProject = { id: "a", name: "crm", status: "ACTIVE", tagList: ["mate:g:aaa"] };
    const plain: ZeropsProject = { id: "b", name: "plain", status: "ACTIVE" };

    const { tools, rest } = partitionZeropsToolProjects([app, GITEA_PROJECT, plain]);

    expect(tools.map((tool) => tool.kind)).toEqual(["gitea"]);
    expect(rest.map((project) => project.name)).toEqual(["crm", "plain"]);
  });

  it("treats a tool that also carries a group tag as a tool — the two are disjoint", () => {
    const confused: ZeropsProject = {
      id: "c",
      name: "confused",
      status: "ACTIVE",
      tagList: ["mate:g:aaa", "mate:tool:gitea"],
    };

    const { tools, rest } = partitionZeropsToolProjects([confused]);

    expect(tools).toHaveLength(1);
    expect(rest).toEqual([]);
  });
});

describe("deriveGiteaState", () => {
  it("builds the public URL that actually resolves", () => {
    // Measured: this host answers 200; the recipe's own `app-prg1` spelling
    // does not resolve at all.
    expect(deriveGiteaState(GITEA_PROJECT, RECIPE_SERVICES).url).toBe(
      "https://web-926-3000.prg1.zerops.app",
    );
  });

  it.each([
    { name: "running once web is ACTIVE", webStatus: "ACTIVE", phase: "running" },
    { name: "provisioning while it builds", webStatus: "READY_TO_DEPLOY", phase: "provisioning" },
    { name: "provisioning while it is created", webStatus: "CREATING", phase: "provisioning" },
    { name: "provisioning at NEW", webStatus: "NEW", phase: "provisioning" },
    { name: "unavailable while deleting", webStatus: "DELETING", phase: "unavailable" },
  ])("is $name", ({ webStatus, phase }) => {
    const services = [
      service("db", "ACTIVE"),
      service("web", webStatus, { subdomainAccess: true }),
    ];
    expect(deriveGiteaState(GITEA_PROJECT, services).phase).toBe(phase);
  });

  it("is provisioning while the web service is not listed yet", () => {
    // Seconds after the import the project is ACTIVE and lists nothing; the
    // inventory catches up on its next read. Not gone: setting up.
    expect(deriveGiteaState(GITEA_PROJECT, []).phase).toBe("provisioning");
  });

  it("ignores the transient build and prepare services the platform creates", () => {
    // Both observed in a real import; without the isSystem filter a service
    // named `buildwebv…` would be read as part of the recipe.
    const withBuilds = [
      ...RECIPE_SERVICES,
      service("buildwebv1788602355", "CREATING", { isSystem: true }),
      service("preparewebv11788602377", "ACTIVE", { isSystem: true }),
      service("core", "ACTIVE", { isSystem: true }),
    ];
    expect(deriveGiteaState(GITEA_PROJECT, withBuilds).phase).toBe("running");
  });

  it("demotes a platform-ACTIVE Gitea that does not actually answer", () => {
    const state = deriveGiteaState(GITEA_PROJECT, RECIPE_SERVICES, { reachable: false });
    expect(state.phase).toBe("provisioning");
    expect(state.webStatus).toBe("ACTIVE");
  });

  describe("the admin-user step", () => {
    it("is unknown without a probe rather than nagging", () => {
      expect(stepState(deriveGiteaState(GITEA_PROJECT, RECIPE_SERVICES), "admin")).toBe("unknown");
    });

    it("needs the user when Gitea reports no users", () => {
      const state = deriveGiteaState(GITEA_PROJECT, RECIPE_SERVICES, {
        reachable: true,
        userCount: 0,
      });
      expect(stepState(state, "admin")).toBe("needs-you");
      expect(state.steps.find((step) => step.id === "admin")?.detail).toContain(
        "gitea admin user create",
      );
    });

    it("is done once a user exists", () => {
      const state = deriveGiteaState(GITEA_PROJECT, RECIPE_SERVICES, {
        reachable: true,
        userCount: 1,
      });
      expect(stepState(state, "admin")).toBe("done");
    });

    it("stays unknown when the probe reached Gitea but the user call failed", () => {
      expect(
        stepState(deriveGiteaState(GITEA_PROJECT, RECIPE_SERVICES, { reachable: true }), "admin"),
      ).toBe("unknown");
    });

    // The recipe mints the admin on first boot and publishes the token as the
    // web service's own env, so its presence is stronger evidence than a user
    // count — and it is readable without asking Gitea anything.
    it("is done when the recipe has published the admin token, with no probe at all", () => {
      const state = deriveGiteaState(GITEA_PROJECT, RECIPE_SERVICES, undefined, [
        "GITEA_ADMIN_USERNAME",
        "GITEA_ADMIN_TOKEN",
      ]);
      expect(stepState(state, "admin")).toBe("done");
      expect(state.adminCredentialPublished).toBe(true);
      expect(state.steps.find((step) => step.id === "admin")?.detail).toBeUndefined();
    });

    it("does not read an unrelated key as the admin token", () => {
      const state = deriveGiteaState(
        GITEA_PROJECT,
        RECIPE_SERVICES,
        { reachable: true, userCount: 0 },
        ["GITEA_ADMIN_USERNAME"],
      );
      expect(stepState(state, "admin")).toBe("needs-you");
      expect(state.adminCredentialPublished).toBe(false);
    });

    // An instance built before the recipe minted its own admin: somebody made
    // the user by hand, so there is a user but no published token. Still done,
    // and still worth knowing the credential is not readable.
    it("is done but unpublished for a hand-made admin on an older instance", () => {
      const state = deriveGiteaState(GITEA_PROJECT, RECIPE_SERVICES, {
        reachable: true,
        userCount: 1,
      });
      expect(stepState(state, "admin")).toBe("done");
      expect(state.adminCredentialPublished).toBe(false);
    });
  });

  it("reports the broker only once the import has created it", () => {
    expect(stepState(deriveGiteaState(GITEA_PROJECT, RECIPE_SERVICES), "broker")).toBe("done");

    const withoutBroker = deriveGiteaState(
      GITEA_PROJECT,
      RECIPE_SERVICES.filter((entry) => entry.name !== "broker"),
    );
    expect(stepState(withoutBroker, "broker")).toBe("pending");
    expect(withoutBroker.brokerImported).toBe(false);
  });
});

describe("planGiteaProjectSetup", () => {
  const table: ReadonlyArray<{
    readonly name: string;
    readonly input: ZeropsGiteaSetupInput;
    readonly expected: ReadonlyArray<string>;
  }> = [
    {
      name: "nothing yet",
      input: { project: undefined, services: [], tokenNames: [] },
      expected: ["create-project", "mint-broker-token", "import-services"],
    },
    {
      name: "the project exists, nothing else does",
      input: { project: { id: "p-1" }, services: [], tokenNames: [] },
      expected: ["mint-broker-token", "import-services"],
    },
    {
      name: "the project and the token exist, the import never ran",
      input: { project: { id: "p-1" }, services: [], tokenNames: ["mate-broker"] },
      // Nobody holds the value of a token minted before a tab closed.
      expected: ["regenerate-broker-token", "import-services"],
    },
    {
      name: "the import was accepted but only half of it appeared",
      input: { project: { id: "p-1" }, services: [{ name: "web" }], tokenNames: ["mate-broker"] },
      expected: ["regenerate-broker-token", "import-services"],
    },
    {
      name: "all done",
      input: {
        project: { id: "p-1" },
        services: [{ name: "web" }, { name: "broker" }, { name: "db" }],
        tokenNames: ["mate-broker"],
      },
      expected: [],
    },
    {
      name: "services without a project is not a state, and plans a project",
      input: { project: undefined, services: [{ name: "web" }], tokenNames: ["mate-broker"] },
      expected: ["create-project", "regenerate-broker-token", "import-services"],
    },
  ];

  it.each(table.map((row) => [row.name, row] as const))("%s", (_name, row) => {
    expect(planGiteaProjectSetup(row.input)).toEqual(row.expected);
  });
});
