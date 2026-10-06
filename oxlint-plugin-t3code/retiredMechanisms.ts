/**
 * Mechanisms the client data-layer rewrite retires: identifiers, storage keys and call patterns
 * whose every remaining site is a step still to take. `no-retired-mechanism` reports each
 * occurrence outside comments; its exception ledger lists today's sites and only shrinks. A token
 * is matched as written, on word boundaries where it begins or ends with a name.
 */
export interface RetiredMechanism {
  /** The text that marks a site: a name, a storage key or a call pattern. */
  readonly token: string;
  /** The fact family whose rewrite removes it. */
  readonly family: string;
  /** What replaces it, in one clause; the finding message quotes it. */
  readonly reason: string;
  /**
   * The repo files the token is retired in, for a token too common to mean the mechanism
   * anywhere else (`setAwaiting`, `historyRef`, `withChips`); absent for a distinctive name or
   * storage key, which is retired wherever it appears.
   */
  readonly paths?: ReadonlyArray<string>;
}

export const RETIRED_MECHANISMS: ReadonlyArray<RetiredMechanism> = [
  {
    token: "organizationProjectsRead",
    family: "services",
    reason:
      "the inventory's in-transit bridge to the project family; the inventory reads the store's projections and the bridge goes with ZeropsInventoryProvider",
  },
  {
    token: "runtimeServicesRead",
    family: "services",
    reason:
      "the data runtime's in-transit bridge to the services family; the runtime's readers move to the store's projections and the bridge goes with the runtime",
  },
  {
    token: "useInterestLeases",
    family: "projects",
    reason:
      "interest leases duplicate the store's subscriptions; the store reads what a view projects",
  },
  {
    token: "ensureReceiver(",
    family: "projects",
    reason: "the data runtime's direct receivers bypass the store; adapters feed one store",
    paths: ["packages/client-runtime/src/zerops/data/runtime.ts"],
  },
  {
    token: "plan.directReads",
    family: "projects",
    reason: "the data runtime's direct receivers bypass the store; adapters feed one store",
    paths: ["packages/client-runtime/src/zerops/data/runtime.ts"],
  },
  {
    token: "const rootAtom = Atom.make",
    family: "projects",
    reason:
      "a root atom per runtime and stable-atom wrappers duplicate the store; projections read the store",
    paths: ["packages/client-runtime/src/zerops/data/runtime.ts"],
  },
  {
    token: "function stableAtom",
    family: "projects",
    reason:
      "a root atom per runtime and stable-atom wrappers duplicate the store; projections read the store",
    paths: ["packages/client-runtime/src/zerops/data/atoms.ts"],
  },
  {
    token: "new Map<InterestKey, RuntimeInterest>()",
    family: "projects",
    reason: "runtime interest and receiver maps duplicate the store's subscriptions",
    paths: ["packages/client-runtime/src/zerops/data/runtime.ts"],
  },
  {
    token: "new Map<string, RuntimeReceiver>()",
    family: "projects",
    reason: "runtime interest and receiver maps duplicate the store's subscriptions",
    paths: ["packages/client-runtime/src/zerops/data/runtime.ts"],
  },
  {
    token: '"runtime-closed"',
    family: "projects",
    reason: "closing the runtime erases its facts; a transport event never deletes a fact",
    paths: [
      "packages/client-runtime/src/zerops/data/access/capabilities.ts",
      "packages/client-runtime/src/zerops/data/cells.ts",
      "packages/client-runtime/src/zerops/data/runtime.ts",
      "packages/client-runtime/src/zerops/data/state.ts",
      "packages/client-runtime/src/zerops/data/types.ts",
    ],
  },
  {
    token: "releaseTableLists",
    family: "projects",
    reason: "closing the runtime erases its facts; a transport event never deletes a fact",
  },
  {
    token: "makeZeropsCells",
    family: "projects",
    reason: "runtime cells duplicate the store's members and project reads",
  },
  {
    token: "candidateListingsAtom",
    family: "projects",
    reason: "candidate listings as atoms duplicate the projects family; read the projection",
  },
  {
    token: "organizationListingAtom",
    family: "projects",
    reason:
      "listing, candidate-row and topology atoms in the app duplicate the store; read the projection",
  },
  {
    token: "candidateRowsAtom",
    family: "projects",
    reason:
      "listing, candidate-row and topology atoms in the app duplicate the store; read the projection",
  },
  {
    token: "projectTopologyFamily",
    family: "projects",
    reason:
      "listing, candidate-row and topology atoms in the app duplicate the store; read the projection",
  },
  {
    token: "mate:zerops:menu-skeleton",
    family: "projects",
    reason:
      "the remembered menu skeleton copies the listing to browser storage; the store holds it in memory",
  },
  {
    token: "rememberMenuCandidates",
    family: "projects",
    reason:
      "the remembered menu skeleton copies the listing to browser storage; the store holds it in memory",
  },
  {
    token: "menuSkeletonSnapshot",
    family: "projects",
    reason:
      "the remembered menu skeleton copies the listing to browser storage; the store holds it in memory",
  },
  {
    token: "projectOpenedIn",
    family: "projects",
    reason:
      "the remembered menu skeleton copies the listing to browser storage; the store holds it in memory",
    paths: ["apps/web/src/components/Sidebar.tsx", "apps/web/src/zerops/menuSkeleton.ts"],
  },
  {
    token: "useZeropsCreationVerdicts",
    family: "projects",
    reason: "a hook polls creation verdicts itself; the operations adapter owns the read",
  },
  {
    token: "client.readProjectCreation(",
    family: "projects",
    reason: "a hook polls creation verdicts itself; the operations adapter owns the read",
    paths: ["apps/web/src/zerops/matePress.ts", "apps/web/src/zerops/useZeropsCreationVerdicts.ts"],
  },
  {
    token: "ZeropsDataProvider(",
    family: "projects",
    reason: "the app's data provider wires I/O in the view tree; adapters own I/O",
  },
  {
    token: "lastReadRef",
    family: "running work/processes",
    reason:
      "refs keep a last read as a remembered verdict; the operation's stream state says what is known",
    paths: ["apps/web/src/zerops/activity/useOperationObservation.ts"],
  },
  {
    token: "historyRef",
    family: "running work/processes",
    reason:
      "refs keep a last read as a remembered verdict; the operation's stream state says what is known",
    paths: ["apps/web/src/zerops/activity/useOperationObservation.ts"],
  },
  {
    token: "settledReadRef",
    family: "running work/processes",
    reason:
      "refs keep a last read as a remembered verdict; the operation's stream state says what is known",
    paths: ["apps/web/src/zerops/activity/useOperationObservation.ts"],
  },
  {
    token: "rememberedRef",
    family: "running work/processes",
    reason: "a remembered ref stands in for a fact; the store holds what the source said",
    paths: ["apps/web/src/zerops/activity/useOperationCard.ts"],
  },
  {
    token: "options.pollEvery ?? Duration.seconds(10)",
    family: "running work/processes",
    reason: "the deploy rollout polls on its own clock; the source's stream drives the state",
    paths: ["apps/hq/src/deploys.ts"],
  },
  {
    token: "followFor",
    family: "running work/processes",
    reason: "a deploy outcome decided by the clock; only the source settles an operation",
    paths: ["apps/hq/src/deploys.ts"],
  },
  {
    token: "untakenAfter",
    family: "running work/processes",
    reason: "a deploy outcome decided by the clock; only the source settles an operation",
    paths: ["apps/hq/src/deploys.ts"],
  },
  {
    token: "UNREACHABLE_GRACE_MS",
    family: "running work/processes",
    reason:
      "unreachable is decided by a grace timer; the stream's state says when a source is down",
  },
  {
    token: "unreachableLasts(",
    family: "running work/processes",
    reason:
      "unreachable is decided by a grace timer; the stream's state says when a source is down",
  },
  {
    token: "unreachableSince(",
    family: "running work/processes",
    reason:
      "unreachable is decided by a grace timer; the stream's state says when a source is down",
    paths: [
      "apps/web/src/zerops/activity/useOperationObservation.ts",
      "packages/client-runtime/src/zerops/activity/observe.ts",
    ],
  },
  {
    token: "setLasted(true), UNREACHABLE_GRACE_MS",
    family: "running work/processes",
    reason: "a build turns unobservable after a timer; the clock never decides an outcome",
    paths: ["apps/web/src/zerops/activity/useDeployBuilds.ts"],
  },
  {
    token: "unreachableSinceRef",
    family: "running work/processes",
    reason: "a ref remembers when a source went unreachable; the stream exposes its own state",
    paths: ["apps/web/src/zerops/activity/useOperationObservation.ts"],
  },
  {
    token: "prevServiceOutcomesRef",
    family: "services",
    reason:
      "inventory atoms and trouble refs remember a verdict; the services projection reads the store",
    paths: ["apps/web/src/zerops/ZeropsInventoryProvider.tsx"],
  },
  {
    token: "troubleRef",
    family: "services",
    reason:
      "inventory atoms and trouble refs remember a verdict; the services projection reads the store",
    paths: ["apps/web/src/zerops/ZeropsInventoryProvider.tsx"],
  },
  {
    token: "zeropsInventoryAtom",
    family: "services",
    reason:
      "inventory atoms and trouble refs remember a verdict; the services projection reads the store",
  },
  {
    token: "useMatesInventory",
    family: "services",
    reason:
      "the Mates inventory prepares containers, services and variables for every listed Mate; read on open",
  },
  {
    token: "useDrawnMates",
    family: "services",
    reason:
      "the Mates inventory prepares containers, services and variables for every listed Mate; read on open",
  },
  {
    token: "useMatesInventory(useMemo(() => drawnMateProjects",
    family: "services",
    reason: "the projects page prepares every drawn Mate's inventory up front; read on open",
  },
  {
    token: "client.listProjectServices(projectId)",
    family: "services",
    reason: "a component lists services and processes itself; the services adapter owns the read",
    paths: ["apps/web/src/components/zerops/ZeropsHqCard.tsx"],
  },
  {
    token: "client.listProjectProcesses(projectId)",
    family: "services",
    reason: "a component lists services and processes itself; the services adapter owns the read",
    paths: ["apps/web/src/components/zerops/ZeropsHqCard.tsx"],
  },
  {
    token: "const runRequest = async",
    family: "services",
    reason: "a component runs its own data-catalog requests; the adapter owns them",
    paths: ["apps/web/src/components/zerops/ZeropsDataPanel.tsx"],
  },
  {
    token: "useZeropsDataCatalogStore",
    family: "services",
    reason: "a component runs its own data-catalog requests; the adapter owns them",
  },
  {
    token: "makeDeploymentStore",
    family: "app versions",
    reason:
      "a separate deployment store duplicates the app-versions family; one reducer per family",
  },
  {
    token: "flow.deployments.subscribe",
    family: "app versions",
    reason:
      "flows subscribe to deployments with their own counters; the store feeds the projection",
    paths: ["apps/web/src/zerops/accountForge.ts"],
  },
  {
    token: "new WeakMap<AccountFlow, number>()",
    family: "app versions",
    reason:
      "flows subscribe to deployments with their own counters; the store feeds the projection",
    paths: ["apps/web/src/zerops/accountForge.ts"],
  },
  {
    token: "let view: HqStructureView",
    family: "HQ structure/apps",
    reason: "a module-level HQ structure view duplicates the store; HQ's stream feeds one reducer",
    paths: ["apps/web/src/zerops/hqStructure.ts"],
  },
  {
    token: "hqStructureAtom",
    family: "HQ structure/apps",
    reason:
      "HQ structure, Mates, official and people atoms duplicate the store; read the projection",
  },
  {
    token: "hqMatesViewAtom",
    family: "HQ structure/apps",
    reason:
      "HQ structure, Mates, official and people atoms duplicate the store; read the projection",
  },
  {
    token: "hqOfficialAtom",
    family: "HQ structure/apps",
    reason:
      "HQ structure, Mates, official and people atoms duplicate the store; read the projection",
  },
  {
    token: "hqPeopleViewAtom",
    family: "HQ structure/apps",
    reason:
      "HQ structure, Mates, official and people atoms duplicate the store; read the projection",
  },
  {
    token: "useZeropsMenu",
    family: "HQ structure/apps",
    reason: "the menu is assembled from HQ rows in a hook; the menu projection reads the store",
  },
  {
    token: "menuRowsFromHq",
    family: "HQ structure/apps",
    reason: "the menu is assembled from HQ rows in a hook; the menu projection reads the store",
  },
  {
    token: "const apis = new Map<string, HqApi>()",
    family: "HQ structure/apps",
    reason: "the app keeps its own HQ clients and sockets; the HQ adapter owns them",
    paths: ["apps/web/src/zerops/accountHq.ts"],
  },
  {
    token: "openBrowserSocket",
    family: "HQ structure/apps",
    reason: "the app keeps its own HQ clients and sockets; the HQ adapter owns them",
  },
  {
    token: "zerops-mate.hq-verdict.v1",
    family: "HQ structure/apps",
    reason:
      "the official-HQ verdict is remembered in browser storage for a day; HQ says which is official",
  },
  {
    token: "NO_HQ_RECHECK_MS",
    family: "HQ structure/apps",
    reason:
      "the official-HQ verdict is remembered in browser storage for a day; HQ says which is official",
  },
  {
    token: "useKeptHqVerdict",
    family: "HQ structure/apps",
    reason:
      "the official-HQ verdict is remembered in browser storage for a day; HQ says which is official",
  },
  {
    token: "mate:zerops:menu-memory",
    family: "HQ structure/apps",
    reason:
      "the remembered menu copies HQ structure, Mates, members and chips to storage; the store holds them in memory",
  },
  {
    token: "rememberMenu(",
    family: "HQ structure/apps",
    reason:
      "the remembered menu copies HQ structure, Mates, members and chips to storage; the store holds them in memory",
    paths: [
      "apps/web/src/components/Sidebar.tsx",
      "apps/web/src/design/sidebarHarness.tsx",
      "apps/web/src/zerops/hqStructure.ts",
      "apps/web/src/zerops/menuMemory.ts",
      "apps/web/src/zerops/useMateActions.tsx",
      "apps/web/src/zerops/useZeropsMateOwners.ts",
    ],
  },
  {
    token: "menuMemory()",
    family: "HQ structure/apps",
    reason:
      "the remembered menu copies HQ structure, Mates, members and chips to storage; the store holds them in memory",
    paths: [
      "apps/web/src/components/Sidebar.tsx",
      "apps/web/src/design/sidebarHarness.tsx",
      "apps/web/src/zerops/hqStructure.ts",
      "apps/web/src/zerops/menuMemory.ts",
      "apps/web/src/zerops/useZeropsMateOwners.ts",
      "apps/web/src/zerops/useZeropsMenu.tsx",
    ],
  },
  {
    token: "withChips",
    family: "HQ structure/apps",
    reason:
      "the remembered menu copies HQ structure, Mates, members and chips to storage; the store holds them in memory",
    paths: [
      "apps/web/src/components/Sidebar.tsx",
      "apps/web/src/design/sidebarHarness.tsx",
      "apps/web/src/zerops/menuMemory.ts",
    ],
  },
  {
    token: "withMembers",
    family: "HQ structure/apps",
    reason:
      "the remembered menu copies HQ structure, Mates, members and chips to storage; the store holds them in memory",
    paths: ["apps/web/src/zerops/menuMemory.ts", "apps/web/src/zerops/useZeropsMateOwners.ts"],
  },
  {
    token: "useZeropsRegistry",
    family: "HQ structure/apps",
    reason: "registry, recipes and releases are read by app hooks; the HQ adapter feeds the store",
  },
  {
    token: "useZeropsAppRecipes",
    family: "HQ structure/apps",
    reason: "registry, recipes and releases are read by app hooks; the HQ adapter feeds the store",
  },
  {
    token: "useZeropsAppReleases",
    family: "HQ structure/apps",
    reason: "registry, recipes and releases are read by app hooks; the HQ adapter feeds the store",
  },
  {
    token: "ReturnType<typeof makeRepositoryStore>",
    family: "HQ structure/apps",
    reason: "repository and git-credential stores are built in the app; the HQ adapter owns them",
    paths: ["apps/web/src/zerops/useRepositorySource.ts"],
  },
  {
    token: "ReturnType<typeof makeGitCredentialStore>",
    family: "HQ structure/apps",
    reason: "repository and git-credential stores are built in the app; the HQ adapter owns them",
    paths: ["apps/web/src/zerops/useGitCredentials.ts"],
  },
  {
    token: "input.hq.structure(",
    family: "HQ structure/apps",
    reason:
      "the whole structure is read back after an action; the action's result updates the store",
    paths: ["apps/web/src/zerops/addGroupEnvironment.ts"],
  },
  {
    token: "hq.structure(signal)",
    family: "HQ structure/apps",
    reason:
      "the whole structure is read back after an action; the action's result updates the store",
    paths: ["apps/web/src/zerops/deployToken.ts"],
  },
  {
    token: "useMatesSettled()",
    family: "HQ structure/apps",
    reason: "a settled flag for HQ Mates stands in for the stream's state; read the stream state",
  },
  {
    token: "hqMatesSettled(",
    family: "HQ structure/apps",
    reason: "a settled flag for HQ Mates stands in for the stream's state; read the stream state",
  },
  {
    token: "hqAbsent()",
    family: "HQ structure/apps",
    reason: "mobile selects candidates around an absent HQ itself; read the projection",
    paths: [
      "apps/mobile/src/features/zerops/account-ports.ts",
      "apps/mobile/src/features/zerops/environment-ports.ts",
    ],
  },
  {
    token: "selectCandidates(",
    family: "HQ structure/apps",
    reason: "mobile selects candidates around an absent HQ itself; read the projection",
    paths: [
      "apps/mobile/src/features/zerops/useZeropsCandidates.ts",
      "packages/client-runtime/src/zerops/projections/candidates.ts",
    ],
  },
  {
    token: "const appReads: Record<string, AppRead>",
    family: "HQ structure/apps",
    reason: "every app's detail is hydrated before the first snapshot; read on open",
    paths: ["apps/hq/src/stream.ts"],
  },
  {
    token: "event.appReads === null",
    family: "HQ structure/apps",
    reason: "null-means-delete in HQ data overwrites whole apps; events carry what changed",
    paths: ["packages/client-runtime/src/zerops/hq/stream.ts"],
  },
  {
    token: "reads === null || event.kind",
    family: "HQ structure/apps",
    reason: "null-means-delete in HQ data overwrites whole apps; events carry what changed",
    paths: ["packages/client-runtime/src/zerops/hq/stream.ts"],
  },
  {
    token: "STRUCTURE_SEGMENT_LIFETIME",
    family: "HQ structure/apps",
    reason: "HQ sends a full structure snapshot every 100 s segment; it streams changes",
  },
  {
    token: "structureTick",
    family: "HQ structure/apps",
    reason:
      "HQ recomputes the whole view per subscriber on every tick; it computes once per change",
    paths: ["apps/hq/src/stream.ts"],
  },
  {
    token: "Stream.tick(recheck)",
    family: "HQ structure/apps",
    reason:
      "HQ recomputes the whole view per subscriber on every tick; it computes once per change",
    paths: ["apps/hq/src/stream.ts"],
  },
  {
    token: "moveOffers",
    family: "HQ structure/apps",
    reason: "HQ enumerates every Mate-by-app move offer up front; ask when the dialog opens",
    paths: ["apps/hq/src/offers.ts", "apps/hq/src/structure.ts"],
  },
  {
    token: "moveTo: moveOffers(",
    family: "HQ structure/apps",
    reason: "HQ enumerates every Mate-by-app move offer up front; ask when the dialog opens",
    paths: ["apps/hq/src/structure.ts"],
  },
  {
    token: "mate:zerops:composer-top-memory",
    family: "changes/review",
    reason:
      "the composer's change strip is remembered in browser storage; the change projection paints it",
  },
  {
    token: "rememberComposerTop",
    family: "changes/review",
    reason:
      "the composer's change strip is remembered in browser storage; the change projection paints it",
  },
  {
    token: "rememberedComposerTop",
    family: "changes/review",
    reason:
      "the composer's change strip is remembered in browser storage; the change projection paints it",
  },
  {
    token: "new LRUCache<ReadoutPart<ChangeReadout>>",
    family: "changes/review",
    reason: "a component-level LRU reads change readouts once; the changes adapter owns the read",
    paths: ["apps/web/src/zerops/useZeropsChangeDetail.ts"],
  },
  {
    token: "function readOnce(",
    family: "changes/review",
    reason: "a component-level LRU reads change readouts once; the changes adapter owns the read",
    paths: ["apps/web/src/zerops/useZeropsChangeDetail.ts"],
  },
  {
    token: "function readPicture(",
    family: "changes/review",
    reason: "a hook reads change pictures itself; the changes adapter owns the read",
    paths: ["apps/web/src/zerops/useChangePicture.ts"],
  },
  {
    token: "useChangePicture",
    family: "changes/review",
    reason: "a hook reads change pictures itself; the changes adapter owns the read",
  },
  {
    token: "async function readChange(",
    family: "changes/review",
    reason: "a hook reads a landed change itself; the changes adapter owns the read",
    paths: ["apps/web/src/zerops/useZeropsLandedChange.ts"],
  },
  {
    token: "useZeropsLandedChange",
    family: "changes/review",
    reason: "a hook reads a landed change itself; the changes adapter owns the read",
  },
  {
    token: "EMPTY_FLOWS",
    family: "releases/environments",
    reason:
      "a lost grant empties every flow and hooks read on their own; hide the project when it is read",
    paths: ["apps/web/src/zerops/ZeropsProjectFlowProvider.tsx"],
  },
  {
    token: "effectRead(",
    family: "releases/environments",
    reason:
      "a lost grant empties every flow and hooks read on their own; hide the project when it is read",
    paths: ["apps/web/src/zerops/ZeropsProjectFlowProvider.tsx"],
  },
  {
    token: "setAwaiting",
    family: "releases/environments",
    reason:
      "a lost grant empties every flow and hooks read on their own; hide the project when it is read",
    paths: ["apps/web/src/zerops/ZeropsProjectFlowProvider.tsx"],
  },
  {
    token: "const compareAsks",
    family: "releases/environments",
    reason: "release comparisons are prepared up front; compare when a release is opened",
    paths: ["apps/web/src/zerops/ZeropsProjectFlowProvider.tsx"],
  },
  {
    token: "useZeropsCompares(compareAsks)",
    family: "releases/environments",
    reason: "release comparisons are prepared up front; compare when a release is opened",
  },
  {
    token: "useZeropsHistory",
    family: "releases/environments",
    reason: "history is read by a hook up front; read it when the view opens",
  },
  {
    token: "const stores = new Map<string, Store>()",
    family: "releases/environments",
    reason: "compare stores per HQ are kept in the app; the HQ adapter answers on open",
    paths: ["apps/web/src/zerops/useZeropsCompares.ts"],
  },
  {
    token: "hq.api.compare(",
    family: "releases/environments",
    reason: "compare stores per HQ are kept in the app; the HQ adapter answers on open",
    paths: ["apps/web/src/zerops/useZeropsCompares.ts"],
  },
  {
    token: "setHandoffTo",
    family: "releases/environments",
    reason: "the review hand-off is decided in the app; the operation's result says where to go",
    paths: ["apps/web/src/components/zerops/ZeropsProjectsPage.tsx"],
  },
  {
    token: "firstReleaseHandoff(",
    family: "releases/environments",
    reason: "the review hand-off is decided in the app; the operation's result says where to go",
  },
  {
    token: "useHalfMadeEnvironments(",
    family: "releases/environments",
    reason:
      "half-made environments are found by a hook's own reads; the projection reads the store",
  },
  {
    token: "new LRUCache<ReadonlyArray<HqChangeComment>>",
    family: "discussions/comments",
    reason: "a component-level LRU holds change comments; the discussions adapter owns them",
    paths: ["apps/web/src/zerops/useZeropsChangeComments.ts"],
  },
  {
    token: "useZeropsChangeComments",
    family: "discussions/comments",
    reason: "a component-level LRU holds change comments; the discussions adapter owns them",
  },
  {
    token: "settleToIdleAfter",
    family: "operations",
    reason: "a Mate update settles to idle after a timer; only the source settles an operation",
  },
  {
    token: "useZeropsMateUpdate",
    family: "operations",
    reason: "a Mate update settles to idle after a timer; only the source settles an operation",
  },
  {
    token: "STOP_POLL_MS",
    family: "operations",
    reason: "a restart polls and gives up on its own clock; only the source settles an operation",
    paths: ["apps/web/src/zerops/mateRestart.ts"],
  },
  {
    token: "STOP_WAIT_CAP_MS",
    family: "operations",
    reason: "a restart polls and gives up on its own clock; only the source settles an operation",
    paths: ["apps/web/src/zerops/mateRestart.ts"],
  },
  {
    token: "restartMateContainer(",
    family: "operations",
    reason: "a restart polls and gives up on its own clock; only the source settles an operation",
  },
  {
    token: "useZeropsUpgradeRestart",
    family: "operations",
    reason:
      "upgrade restart and finish-environment hooks poll themselves; the operations adapter owns them",
  },
  {
    token: "useFinishGroupEnvironment",
    family: "operations",
    reason:
      "upgrade restart and finish-environment hooks poll themselves; the operations adapter owns them",
  },
  {
    token: "useNewProjectBirths",
    family: "operations",
    reason: "births are tracked by app hooks; the operations adapter feeds the store",
  },
  {
    token: "useHqBirths",
    family: "operations",
    reason: "births are tracked by app hooks; the operations adapter feeds the store",
  },
  {
    token: "useNewMate",
    family: "operations",
    reason: "births are tracked by app hooks; the operations adapter feeds the store",
    paths: [
      "apps/web/src/components/zerops/ZeropsMateComingPage.tsx",
      "apps/web/src/components/zerops/ZeropsNewMateHost.tsx",
      "apps/web/src/zerops/matePress.ts",
      "apps/web/src/zerops/newMate.ts",
      "apps/web/src/zerops/newProjectBirth.ts",
      "apps/web/src/zerops/useMenuMateReadings.ts",
      "apps/web/src/zerops/useNewProjectBirthPorts.ts",
      "apps/web/src/zerops/useOpenMate.ts",
    ],
  },
  {
    token: "pressHold(",
    family: "operations",
    reason: "a press is held and renewed on a timer in the app; the operation's stream settles it",
    paths: ["apps/web/src/zerops/matePress.ts", "apps/web/src/zerops/useEnvironmentCreation.ts"],
  },
  {
    token: "setInterval(renewNow, PRESS_RENEW_MS)",
    family: "operations",
    reason: "a press is held and renewed on a timer in the app; the operation's stream settles it",
    paths: ["apps/web/src/zerops/matePress.ts"],
  },
  {
    token: "settlePress(",
    family: "operations",
    reason: "a press is held and renewed on a timer in the app; the operation's stream settles it",
    paths: ["apps/web/src/design/pressPage.tsx", "apps/web/src/zerops/matePress.ts"],
  },
  {
    token: "saveCreations(",
    family: "operations",
    reason: "creations and sent asks are kept by the app; the operations adapter feeds the store",
  },
  {
    token: "useSentAsks",
    family: "operations",
    reason: "creations and sent asks are kept by the app; the operations adapter feeds the store",
  },
  {
    token: "sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms))",
    family: "operations",
    reason: "the HQ update panel sleeps between its own polls; the operation's stream drives it",
    paths: [
      "apps/web/src/components/zerops/ZeropsHqUpdate.tsx",
      "apps/web/src/zerops/accountHq.ts",
    ],
  },
  {
    token: "zeropsAgentActivityOf(",
    family: "Mate attention/overview",
    reason: "Mate activity is picked by send time; the source decides, never the clock",
  },
  {
    token: "useMateActivityByProject(",
    family: "Mate attention/overview",
    reason: "Mate activity is picked by send time; the source decides, never the clock",
  },
  {
    token: "createUsageByWindowAtomFamily(",
    family: "Mate attention/overview",
    reason: "usage atoms read every Mate's shell; HQ sends what concerns the person",
  },
  {
    token: "useUsage(",
    family: "Mate attention/overview",
    reason: "usage atoms read every Mate's shell; HQ sends what concerns the person",
    paths: [
      "apps/mobile/src/features/usage/UsageRouteScreen.tsx",
      "apps/mobile/src/state/usage.ts",
      "apps/web/src/components/usage/UsagePage.tsx",
      "apps/web/src/state/usage.ts",
    ],
  },
  {
    token: "mate:zerops:conversation-writers",
    family: "permissions/members",
    reason:
      "who may write in a conversation is remembered in browser storage; the footer waits for the live answer",
  },
  {
    token: "rememberedWriter",
    family: "permissions/members",
    reason:
      "who may write in a conversation is remembered in browser storage; the footer waits for the live answer",
  },
  {
    token: "rememberWriter(",
    family: "permissions/members",
    reason:
      "who may write in a conversation is remembered in browser storage; the footer waits for the live answer",
  },
  {
    token: "useZeropsMemberNames(",
    family: "permissions/members",
    reason: "member names and Mate owners come from the member list; HQ sends them finished",
  },
  {
    token: "client.listOrganizationMembers(clientId)",
    family: "permissions/members",
    reason: "the client lists organization members for permissions; HQ computes them",
    paths: ["apps/web/src/components/zerops/ZeropsHqGate.tsx"],
  },
  {
    token: "bear(false)",
    family: "permissions/members",
    reason: "the client lists organization members for permissions; HQ computes them",
    paths: ["apps/web/src/components/zerops/ZeropsHqGate.tsx"],
  },
  {
    token: "denialConfirmationDelayMs",
    family: "permissions/members",
    reason: "a 403 is confirmed after a delay; a definitive refusal stands",
  },
  {
    token: "retryRefusedInterests",
    family: "permissions/members",
    reason: "refused reads are retried on every grant round; a definitive refusal is not retried",
  },
  {
    token: "retryRefusedHydrations",
    family: "permissions/members",
    reason: "refused reads are retried on every grant round; a definitive refusal is not retried",
  },
  {
    token: "useZeropsOrganizationMembersRead",
    family: "permissions/members",
    reason: "the client reads organization members for owners and admins; HQ sends them finished",
  },
  {
    token: "useZeropsOrganizationMembers(",
    family: "permissions/members",
    reason: "the client reads organization members for owners and admins; HQ sends them finished",
  },
  {
    token: "ownersAndAdmins(",
    family: "permissions/members",
    reason: "the client reads organization members for owners and admins; HQ sends them finished",
  },
  {
    token: "mateIsViewers(",
    family: "permissions/members",
    reason: "the Mine filter and owner records are computed in the client; HQ sends them finished",
  },
  {
    token: "mayAddEnvironment(",
    family: "permissions/members",
    reason: "whether an environment may be added is computed from roles in the client; HQ sends it",
    paths: [
      "apps/web/src/components/zerops/ZeropsProjectsPage.tsx",
      "apps/web/src/components/zerops/projects/projectsView.logic.ts",
      "apps/web/src/zerops/useAddEnvironment.ts",
    ],
  },
  {
    token: 'const writer = roleAtLeast(organization.roleCode, "ADMIN")',
    family: "permissions/members",
    reason: "tiers addable are computed from the organization role in the client; HQ sends it",
    paths: ["apps/web/src/components/zerops/projects/projectsView.logic.ts"],
  },
  {
    token: "useMayAddEnvironment",
    family: "permissions/members",
    reason: "add-environment facts are computed in the client; HQ sends what the person may do",
  },
  {
    token: "mate:zerops:mate-identities",
    family: "Mate identity/connection",
    reason:
      "Mate identities are remembered in browser storage for the first frame; the identity projection draws it",
  },
  {
    token: "rememberMateIdentities",
    family: "Mate identity/connection",
    reason:
      "Mate identities are remembered in browser storage for the first frame; the identity projection draws it",
  },
  {
    token: "rememberedMateIdentity",
    family: "Mate identity/connection",
    reason:
      "Mate identities are remembered in browser storage for the first frame; the identity projection draws it",
  },
  {
    token: "useZeropsGitRemoteProbes",
    family: "Mate identity/connection",
    reason: "a component probes git remotes itself; the adapter owns the read",
  },
  {
    token: "MATE_SETUP_POLL_MS",
    family: "Mate identity/connection",
    reason: "Mate setup is polled in the app; the Mate's stream reports setup",
  },
  {
    token: "new Map<string, SetupObservation>()",
    family: "Mate identity/connection",
    reason: "Mate setup is polled in the app; the Mate's stream reports setup",
    paths: ["apps/web/src/zerops/useMateSetup.ts"],
  },
  {
    token: "serverVersionOf(",
    family: "Mate identity/connection",
    reason: "the container version is picked by send time; the source decides, never the clock",
    paths: ["apps/web/src/zerops/zeropsContainers.ts"],
  },
  {
    token: "read.sentAt",
    family: "Mate identity/connection",
    reason: "the container version is picked by send time; the source decides, never the clock",
    paths: ["apps/web/src/zerops/zeropsContainers.ts"],
  },
  {
    token: "LIVE_GRACE_MS",
    family: "Mate identity/connection",
    reason: "a live grace timer decides a Mate is up; the stream's state says it",
    paths: ["apps/web/src/components/zerops/ZeropsMateComingPage.tsx"],
  },
  {
    token: "graceOver",
    family: "Mate identity/connection",
    reason: "a live grace timer decides a Mate is up; the stream's state says it",
    paths: ["apps/web/src/components/zerops/ZeropsMateComingPage.tsx"],
  },
  {
    token: "void readFiles().then",
    family: "Mate identity/connection",
    reason: "crew files are re-read on a timer; the Mate's stream reports changes",
    paths: ["apps/web/src/zerops/crew/useCrewHome.ts"],
  },
  {
    token: "REREAD_MS",
    family: "Mate identity/connection",
    reason: "crew files are re-read on a timer; the Mate's stream reports changes",
    paths: ["apps/web/src/components/zerops/crew/CrewSetup.tsx"],
  },
  {
    token: "createZeropsFeedAtoms",
    family: "Mate identity/connection",
    reason: "feed atoms built in the app duplicate the Mate adapter; read the projection",
  },
  {
    token: "createEnvironmentQueryAtomFamily",
    family: "Mate identity/connection",
    reason:
      "environment query and subscription atom families duplicate the Mate adapter; read the projection",
  },
  {
    token: "createEnvironmentSubscriptionAtomFamily",
    family: "Mate identity/connection",
    reason:
      "environment query and subscription atom families duplicate the Mate adapter; read the projection",
  },
  {
    token: "makeEnvironmentShellState",
    family: "Mate identity/connection",
    reason: "shell and thread state are rebuilt per environment; one store per family",
  },
  {
    token: "makeEnvironmentThreadState",
    family: "Mate identity/connection",
    reason: "shell and thread state are rebuilt per environment; one store per family",
  },
  {
    token: "resumeFamily",
    family: "Mate identity/connection",
    reason: "shell and thread state are rebuilt per environment; one store per family",
    paths: ["packages/client-runtime/src/state/threads.ts"],
  },
  {
    token: "serverConfigState",
    family: "Mate identity/connection",
    reason: "server config is read through its own atoms; the Mate adapter feeds the store",
    paths: ["packages/client-runtime/src/rpc/session.ts"],
  },
  {
    token: "initialConfigAtom",
    family: "Mate identity/connection",
    reason: "server config is read through its own atoms; the Mate adapter feeds the store",
    paths: ["packages/client-runtime/src/state/session.ts"],
  },
  {
    token: "makeContainerStore(",
    family: "Mate identity/connection",
    reason: "container, probe and exchange stores duplicate the Mate identity family",
  },
  {
    token: "makeProbeStore(",
    family: "Mate identity/connection",
    reason: "container, probe and exchange stores duplicate the Mate identity family",
  },
  {
    token: "makeExchangeDriver",
    family: "Mate identity/connection",
    reason: "container, probe and exchange stores duplicate the Mate identity family",
  },
  {
    token: "makeRegistrationRecords(",
    family: "Mate identity/connection",
    reason: "registration records duplicate the listing; the listing's projection replaces them",
  },
  {
    token: "getProjectFileQueryAtom(",
    family: "Mate identity/connection",
    reason: "project file query atoms are read and written by panels; the adapter owns the read",
  },
  {
    token: "setProjectFileQueryData(",
    family: "Mate identity/connection",
    reason: "project file query atoms are read and written by panels; the adapter owns the read",
  },
  {
    token: "await fetch(url, { signal: requestSignal })",
    family: "Mate identity/connection",
    reason: "a hook fetches workspace images itself; the adapter owns the read",
    paths: ["apps/web/src/openVsxThemes.ts"],
  },
  {
    token: "createWorkspaceFileImageAtomFamily(",
    family: "Mate identity/connection",
    reason: "a hook fetches workspace images itself; the adapter owns the read",
  },
  {
    token: "createAuthEnvironmentAtoms",
    family: "Mate identity/connection",
    reason: "auxiliary environment atom families duplicate the Mate adapter; read the projection",
  },
  {
    token: "createTerminalEnvironmentAtoms",
    family: "Mate identity/connection",
    reason: "auxiliary environment atom families duplicate the Mate adapter; read the projection",
  },
  {
    token: "createServerEnvironmentAtoms",
    family: "Mate identity/connection",
    reason: "auxiliary environment atom families duplicate the Mate adapter; read the projection",
  },
  {
    token: "createVcsEnvironmentAtoms",
    family: "Mate identity/connection",
    reason: "auxiliary environment atom families duplicate the Mate adapter; read the projection",
  },
  {
    token: "createSourceControlEnvironmentAtoms",
    family: "Mate identity/connection",
    reason: "auxiliary environment atom families duplicate the Mate adapter; read the projection",
  },
  {
    token: "createGitEnvironmentAtoms",
    family: "Mate identity/connection",
    reason: "auxiliary environment atom families duplicate the Mate adapter; read the projection",
  },
  {
    token: "createFilesystemEnvironmentAtoms",
    family: "Mate identity/connection",
    reason: "auxiliary environment atom families duplicate the Mate adapter; read the projection",
  },
  {
    token: "createReviewEnvironmentAtoms",
    family: "Mate identity/connection",
    reason: "auxiliary environment atom families duplicate the Mate adapter; read the projection",
  },
  {
    token: "createAssetEnvironmentAtoms",
    family: "Mate identity/connection",
    reason: "auxiliary environment atom families duplicate the Mate adapter; read the projection",
  },
  {
    token: "createAttachmentEnvironmentAtoms",
    family: "Mate identity/connection",
    reason: "auxiliary environment atom families duplicate the Mate adapter; read the projection",
  },
  {
    token: "createArchivedThreadSnapshotsAtomFamily",
    family: "Mate identity/connection",
    reason: "auxiliary environment atom families duplicate the Mate adapter; read the projection",
  },
  {
    token: "createThreadSearchResultsAtomFamily",
    family: "Mate identity/connection",
    reason: "auxiliary environment atom families duplicate the Mate adapter; read the projection",
  },
  {
    token: "CONVERSATION_UNVERIFIED_BOUND_MS",
    family: "Mate identity/connection",
    reason: "an unverified conversation is shown until a timer bound; the source verifies it",
  },
  {
    token: "zerops-mate.registration-records.v1",
    family: "Mate identity/connection",
    reason:
      "registration records are kept in browser storage across loads; the listing's projection replaces them",
  },
  {
    token: "recordsStorage",
    family: "Mate identity/connection",
    reason:
      "registration records are kept in browser storage across loads; the listing's projection replaces them",
    paths: ["apps/web/src/zerops/environmentPorts.ts"],
  },
  {
    token: "mate:zerops:last-conversation",
    family: "Mate identity/connection",
    reason: "the last conversation is remembered to guess a landing; the home waits for a source",
  },
  {
    token: "rememberedHomeLanding",
    family: "Mate identity/connection",
    reason: "the last conversation is remembered to guess a landing; the home waits for a source",
  },
  {
    token: "rememberLastConversation",
    family: "Mate identity/connection",
    reason: "the last conversation is remembered to guess a landing; the home waits for a source",
  },
  {
    token: "mate:composer-control:v1",
    family: "Mate identity/connection",
    reason:
      "the composer's model label is remembered in browser storage; the catalog's projection replaces it",
  },
  {
    token: "rememberedComposerControl",
    family: "Mate identity/connection",
    reason:
      "the composer's model label is remembered in browser storage; the catalog's projection replaces it",
  },
  {
    token: "rememberComposerControl",
    family: "Mate identity/connection",
    reason:
      "the composer's model label is remembered in browser storage; the catalog's projection replaces it",
  },
  {
    token: "window.location.replace(accountReturnPath())",
    family: "sign-in/session",
    reason: "the document reloads after sign-in; the store opens the account in place",
    paths: ["apps/web/src/routes/zerops_.authorized.tsx"],
  },
  {
    token: "openAccountChannel",
    family: "sign-in/session",
    reason: "the account broadcast channel has no caller; delete it",
  },
  {
    token: '"mate:account"',
    family: "sign-in/session",
    reason: "the account broadcast channel has no caller; delete it",
  },
];
