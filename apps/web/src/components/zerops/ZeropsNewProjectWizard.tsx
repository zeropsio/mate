import { ZeropsApiError, type ZeropsLocation } from "@t3tools/client-runtime/zerops";
/**
 * `/zerops/new` — *Add project*: a group, and its first Mate (guide 4.1, 4.2).
 *
 * ## A project is a registry entry
 *
 * Nothing platform-side is created for the project itself. The group is one
 * `mate:gn:{groupId}:{slug}` tag written on the account's Gitea project
 * (`groupCreation.ts`), and the account's broker builds the Gitea side from
 * it — the org, its teams, the group repo, its runner — in about eighty
 * seconds. The first Mate is an ordinary Zerops project created inside it and
 * tagged with the group at birth, so it never exists ungrouped.
 *
 * That is why the registry write comes first and the Mate second: a Mate
 * tagged into a group the registry does not know about is a Mate with no reach
 * and no bot (guide 4.2).
 *
 * ## One question
 *
 * The name. No brief — the Mate opens on its own onboarding line — and no
 * agent pick: the container offers every agent when `ZCP_AGENTS` is absent,
 * which an empty selection is (`newProject.ts`). The handoff is still written
 * so the projects page can resume the creation on a reload.
 *
 * The wait — polling, the ready → connect identity exchange, retry — is the
 * projects page's; a successful create marks the organization as creating
 * and goes there.
 */

import { Link, useNavigate } from "@tanstack/react-router";
import type { OrganizationLocationsResourceRequest } from "@t3tools/client-runtime/zerops/data";
import { useContext, useEffect, useMemo, useState } from "react";

import {
  generateBotName,
  generateZeropsGroupId,
  planGroupMembership,
  planGroupRegistration,
  resolveAddProjectVerb,
  type ZeropsAgentType,
  type ZeropsEnvironmentRole,
  type ZeropsOrganization,
  type ZeropsRegistry,
} from "@t3tools/client-runtime/zerops";
import type { ZeropsProject } from "@t3tools/client-runtime/zerops";
import { zeropsErrorMessage } from "@t3tools/client-runtime/zerops/errors";

import { registerMateProject } from "~/zerops/brokerGrant";
import { rememberCreationHandoff } from "~/zerops/creationHandoffStorage";
import { findAccountGitea } from "~/zerops/giteaProject";
import { InventoryContext } from "~/zerops/inventoryContext";
import { runZeropsCommand, useZeropsData, useZeropsResource } from "~/zerops/zeropsDataContext";

import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Spinner } from "../ui/spinner";
import {
  WorkspaceBreadcrumb,
  WorkspaceBreadcrumbItem,
  WorkspaceBreadcrumbSeparator,
} from "../WorkspaceBreadcrumb";
import type { ZeropsOrganizationStatus } from "~/zerops/ZeropsSessionProvider";
import { useZeropsSession } from "~/zerops/ZeropsSessionProvider";

import { ZeropsSessionAccountControl } from "./landing/ZeropsAccountControl";
import { ZeropsHostedFrame } from "./landing/ZeropsHostedFrame";
import { ZeropsOrganizationScope } from "./ZeropsOrganizationScope";
import { useZeropsProjectConnection } from "./ZeropsProjectsPage";

const CARD_CLASS = "rounded-[var(--zerops-card-radius)] border border-border/60 bg-card";

const EMPTY_LOCATIONS: ReadonlyArray<ZeropsLocation> = [];

/**
 * A single membership auto-resolves to `organizationStatus: "selected"`
 * (`resolveActiveZeropsOrganization`), so this is false as soon as it can be
 * — the scope step never renders a one-option chooser.
 */
export function zeropsNewProjectScopeStepVisible(input: {
  readonly organizationStatus: ZeropsOrganizationStatus;
  readonly activeOrganization: ZeropsOrganization | null;
}): boolean {
  return input.organizationStatus !== "selected" || !input.activeOrganization;
}

function isUncertainCreateFailure(cause: unknown): boolean {
  if (cause instanceof ZeropsApiError) return cause.kind === "uncertain";
  return (
    typeof cause === "object" &&
    cause !== null &&
    "_tag" in cause &&
    cause._tag === "ZeropsDataAdapterError" &&
    "kind" in cause &&
    cause.kind === "uncertain"
  );
}

