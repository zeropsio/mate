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
}

export const RETIRED_MECHANISMS: ReadonlyArray<RetiredMechanism> = [
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
  },
  {
    token: "plan.directReads",
    family: "projects",
    reason: "the data runtime's direct receivers bypass the store; adapters feed one store",
  },
  {
    token: "const rootAtom = Atom.make",
    family: "projects",
    reason:
      "a root atom per runtime and stable-atom wrappers duplicate the store; projections read the store",
  },
  {
    token: "function stableAtom",
    family: "projects",
    reason:
      "a root atom per runtime and stable-atom wrappers duplicate the store; projections read the store",
  },
  {
    token: "new Map<InterestKey, RuntimeInterest>()",
    family: "projects",
    reason: "runtime interest and receiver maps duplicate the store's subscriptions",
  },
  {
    token: "new Map<string, RuntimeReceiver>()",
    family: "projects",
    reason: "runtime interest and receiver maps duplicate the store's subscriptions",
  },
  {
    token: '"runtime-closed"',
    family: "projects",
    reason: "closing the runtime erases its facts; a transport event never deletes a fact",
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
  },
  {
    token: "historyRef",
    family: "running work/processes",
    reason:
      "refs keep a last read as a remembered verdict; the operation's stream state says what is known",
  },
  {
    token: "settledReadRef",
    family: "running work/processes",
    reason:
      "refs keep a last read as a remembered verdict; the operation's stream state says what is known",
  },
  {
    token: "rememberedRef",
    family: "running work/processes",
    reason: "a remembered ref stands in for a fact; the store holds what the source said",
  },
  {
    token: "options.pollEvery ?? Duration.seconds(10)",
    family: "running work/processes",
    reason: "the deploy rollout polls on its own clock; the source's stream drives the state",
  },
  {
    token: "followFor",
    family: "running work/processes",
    reason: "a deploy outcome decided by the clock; only the source settles an operation",
  },
  {
    token: "untakenAfter",
    family: "running work/processes",
    reason: "a deploy outcome decided by the clock; only the source settles an operation",
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
  },
  {
    token: "setLasted(true), UNREACHABLE_GRACE_MS",
    family: "running work/processes",
    reason: "a build turns unobservable after a timer; the clock never decides an outcome",
  },
  {
    token: "unreachableSinceRef",
    family: "running work/processes",
    reason: "a ref remembers when a source went unreachable; the stream exposes its own state",
  },
  {
    token: "prevServiceOutcomesRef",
    family: "services",
    reason:
      "inventory atoms and trouble refs remember a verdict; the services projection reads the store",
  },
  {
    token: "troubleRef",
    family: "services",
    reason:
      "inventory atoms and trouble refs remember a verdict; the services projection reads the store",
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
  },
  {
    token: "client.listProjectProcesses(projectId)",
    family: "services",
    reason: "a component lists services and processes itself; the services adapter owns the read",
  },
  {
    token: "const runRequest = async",
    family: "services",
    reason: "a component runs its own data-catalog requests; the adapter owns them",
  },
  {
    token: "useZeropsDataCatalogStore",
    family: "services",
    reason: "a component runs its own data-catalog requests; the adapter owns them",
  },
  {
    token: "atomRegistry.subscribe(table, changed)",
    family: "app versions",
    reason: "a registry subscription per table duplicates the store's change feed",
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
  },
  {
    token: "new WeakMap<AccountFlow, number>()",
    family: "app versions",
    reason:
      "flows subscribe to deployments with their own counters; the store feeds the projection",
  },
  {
    token: "let view: HqStructureView",
    family: "HQ structure/apps",
    reason: "a module-level HQ structure view duplicates the store; HQ's stream feeds one reducer",
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
  },
  {
    token: "menuMemory()",
    family: "HQ structure/apps",
    reason:
      "the remembered menu copies HQ structure, Mates, members and chips to storage; the store holds them in memory",
  },
  {
    token: "withChips",
    family: "HQ structure/apps",
    reason:
      "the remembered menu copies HQ structure, Mates, members and chips to storage; the store holds them in memory",
  },
  {
    token: "withMembers",
    family: "HQ structure/apps",
    reason:
      "the remembered menu copies HQ structure, Mates, members and chips to storage; the store holds them in memory",
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
  },
  {
    token: "ReturnType<typeof makeGitCredentialStore>",
    family: "HQ structure/apps",
    reason: "repository and git-credential stores are built in the app; the HQ adapter owns them",
  },
  {
    token: "input.hq.structure(",
    family: "HQ structure/apps",
    reason:
      "the whole structure is read back after an action; the action's result updates the store",
  },
  {
    token: "hq.structure(signal)",
    family: "HQ structure/apps",
    reason:
      "the whole structure is read back after an action; the action's result updates the store",
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
  },
  {
    token: "selectCandidates(",
    family: "HQ structure/apps",
    reason: "mobile selects candidates around an absent HQ itself; read the projection",
  },
  {
    token: "const appReads: Record<string, AppRead>",
    family: "HQ structure/apps",
    reason: "every app's detail is hydrated before the first snapshot; read on open",
  },
  {
    token: "event.appReads === null",
    family: "HQ structure/apps",
    reason: "null-means-delete in HQ data overwrites whole apps; events carry what changed",
  },
  {
    token: "reads === null || event.kind",
    family: "HQ structure/apps",
    reason: "null-means-delete in HQ data overwrites whole apps; events carry what changed",
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
  },
  {
    token: "Stream.tick(recheck)",
    family: "HQ structure/apps",
    reason:
      "HQ recomputes the whole view per subscriber on every tick; it computes once per change",
  },
  {
    token: "moveOffers",
    family: "HQ structure/apps",
    reason: "HQ enumerates every Mate-by-app move offer up front; ask when the dialog opens",
  },
  {
    token: "moveTo: moveOffers(",
    family: "HQ structure/apps",
    reason: "HQ enumerates every Mate-by-app move offer up front; ask when the dialog opens",
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
  },
  {
    token: "function readOnce(",
    family: "changes/review",
    reason: "a component-level LRU reads change readouts once; the changes adapter owns the read",
  },
  {
    token: "function readPicture(",
    family: "changes/review",
    reason: "a hook reads change pictures itself; the changes adapter owns the read",
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
  },
  {
    token: "effectRead(",
    family: "releases/environments",
    reason:
      "a lost grant empties every flow and hooks read on their own; hide the project when it is read",
  },
  {
    token: "setAwaiting",
    family: "releases/environments",
    reason:
      "a lost grant empties every flow and hooks read on their own; hide the project when it is read",
  },
  {
    token: "const compareAsks",
    family: "releases/environments",
    reason: "release comparisons are prepared up front; compare when a release is opened",
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
  },
  {
    token: "hq.api.compare(",
    family: "releases/environments",
    reason: "compare stores per HQ are kept in the app; the HQ adapter answers on open",
  },
  {
    token: "setHandoffTo",
    family: "releases/environments",
    reason: "the review hand-off is decided in the app; the operation's result says where to go",
  },
  {
    token: "firstReleaseHandoff(",
    family: "releases/environments",
    reason: "the review hand-off is decided in the app; the operation's result says where to go",
  },
  {
    token: "release_floor",
    family: "releases/environments",
    reason: "the release floor picks a release by time; the source names what a production follows",
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
  },
  {
    token: "STOP_WAIT_CAP_MS",
    family: "operations",
    reason: "a restart polls and gives up on its own clock; only the source settles an operation",
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
  },
  {
    token: "pressHold(",
    family: "operations",
    reason: "a press is held and renewed on a timer in the app; the operation's stream settles it",
  },
  {
    token: "setInterval(renewNow, PRESS_RENEW_MS)",
    family: "operations",
    reason: "a press is held and renewed on a timer in the app; the operation's stream settles it",
  },
  {
    token: "settlePress(",
    family: "operations",
    reason: "a press is held and renewed on a timer in the app; the operation's stream settles it",
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
  },
  {
    token: "mate:zerops:projects-risen",
    family: "Mate attention/overview",
    reason:
      "risen project rows are remembered in browser storage; the attention projection decides on load",
  },
  {
    token: "lastRowRisen",
    family: "Mate attention/overview",
    reason:
      "risen project rows are remembered in browser storage; the attention projection decides on load",
  },
  {
    token: "useRememberRisenRows",
    family: "Mate attention/overview",
    reason:
      "risen project rows are remembered in browser storage; the attention projection decides on load",
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
    token: "useHqOffers",
    family: "permissions/members",
    reason: "offers are read and decided by app hooks; HQ sends what the person may do",
  },
  {
    token: "useChangeOffers",
    family: "permissions/members",
    reason: "offers are read and decided by app hooks; HQ sends what the person may do",
  },
  {
    token: "useZeropsMemberNames(",
    family: "permissions/members",
    reason: "member names and Mate owners come from the member list; HQ sends them finished",
  },
  {
    token: "useZeropsMateOwners()",
    family: "permissions/members",
    reason: "member names and Mate owners come from the member list; HQ sends them finished",
  },
  {
    token: "client.listOrganizationMembers(clientId)",
    family: "permissions/members",
    reason: "the client lists organization members for permissions; HQ computes them",
  },
  {
    token: "bear(false)",
    family: "permissions/members",
    reason: "the client lists organization members for permissions; HQ computes them",
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
    token: "shownInScope(",
    family: "permissions/members",
    reason: "the Mine filter and owner records are computed in the client; HQ sends them finished",
  },
  {
    token: "mateIsViewers(",
    family: "permissions/members",
    reason: "the Mine filter and owner records are computed in the client; HQ sends them finished",
  },
  {
    token: "mateOwnerRecords(",
    family: "permissions/members",
    reason: "the Mine filter and owner records are computed in the client; HQ sends them finished",
  },
  {
    token: "mayAddEnvironment(",
    family: "permissions/members",
    reason: "whether an environment may be added is computed from roles in the client; HQ sends it",
  },
  {
    token: "tiersAddable(",
    family: "permissions/members",
    reason: "tiers addable are computed from the organization role in the client; HQ sends it",
  },
  {
    token: 'const writer = roleAtLeast(organization.roleCode, "ADMIN")',
    family: "permissions/members",
    reason: "tiers addable are computed from the organization role in the client; HQ sends it",
  },
  {
    token: "useMayAddEnvironment",
    family: "permissions/members",
    reason: "add-environment facts are computed in the client; HQ sends what the person may do",
  },
  {
    token: "useEnvironmentQuestionFacts",
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
  },
  {
    token: "serverVersionOf(",
    family: "Mate identity/connection",
    reason: "the container version is picked by send time; the source decides, never the clock",
  },
  {
    token: "read.sentAt",
    family: "Mate identity/connection",
    reason: "the container version is picked by send time; the source decides, never the clock",
  },
  {
    token: "LIVE_GRACE_MS",
    family: "Mate identity/connection",
    reason: "a live grace timer decides a Mate is up; the stream's state says it",
  },
  {
    token: "graceOver",
    family: "Mate identity/connection",
    reason: "a live grace timer decides a Mate is up; the stream's state says it",
  },
  {
    token: "void readFiles().then",
    family: "Mate identity/connection",
    reason: "crew files are re-read on a timer; the Mate's stream reports changes",
  },
  {
    token: "REREAD_MS",
    family: "Mate identity/connection",
    reason: "crew files are re-read on a timer; the Mate's stream reports changes",
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
  },
  {
    token: "serverConfigState",
    family: "Mate identity/connection",
    reason: "server config is read through its own atoms; the Mate adapter feeds the store",
  },
  {
    token: "initialConfigAtom",
    family: "Mate identity/connection",
    reason: "server config is read through its own atoms; the Mate adapter feeds the store",
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
    token: "accountThrowawayDebt(",
    family: "sign-in/session",
    reason: "the throwaway-token debt and its sweep run in the app; the sign-in adapter owns them",
  },
  {
    token: "useZeropsThrowawaySweep(",
    family: "sign-in/session",
    reason: "the throwaway-token debt and its sweep run in the app; the sign-in adapter owns them",
  },
  {
    token: "window.location.replace(accountReturnPath())",
    family: "sign-in/session",
    reason: "the document reloads after sign-in; the store opens the account in place",
  },
  {
    token: "endEveryKeptSession",
    family: "sign-in/session",
    reason: "kept sessions of every account are ended from one tab; each tab ends its own",
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
  {
    token: "mate:boot-frame",
    family: "sign-in/session",
    reason:
      "the boot frame is remembered in browser storage; the first frame follows the local session",
  },
  {
    token: "rememberBootFrame",
    family: "sign-in/session",
    reason:
      "the boot frame is remembered in browser storage; the first frame follows the local session",
  },
];