/** The account's Gitea — where the registry lives — and the registry as read from it. */
export interface ZeropsRegistryHome {
  readonly projectId: string;
  readonly registry: ZeropsRegistry;
}

export type ZeropsNewProjectPhase = "gitea" | "project";

/**
 * Stands the account's Gitea up if it has none, registers the group, then
 * creates its first Mate inside it.
 *
 * Kept free of React so the order — and every way it can stop half-way — is
 * directly testable. The order is the point: the registry lives on the Gitea
 * project, so an account without one gets it first (the first project brings
 * Git hosting along; nobody is told to add it); the registry entry is what
 * makes the group exist, and a Mate created before it would be a Mate in a
 * group nobody has heard of. A Gitea that cannot be stood up creates nothing;
 * a registry write that fails creates nothing; a Mate creation that fails
 * leaves a registered group with no Mate in it, which is a group the person
 * can add a Mate to and not a mess to clean up.
 */
export async function submitZeropsNewProject(input: {
  /** The account's Gitea and its registry, already read — or nothing yet. */
  readonly gitea: ZeropsRegistryHome | undefined;
  /**
   * Stands the account's Gitea up and reads its registry back — the fresh
   * project's own tags, so the write that follows keeps its `mate:tool:gitea`.
   */
  readonly ensureGitea: () => Promise<ZeropsRegistryHome>;
  /** Writes `mate:gn:{groupId}:{slug}` on the account's Gitea project. */
  readonly registerGroup: (registration: {
    readonly giteaProjectId: string;
    readonly groupId: string;
    readonly tagList: ReadonlyArray<string>;
  }) => Promise<void>;
  /**
   * Writes `mate:gm:{groupId}:{projectId}:mate` — the entry that gives the new
   * Mate its reach and its Gitea bot (guide 4.2) — and gives the broker's
   * token the Mate's project, so its rights loop can deliver that bot's
   * access (D20, `brokerGrant.ts`).
   */
  readonly registerMate: (registration: {
    readonly giteaProjectId: string;
    readonly projectId: string;
    readonly tagList: ReadonlyArray<string>;
  }) => Promise<void>;
  readonly createProject: (args: {
    readonly clientId: string;
    readonly name: string;
    readonly location?: string;
    readonly agents?: ReadonlyArray<ZeropsAgentType>;
    readonly group?: {
      readonly groupId: string;
      readonly role?: ZeropsEnvironmentRole;
      readonly label?: string;
    };
    readonly botName?: string;
  }) => Promise<{ readonly project: ZeropsProject; readonly serviceName: string }>;
  readonly clientId: string;
  readonly name: string;
  readonly locationId: string | null;
  readonly agents: ReadonlyArray<ZeropsAgentType>;
  /** The group this project starts as, and the name of the Mate in it. */
  readonly groupId: string;
  readonly botName: string;
  /** Which half is running, for a button that says so. */
  readonly onPhase?: (phase: ZeropsNewProjectPhase) => void;
  readonly onStartWaiting: (clientId: string) => void;
  /**
   * The project exists. Called before the wait starts, so what this project is
   * for can be written down while its id is in hand (`creationHandoff.ts`).
   */
  readonly onCreated?: (projectId: string, slug: string) => void;
  readonly onError: (message: string) => void;
  readonly onUncertain?: () => void;
}): Promise<void> {
  const groupName = input.name.trim();

  let gitea = input.gitea;
  if (gitea === undefined) {
    input.onPhase?.("gitea");
    try {
      gitea = await input.ensureGitea();
    } catch (cause) {
      input.onError(zeropsErrorMessage(cause));
      return;
    }
  }
  input.onPhase?.("project");

  const registration = planGroupRegistration({
    name: groupName,
    groupId: input.groupId,
    registry: gitea.registry,
  });
  if (!registration.ok) {
    input.onError(registration.reason);
    return;
  }

  try {
    await input.registerGroup({
      giteaProjectId: gitea.projectId,
      groupId: registration.plan.groupId,
      tagList: registration.plan.tagList,
    });
  } catch (cause) {
    input.onError(zeropsErrorMessage(cause));
    return;
  }

  try {
    const created = await input.createProject({
      clientId: input.clientId,
      // The group has no project of its own; what is created here is its first
      // dev environment, and it carries the role in its name the way every
      // environment added afterwards does.
      name: `${groupName} - dev`,
      ...(input.locationId ? { location: input.locationId } : {}),
      agents: input.agents,
      group: { groupId: input.groupId, role: "dev", label: groupName },
      botName: input.botName,
    });
    input.onCreated?.(created.project.id, registration.plan.slug);
    // The membership entry, off the registry this call just wrote — not off a
    // re-read, which would race the platform's own write.
    const membership = planGroupMembership({
      registry: {
        ...gitea.registry,
        groups: [
          ...gitea.registry.groups,
          {
            groupId: input.groupId,
            slug: registration.plan.slug,
            projects: [],
            matesMayRelease: false,
          },
        ],
      },
      groupId: input.groupId,
      projectId: created.project.id,
      kind: "mate",
    });
    // A membership write that fails leaves a Mate waiting for an owner, which
    // is a state the rows already say — never a reason to fail a creation that
    // produced a project that exists and runs.
    if (membership.ok) {
      await input
        .registerMate({
          giteaProjectId: gitea.projectId,
          projectId: created.project.id,
          tagList: membership.tagList,
        })
        .catch(() => undefined);
    }
    input.onStartWaiting(input.clientId);
  } catch (cause) {
    if (isUncertainCreateFailure(cause)) input.onUncertain?.();
    input.onError(zeropsErrorMessage(cause));
  }
}

function ZeropsNewProjectContent() {
  const { activeOrganization, organizationStatus, organizations, selectOrganization, status } =
    useZeropsSession();
  const { organizationRef, runtime } = useZeropsData();
  const navigate = useNavigate();
  const { setCreatingIn } = useZeropsProjectConnection(activeOrganization?.id ?? null);

  const inventory = useContext(InventoryContext);
  const { client } = useZeropsSession();
  const [name, setName] = useState("");
  const [locationChoice, setLocationChoice] = useState<{
    readonly key: string;
    readonly id: string;
  } | null>(null);
  const [creating, setCreating] = useState(false);
  const [phase, setPhase] = useState<ZeropsNewProjectPhase>("project");
  const [createUncertain, setCreateUncertain] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  // Read once the Gitea project is known, and before the person reaches the
  // create button: the slug is derived against the slugs already taken, and a
  // registry read at click time would be a wait where none is expected.
  const [registry, setRegistry] = useState<ZeropsRegistry | null>(null);

  // The registry lives on the account's Gitea project, and only its owners and
  // admins may write it (D3) — a stricter gate than *can create projects*, and
  // the one the platform will actually apply.
  const gitea = useMemo(
    () => findAccountGitea(inventory, activeOrganization?.id),
    [activeOrganization?.id, inventory],
  );
  const addProject = resolveAddProjectVerb({
    viewer: {
      id: activeOrganization?.id ?? "",
      membershipId: activeOrganization?.membershipId ?? "",
      roleCode: activeOrganization?.roleCode,
      canCreateProjects: activeOrganization?.canCreateProjects,
    },
  });
  const canCreate = addProject.offered;
  const locationRequest = useMemo<OrganizationLocationsResourceRequest | null>(
    () =>
      activeOrganization && canCreate
        ? {
            kind: "organization-locations",
            account: runtime.scope,
            organization: organizationRef(activeOrganization.id),
          }
        : null,
    [activeOrganization, canCreate, organizationRef, runtime.scope],
  );
  const locationResource = useZeropsResource(locationRequest);
  const locations =
    locationResource.status === "success" ? locationResource.value : EMPTY_LOCATIONS;
  const locationKey = activeOrganization?.id ?? "";
  const locationId =
    locationChoice?.key === locationKey &&
    locations.some((location) => location.id === locationChoice.id)
      ? locationChoice.id
      : (locations[0]?.id ?? null);
  const locationStatus =
    !activeOrganization || !canCreate
      ? "ready"
      : locationResource.status === "success"
        ? "ready"
        : locationResource.status === "failure"
          ? "failed"
          : "loading";
  const locationError =
    locationResource.status === "failure" ? "Try again from the projects page." : null;

  const giteaProjectId = gitea?.projectId;
  useEffect(() => {
    if (giteaProjectId === undefined) return;
    const controller = new AbortController();
    void client
      .readGroupRegistry(giteaProjectId, controller.signal)
      .then((read) => {
        if (!controller.signal.aborted) setRegistry(read);
      })
      // A registry that cannot be read is a create that will say so when it is
      // tried; there is nothing to tell the person about here.
      .catch(() => undefined);
    return () => {
      controller.abort();
    };
  }, [client, giteaProjectId]);

  useEffect(() => {
    if (locations.length <= 1) return;
    let cancelled = false;
    // Match the Zerops GUI's default: measure all locations in parallel
    // and preselect the lowest observed latency. This is a bounded health
    // probe, independent of the platform configuration read.
    void Promise.all(
      locations.map(async (location) => {
        const startedAt = performance.now();
        try {
          const response = await fetch(location.pingUrl, { cache: "no-store" });
          if (!response.ok) return null;
          return { id: location.id, latency: performance.now() - startedAt };
        } catch {
          return null;
        }
      }),
    ).then((results) => {
      if (cancelled) return;
      const fastest = results
        .filter((result): result is { readonly id: string; readonly latency: number } =>
          Boolean(result),
        )
        .sort((left, right) => left.latency - right.latency)[0];
      if (fastest) setLocationChoice({ key: locationKey, id: fastest.id });
    });
    return () => {
      cancelled = true;
    };
  }, [locationKey, locations]);

  if (status === "loading") {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner className="size-4" />
        Checking your Zerops session…
      </div>
    );
  }
  if (status === "signed-out") {
    return (
      <p className="text-sm text-muted-foreground">
        Sign in with your Zerops account to create a project.
      </p>
    );
  }
  if (status === "totp-required") {
    return (
      <p className="text-sm text-muted-foreground">Finish signing in with your two-factor code.</p>
    );
  }

  if (
    !activeOrganization ||
    zeropsNewProjectScopeStepVisible({ organizationStatus, activeOrganization })
  ) {
    return (
      <ZeropsOrganizationScope
        organizations={organizations}
        status={organizationStatus}
        onSelect={(membershipId) => {
          void selectOrganization(membershipId);
        }}
      />
    );
  }

  if (!addProject.offered) {
    return (
      <section className={`max-w-xl px-5 py-4 ${CARD_CLASS}`}>
        <h2 className="text-sm font-semibold text-foreground">Nothing to add here</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {addProject.reason} You can open every project of {activeOrganization.name} you have been
          given.
        </p>
      </section>
    );
  }

  const createProject = () => {
    const home =
      gitea === undefined || registry === null
        ? undefined
        : { projectId: gitea.projectId, registry };
    setCreating(true);
    setCreateError(null);
    void submitZeropsNewProject({
      gitea: home,
      // The first project brings Git hosting along: the same stand-up the
      // projects page offers an older account, then the fresh project's own
      // tags read back as the registry the group is written into.
      ensureGitea: async () => {
        const origin = window.location.origin;
        const { project } = await runZeropsCommand(
          runtime.commands.createToolProject({
            organization: organizationRef(activeOrganization.id),
            toolKind: "gitea",
            name: "Gitea",
            appOrigins: [origin],
            appUrl: origin,
          }),
        );
        return { projectId: project.id, registry: await client.readGroupRegistry(project.id) };
      },
      registerGroup: async ({ giteaProjectId, tagList }) => {
        await client.writeGroupRegistry({ giteaProjectId, tagList });
      },
      // What did not go through is not reported here: a Mate the registry
      // does not name waits for its owner on the projects page, and one the
      // broker does not reach yet is what the broker's loop reports and the
      // next registration retries.
      registerMate: async ({ giteaProjectId, projectId, tagList }) => {
        await registerMateProject({
          client,
          clientId: activeOrganization.id,
          giteaProjectId,
          projectId,
          tagList,
        });
      },
      onPhase: setPhase,
      createProject: ({ clientId: _clientId, ...args }) =>
        runZeropsCommand(
          runtime.commands.createProjectWithMate({
            organization: organizationRef(activeOrganization.id),
            ...args,
          }),
        ),
      clientId: activeOrganization.id,
      name,
      locationId,
      // Every agent: an empty selection omits `ZCP_AGENTS` (`newProject.ts`).
      agents: [],
      groupId: generateZeropsGroupId((bytes) => crypto.getRandomValues(bytes)),
      botName: generateBotName([], (bytes) => crypto.getRandomValues(bytes)),
      onCreated: (projectId) => {
        // What this project is, written down while its id is in hand: the
        // projects page reads it to resume the creation, and the Mate opens
        // on its own onboarding line — nothing typed here is sent for the
        // person.
        rememberCreationHandoff(projectId, {
          environmentName: `${name.trim()} - dev`,
          groupName: name.trim(),
          role: "dev",
          source: { kind: "none" },
        });
      },
      onStartWaiting: (clientId) => {
        setCreatingIn(clientId);
        void navigate({ to: "/zerops" });
      },
      onError: setCreateError,
      onUncertain: () => setCreateUncertain(true),
    }).finally(() => {
      setCreating(false);
    });
  };

  return (
    <section className={`max-w-xl space-y-4 px-5 py-5 ${CARD_CLASS}`}>
      <div className="space-y-1.5">
        <Label htmlFor="zerops-new-project">Name</Label>
        <Input
          id="zerops-new-project"
          value={name}
          placeholder="Acme CRM"
          onChange={(event) => {
            setName(event.target.value);
          }}
        />
      </div>
      {locations.length > 1 ? (
        <div className="space-y-1.5">
          <Label htmlFor="zerops-new-project-location">Location</Label>
          <Select
            value={locationId}
            onValueChange={(value) => {
              if (value !== null) setLocationChoice({ key: locationKey, id: value });
            }}
          >
            <SelectTrigger id="zerops-new-project-location" aria-label="Project location">
              <SelectValue placeholder="Choose a location">
                {locations.find((location) => location.id === locationId)?.name ??
                  "Choose a location"}
              </SelectValue>
            </SelectTrigger>
            <SelectPopup>
              {locations.map((location) => (
                <SelectItem key={location.id} value={location.id}>
                  {location.name}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </div>
      ) : null}
      <Button
        size="sm"
        disabled={
          creating ||
          createUncertain ||
          name.trim().length === 0 ||
          locationStatus === "loading" ||
          locationStatus === "failed" ||
          (locations.length > 0 && !locationId) ||
          (gitea !== undefined && registry === null)
        }
        onClick={createProject}
      >
        {creating || locationStatus === "loading" ? <Spinner className="size-4" /> : null}
        {creating && phase === "gitea" ? "Setting up Git hosting" : "Create project"}
      </Button>
      {locationError ? (
        <p className="rounded-lg border border-destructive/40 bg-destructive/8 px-3 py-2 text-sm text-destructive-foreground">
          Could not load project locations. {locationError}
        </p>
      ) : null}
      {createError ? (
        <p className="rounded-lg border border-destructive/40 bg-destructive/8 px-3 py-2 text-sm text-destructive-foreground">
          {createError}
        </p>
      ) : null}
    </section>
  );
}

export function ZeropsNewProjectWizard() {
  return (
    <ZeropsHostedFrame
      actions={<ZeropsSessionAccountControl />}
      breadcrumb={
        <WorkspaceBreadcrumb ariaLabel="Zerops breadcrumb" className="min-w-0">
          <WorkspaceBreadcrumbItem>
            <Link className="hover:text-foreground" to="/zerops">
              Projects
            </Link>
          </WorkspaceBreadcrumbItem>
          <WorkspaceBreadcrumbSeparator />
          <WorkspaceBreadcrumbItem current>New project</WorkspaceBreadcrumbItem>
        </WorkspaceBreadcrumb>
      }
    >
      <p className="text-sm text-muted-foreground" data-zerops-project-scope="true">
        Name it. Its first Mate is up in a few minutes, with Git hosting alongside.
      </p>
      <ZeropsNewProjectContent />
    </ZeropsHostedFrame>
  );
}
