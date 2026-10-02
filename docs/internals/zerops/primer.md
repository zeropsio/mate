# Zerops Mate and Gitea — the primer

2026-09-17. The one page that says what this project is, where each piece lives, what is built,
what is proven on the platform, and what is open — slice by slice. It carries **state** and nothing
else: design is the spec (`../../../../zcp/docs/spec-mate.md`, §10 for the backbone), measured facts
are the ledger (`verified.md`), the client's state model — fact owners, machines, lifetimes — is
[`client-state-model.md`](client-state-model.md), crew mode as built is [`crew.md`](crew.md), the
three-codebase contracts are `gitea-mate/docs/`, and the owner's screen-by-screen notes are the journal in
`../../../../zcp/plans/` (transient). A row here changes
in the commit that changes the fact; the commit is the evidence.

The slice numbering follows the 2026-09-15 implementation guide (`zerops-auth-backbone-implementation-2026-09-15.md`, transient) so the two can be read side by side; the guide plans, this page reports.

---

## 1. What it is

Every Zerops org that uses Mate gets one **Gitea project** — Gitea, Postgres, a volume and the
**broker** — made by the app with the org's first _New project_. An app is a **group**: an entry
in a registry kept as tags on the Gitea project, never a Zerops project of its own. Each person
works in a **Mate**: a Zerops project with a `zcp` container running the Mate server and a coding
agent, one dev/stage pair per codebase. Gitea holds one **group repo** per group — the recipe
(every environment's import) and `environments.yaml` — and one repository per codebase.

The **broker** mirrors Zerops roles into Gitea on a timer, signs people in to Gitea as an OIDC
provider, delivers every registered Mate its Gitea bot token, imports and wakes a group's Actions
runner, and holds the account's only deploy key: a stage follows the head of its source branches,
production the commits of the newest release tag whose pusher it approved. **zcp**, inside a Mate,
reads its three Gitea variables from the live env store, gets each dev pair a repository from the
broker, pushes its branch and opens the pull request, proposes the recipe to the group repo, and
ships the workflow that asks the broker to deploy.

Who proves what: a person's own Zerops token stays in the app. Opening a Mate hands its door a
throwaway token; signing in to Gitea hands the broker one. A Mate's Zerops key reaches its own
project only and never leaves its container. Nothing in CI holds a deploy credential.

```
Zerops org (the owner)
├── Gitea — tagged mate:tool:gitea; made with the org's first New project
│   ├── web (Gitea), db (postgresql@18, one node), volume
│   ├── broker — gitea-mate: the registry, the rights loop, OIDC, deploys
│   └── runner{group} — one per group, imported on its first workflow, asleep when idle
└── Imperial Titan — a group: registry tags on the Gitea project, no project of its own
    ├── Imperial Titan - Fen — a Mate, named after its bot: zcp, the Mate server, the agent; its dev/stage pairs
    ├── stage — Add stage: a project from the recipe's Stage tier, follows main
    └── production — Add production: from the Production tier, code only by release

Gitea org imperial-titan
├── imperial-titan/group — the recipe tiers, environments.yaml, release tags v*
└── imperial-titan/<service> — one per dev pair, made by the broker at zcp's request
```

## 2. The parts and where they live

- **The app — web, desktop, mobile** — this repo (`zeropsio/mate`): `apps/web/src/zerops`,
  `apps/web/src/components/zerops`, `packages/client-runtime/src/zerops`
  - _Released as:_ mate **0.11.17**
  - _Does:_ sign-in, the projects page, _New project_, the registry, throwaways, Gitea as the
    person, _Add Mate_, _Add stage_, _Add production_, _Release_, the Git tab, the project's flow
    (D26), the Gitea overview
- **The Mate server** — `apps/server/src/zerops`
  - _Released as:_ mate 0.11.14 (the turn-end refresh of every checkout, 0.11.12; otherwise
    unchanged since 0.11.5), installed into every Mate by zcp from the release manifest
  - _Does:_ the door (`zerops-throwaway`), the membership watch, the agent-signer gate, the checkout
    side of the Git tab
- **The role function** — `packages/shared/src/zeropsRoles.ts` and `gitea-mate/internal/roles`;
  `zeropsRoles.fixtures.json` byte-identical in both
  - _Released as:_ with each
  - _Does:_ one rule for the list, the door and the broker
- **zcp** — `../zcp`
  - _Released as:_ zcp **v9.180.2** (a Mate boots the latest release; a running one keeps its build
    — `update.Once` caches a day)
  - _Does:_ in every Mate: the three Gitea variables from the live env store, a repository per dev
    pair, the pull request, the recipe pull request, the `.gitea` workflow, Gitea as a forge kind
- **The broker; Gitea on Zerops** — `../gitea-mate` (`zeropsio/gitea-mate`): `cmd/broker`, `gitea/`
  (app.ini, init scripts), `import/` (what the app sends, a group's runner), `actions/deploy`
  - _Released as:_ gitea-mate **v4.0** (the tag `v4` is what a workflow pins); the import builds
    both code services from `main`, so a push to `main` is the release and a tag is a marker
  - _Does:_ the registry, the rights loop, Mate access, a person's Gitea token, OIDC, deploys, the
    runner pool

The app carries a byte-identical copy of `gitea-mate/import/gitea-project.yaml`
(`packages/client-runtime/src/zerops/giteaProjectImport.yaml`, asserted equal by `giteaRecipe.test.ts`
when the checkouts sit side by side); a change to the import is copied over, never edited here.

## 3. Who holds what

- **a person's Zerops token** — the app
  - _Reaches:_ the Zerops API only; no container, since mate 0.11.0 (`e816562f5`)
- **a door throwaway `mate-door:{project}:{nonce}`** — minted by the app for one connect,
  `NO_ACCESS`, no grants, no flags; deleted right after
  - _Reaches:_ one Mate's door, which reads its creator and looks the role up with its own key
- **a Gitea throwaway `gitea-signin:{host}:{nonce}`** — minted by the app for one call to the broker
  — the person's token, or the consent step of Gitea's own sign-in; deleted right after
  - _Reaches:_ the broker's `POST /person/token` and `POST /oidc/complete`
- **a Mate's Zerops key `ZCP_API_KEY`** — `NO_ACCESS` at the org, `BASIC_USER` on its own project; a
  sensitive variable of its `zcp` service with the delegation deleted when `createEnvironment` made
  the Mate — a Mate made by _New project_ still holds it at project level with its delegation (open,
  §7)
  - _Reaches:_ its own project — the door's role reads, zcp's every platform call
- **a Mate's Gitea token `GITEA_TOKEN` (`mate/{bot}/{n}`)** — its `zcp` service, written by the
  broker's rights loop with `GITEA_URL` and `MATE_BROKER_URL` (D20)
  - _Reaches:_ write on its group's service repositories — made at its request, or joined when they
    exist (D24); read on the group repo
- **a person's Gitea token (`mate-app/{stamp}`)** — the tab's memory, from the broker on a throwaway
  (D21); the rights loop retires it after 12 h and the app mints again on the first 401
  - _Reaches:_ exactly what the person may in Gitea — the mirrored rights
- **the broker's Zerops token `mate-broker`** — the broker's service env, minted by the app as the
  owner
  - _Reaches:_ org `READ_ONLY`; `BASIC_USER` on the Gitea project, on every Mate project (at
    registration) and on every stage and production (at creation) — the only deploy key
- **the broker's OIDC seed, webhook secret, OAuth secret** — generated inside the import by the
  platform's preprocessor
  - _Reaches:_ never through a browser
- **Gitea's admin token and password** — `web`'s variables, referenced from the broker; read from
  the platform when the reference has not resolved or Gitea refuses it (gitea-mate v2.1)
  - _Reaches:_ nothing outside the Gitea project
- **an agent's login** — each Mate; the signer recorded as the project tag
  `mate:signer:{agent}:{userId}`, written by the app as the person
  - _Reaches:_ turns from the signer only; signed out when the signer leaves the org
- **a job's token** — Gitea Actions, dead 0.1 s after the job
  - _Reaches:_ `POST /deploy`, where the broker proves the repository the job runs in
- **a deploy token in Gitea, a repository or a runner** — none

## 4. How a run goes today

From an emptied org, through the localhost client on mate 0.11.5 with gitea-mate v2.1 (ledger, _D20
driven end to end_, _The backbone's first live run_, _A real Mate through the backbone_):

1. **New project** (name, location). The app creates the Gitea project, mints the broker's token,
   imports `gitea-project.yaml`, writes the group and the Mate into the registry, creates the Mate
   project with its `zcp` container, and grants the broker the Mate project. The projects page
   carries the boot on the Mate's card; a creation the platform failed reads "Could not be created."
2. **The Mate is up** 40–100 s after registration; Gitea's four services in about three minutes.
   The birth wait (spec §4.4) hardens it before anyone is admitted — `envIsolation: service`, the
   key on the `zcp` service, the app containers restarted, the `zcp` container never — and the
   group-reach reconcile lowers the key and drops the delegation from any page (0.11.39).
3. **The broker's first pass** once Gitea answers: the Gitea org, its three teams, the group repo
   with `main` protected, the org hook, the Mate's restricted bot, its token, and the three variables
   on the Mate's `zcp` service — 328 s after registration in the last run, nothing restarted.
4. **The person opens the Mate** through the throwaway door and signs the agent in; the signer is
   recorded and the composer opens for them alone. The Git tab signs them in to Gitea by itself
   (D21, 0.11.6; a refusal said in Gitea's words, 0.11.8).
5. **zcp** reads the variables from the live env store, gets each dev pair a repository from the
   broker, and proposes the recipe (three tiers) to the group repo as a pull request from its fork,
   which the broker merges on its next pass (D23 — ten seconds on the owner's Todo run). The first
   deploy onto the pair's stage half commits the dev half's tree, pushes the pair's branch and opens
   its pull request (D25, zcp v9.179.1; before it the agent pushed only when told to).
6. **Add stage**: a project from the Stage tier, `environments.yaml` declared, the broker's token
   widened; a merge into `main` deploys through the webhook in 15 s and serves in under three
   minutes; a workflow's deploy through `actions/deploy@v1` with the job's token, the group's runner
   imported on its first job.
7. **Add production**, then **Release**: a `v*` tag on the group repo as the person, judged on its
   pusher, the stage artifact promoted — 64 s from the click to production on the owner's run
   (ledger, _The whole chain through the UI_).
8. **Add Mate**: a second Mate from the AI Agent tier, registered as its project exists; its zcp
   joins the group's repository (D24), cuts its branch from `main`, deploys the code it finds, and
   a feature it ships reaches the stage through the same merge (ledger, the same section).

## 5. Status, slice by slice

**live** = built and proven on the platform · **built** = code and tests, no live proof yet ·
**partial** · **open** · **superseded**. "Built in" names the commit or release; "proven by" a
ledger row or a test.

- **0.1** — zcp on a `BASIC_USER` container token
  - _State:_ live
  - _Proven by:_ ledger 2026-09-16 _A `BASIC_USER` project token does everything zcp does_
- **0.2** — Each Mate's key lowered to `NO_ACCESS` + `BASIC_USER` on its project
  - _State:_ live — the creation step and the projects page's reconcile
  - _Built in:_ mate 0.11.0 `04a8468d5`
  - _Proven by:_ `groupReach.test.ts`; the reconcile's work seen live in ledger _The first Mate on
    an emptied org…_ (the key gone from the project)
- **0.3** — Group reach narrows by itself, widens only on a person's action
  - _State:_ live
  - _Built in:_ mate 0.11.0 (`planGroupReach`, `useZeropsGroupReach`)
  - _Proven by:_ `groupReach.test.ts`
- **0.4** — The creation delegation deleted
  - _State:_ partial — a `createEnvironment` step only; a Mate made by _New project_ (one call since
    0.11.2) keeps its delegation
  - _Built in:_ mate 0.11.0 `cd7ae7f2b`
  - _Proven by:_ `createEnvironment.test.ts`; the gap measured 2026-09-17 on Zane (ledger _The
    owner's first run through the hosted client_)
- **0.5** — The door refuses integration tokens (interim)
  - _State:_ superseded by 3.2 — the door takes nothing but a throwaway
- **0.6** — The _Update_ verb's scope
  - _State:_ live
  - _Built in:_ mate 0.11.0 `2ff377304`
- **0.7** — Who signed an agent in: shown, recorded as a tag, enforced, signed out on leaving
  - _State:_ live
  - _Built in:_ mate 0.11.0 `3de58df29`; the record seen at once, 0.11.4 `8d8b81c9d` `a913455f2`
  - _Proven by:_ ledger _A signer record written after the login lands…_;
    `ZeropsProjectSigners.test.ts` — "signs out the agent whose signer the org no longer knows"
- **0.8** — One admission rule, verbs by role, _Assign_
  - _State:_ live
  - _Built in:_ mate 0.11.0 `949693a1c`, `6f662df6c`
  - _Proven by:_ `mateAccess.test.ts`
- **0.9** — zcp stops handing its key out
  - _State:_ live
  - _Built in:_ zcp v9.176.0 `e36c6352`
  - _Proven by:_ `workflow_build_integration_citoken_test.go`, `deploy_ssh_test.go`
- **0.10** — A Mate's project isolated, the key moved onto `zcp`
  - _State:_ partial — a `createEnvironment` step only; `planProjectIsolation` has no caller on the
    projects page, so a Mate made by _New project_ runs `envIsolation: none` with its key at project
    level
  - _Built in:_ mate 0.11.0 `0e75042bf`
  - _Proven by:_ ledger _Isolation flipped live…_; `projectIsolation.test.ts`; the gap measured
    2026-09-17 on Zane
- **1.1** — The hardened recipe
  - _State:_ built; `start.sh` serves only with the zerops login source (v3.2, after the 2026-09-17
    gap); `gitea dump` scripted, the restore not written
  - _Built in:_ gitea-mate `gitea/app.ini`, `admin-init.sh`, `start.sh`, `dump.sh`
  - _Proven by:_ ledger _The backbone's first live run_ (Gitea up in under three minutes; sign-in
    only through the broker); _The owner's run through localhost on 0.11.7_ (the source left for a
    boot that never came); `TestStartRefusesToServeWithoutTheZeropsSource`
- **1.2** — Gitea for the org; the registry
  - _State:_ live — Gitea comes with the first _New project_, not at sign-up (§6, D18)
  - _Built in:_ mate 0.11.0 `dbfc3d03f` `665c88395`; 0.11.1 `7ea884702`
  - _Proven by:_ ledger _The first Mate on an emptied org…_, _D20 driven end to end_
- **1.3** — The broker — its shape
  - _State:_ live — its own repository (§6, D4); catch-up after downtime measured
  - _Built in:_ gitea-mate v1 `6663cbb` …
  - _Proven by:_ ledger _The backbone's first live run_ (broker down, a merge, broker up → one
    deploy)
- **1.4** — The rights mirror and the shared role function
  - _State:_ live on the broker's side; the app's _Remove member_ flow (Mate keys replaced, the
    leaver's tokens) **open**
  - _Built in:_ gitea-mate `44b9e63` `706a484`; fork `08538e37e`; Go twin `fba66c3`
  - _Proven by:_ ledger _The backbone's first live run_ (a group in 80 s, a sign-in in the right
    teams); `TestAReadThatFailsWritesNothing`, `TestAPlanOverTheCapIsReportedNotApplied`,
    `TestDeparturesAreDisabledNotDeleted`
- **1.5** — A Mate's Gitea access
  - _State:_ live — delivered by the rights loop (D20); bot restricted in its readers; repositories
    on request; token generations with a grace
  - _Built in:_ gitea-mate v2 `3c64092` `8bffe09`, v2.1 `47752ff`; mate 0.11.5 `fe4552b46`
    `648df9a8a`
  - _Proven by:_ ledger _D20 driven end to end_ (328 s, no restart; the bot, the group repo, a
    repository made with the delivered token); `TestPassDeliversAMatesAccessOnceAndNeverRestarts`
- **1.6** — The runner pool
  - _State:_ partial — imported on a group's first workflow and removed with the group (live); woken
    and slept on `workflow_job` (built); a runner whose build failed is replaced within bounds and
    every download in its build retries (gitea-mate #7, live on the test org's broker 2026-10-02;
    run 5's new runner built at the first try in 103 s, so the replacement is proven by its tests
    only); the cross-org `runs-on` proof not measured
  - _Built in:_ gitea-mate `6933c4d`, `runnerPool`; #7 `76f259c`
  - _Proven by:_ ledger _The backbone's first live run_ (a runner in 117 s, the job green in 71 s),
    _Run 4 as measured_ (the failed download, never rebuilt); `TestWorkflowJobWakesAndSleepsTheRunner`,
    `TestABuildThatAlwaysFailsIsBoundedAndStops`, `TestARunnerDeletedButNotImportedIsOwedOne`
- **2.1** — Git per dev pair, as early as possible
  - _State:_ live
  - _Built in:_ zcp v9.176.0 `3e344982` `0daca3f1` `d85814ed`
  - _Proven by:_ ledger _A real Mate through the backbone_; `e2e/gitea_backbone_live_test.go`
    (tag-gated)
- **2.2** — The recipe proposed to the group repo, kept current
  - _State:_ live — proposed by zcp as a pull request; merged by the broker on arrival (D23,
    gitea-mate v3.4; on the owner's first run of 2026-09-17 PR #1 waited for a releaser; on the
    second, PR #1 merged nine seconds after it opened, 13:18:23Z → 13:18:32Z)
  - _Built in:_ zcp v9.176.0 `96a7d864` `83bd6a75` `979d4510`; gitea-mate v3.3
  - _Proven by:_ ledger _A real Mate through the backbone_ (PR #1 with three tiers; "already
    current" on a second call), _The owner's second run on 0.11.11_ (merged in nine seconds);
    `TestAMatesRecipePullRequestIsMergedByThePass`
- **2.3** — Gitea as a forge kind; the `.gitea` workflow that asks the broker
  - _State:_ live
  - _Built in:_ zcp v9.176.0 `6cbc99e4` `cba561ad` `ed7081c9`
  - _Proven by:_ the e2e test asserts the workflow carries no secret, no Zerops token, no zcli
- **2.4** — Joining from the recipe
  - _State:_ live — Fen, the owner's from-scratch run of 2026-09-17: made from the AI Agent tier,
    registered, its bot a collaborator on `todo/appdev` (D24), its branch cut from `main` (the
    zcp-init commit over the merge), the code deployed to its own pair, a feature ("Add a due date
    to each todo.") committed, delivered by its stage deploy, merged from its Git tab and on the
    group's stage 56 s later
  - _Built in:_ zcp `c5953c0a`, v9.179.1; gitea-mate v3.5 `aadc0c5`; fork `31258c172`, `e5135ce25`,
    `0efb6c98a`
  - _Proven by:_ ledger _The whole chain through the UI, from a wiped org_; gitea-mate
    `TestASecondMateJoinsAServiceRepositoryOfItsGroup`; `brokerGrant.test.ts` "registerMateInGroup"
- **3.1** — The app mints and deletes throwaways
  - _State:_ live
  - _Built in:_ mate 0.11.0 `83a082e1d`
  - _Proven by:_ `zeropsThrowaway.test.ts`, `doorThrowaway.test.ts`
- **3.2** — The door accepts only a throwaway
  - _State:_ live — `zerops-throwaway` is the one bootstrap method in Zerops mode
  - _Built in:_ mate 0.11.0 `e430e9838`; the member-list key, 0.11.1 `7e57be0e3`
  - _Proven by:_ ledger _The first Mate on an emptied org…_; `ZeropsThrowawayIdentity.test.ts`,
    `ZeropsIdentityGate.test.ts`
- **3.3** — The Mate re-checks roles itself
  - _State:_ live
  - _Built in:_ mate 0.11.0 `f2d80d23e`
  - _Proven by:_ `ZeropsMembershipWatch.test.ts`
- **3.4** — `READ_ONLY` sees a Mate, cannot open it
  - _State:_ live
  - _Built in:_ mate 0.11.0 `9af8881fd`
  - _Proven by:_ `mateAccess.test.ts`
- **3.5** — No Zerops token to a container; the 15-minute re-mint gone
  - _State:_ live — minimum server 0.11.0
  - _Built in:_ mate 0.11.0 `e816562f5`
  - _Proven by:_ `credentialRenewal.ts` — nothing renews a Zerops session
- **3.6** — The broker signs people in to Gitea
  - _State:_ live — the OIDC provider for Gitea's own pages; the app's consent page completes on its
    own (0.11.6)
  - _Built in:_ gitea-mate `4af0c01` `75e4389`; mate 0.11.0 `35d6c9d26`, 0.11.6 `e6b1662f2`
  - _Proven by:_ ledger _The backbone's first live run_ (consent by throwaway in 134 ms; `u-{id}`
    admin and in three teams)
- **4.1** — _Add project_ writes a group; the broker makes its org, teams and group repo
  - _State:_ live
  - _Built in:_ mate 0.11.0 `331367acb`; 0.11.2 `271a530d8` (one form)
  - _Proven by:_ ledger _D20 driven end to end_
- **4.2** — The first Mate, registered at birth
  - _State:_ live; the brief is gone (§6, D17) — nothing is prefilled; since pass 19 its person
    names it and picks its face in the wizard, and their first sign-in sends the stand-up, as _Add
    Mate_'s does
  - _Built in:_ mate 0.11.0 `311546d8d`; 0.11.2 `271a530d8`; pass 19 `132306274` `26be501e6`
  - _Proven by:_ `birthStore.test.ts`, `newProject.test.ts`
- **4.3** — _Add Mate_ from the group repo's recipe
  - _State:_ live — the read from `main`, the converter to `startWithoutCode`, the registry entry
    and the broker's grant as soon as the project exists (a step after it failed on Fen's creation,
    unmeasured which; the Mate ran unregistered until `e5135ce25`), the hand-off remembered the same
    way (`0efb6c98a`); since pass 18 the dialog asks only a name, a colour and a shape and always
    deploys the recipe, its verb _Add Fen to Todo_; since pass 19 it opens over the view on screen
    and lands on the new Mate's own view
  - _Built in:_ mate 0.11.0 `b296a0139`; fork `31258c172`, `e5135ce25`, `0efb6c98a`; the dialog
    `4375984ff`
  - _Proven by:_ `recipeTier.test.ts`, `recipeTierImport.test.ts`, `brokerGrant.test.ts`; ledger
    _The whole chain through the UI_
- **4.4** — Gitea inside Mate, as the person
  - _State:_ live — the person's token from the broker on a throwaway, no Gitea screen (D21; 0.11.6,
    gitea-mate v3); one Gitea serves every app origin (D22; 0.11.7, v3.1); a refusal said in Gitea's
    words in place of the sign-in line (0.11.8, v3.2); repositories, branches, pull requests and
    merges, runs, jobs, logs, reruns, statuses, tags
  - _Built in:_ mate 0.11.0 `44320d3be`, 0.11.6 `e6b1662f2`, 0.11.7, 0.11.8; gitea-mate v3
    `93969e9`, v3.1 `722378c`, v3.2
  - _Proven by:_ ledger _The owner's run through localhost on 0.11.7_ (the app's own call answered
    200, the token acts as the owner: site admin, source 1, the org and its teams);
    `giteaSession.test.ts`, `giteaBroker.test.ts`, `giteaRecipe.test.ts`; gitea-mate
    `TestAPersonGetsATokenThatActsAsThemAndAnAccountBoundToTheSource`,
    `TestPersonTokenAnswersEveryOrigin`, `TestAGiteaRefusalIsAnsweredInItsWordsNotAsStillSettingUp`
- **4.5** — The Git tab, the project's flow
  - _State:_ live — the Git tab is the Mate's own leg since 0.11.16 (D26): _Push_, _Update from
    main_, _Open pull request_, _Merge_ (a _Review_ since pass 16), the remote probed live; the
    project's flow is the left menu's (Mates and their open pull requests — a timeline with stage
    and production rows and _Merge_ and _Release_ inline until pass 16 made production one chip on
    the heading and every verb a _Review_) and the projects screen's rows (the Mates' pull requests,
    the environments, the release gate, the releases with _Roll back to this_, the recipe changes),
    read once for the account; the Gitea overview at `/gitea` from the footer; _Open pull request_
    and _Merge_ wired to Gitea as the person since 0.11.14
  - _Built in:_ mate 0.11.0 `253c402ca` `9223ddf02` `be946f5b0`; 0.11.16
  - _Proven by:_ `gitTab.test.ts`, `projectFlow.test.ts`, `giteaOverview.test.ts`,
    `SidebarZeropsTree.test.tsx` "the project's flow under it", `ZeropsGitPanel.test.tsx`,
    `ZeropsGiteaPage.test.tsx`; ledger _The Git tab split_
- **—** — The projects page and _New project_ rebuilt from the owner's notes
  - _State:_ live; the design pass **open** (§7)
  - _Built in:_ mate 0.11.2 `68634f145` `e090a363b` `7abefe78f` `938de7167`; 0.11.3 `682ce19ed`
  - _Proven by:_ ledger _A project creation that the platform failed after answering 200_
- **5.1** — Environments declared in the group repo
  - _State:_ live
  - _Built in:_ gitea-mate `cc3f1c9`; fork `groupEnvironments.ts`
  - _Proven by:_ ledger _A real Mate through the backbone_ (the broker deploys what the Mate pushed)
- **5.2** — _Add stage_, _Add production_
  - _State:_ live for a stage and a production (the rehearsal of 2026-09-17: both from their rows,
    the stage deployed by the broker, production released to); the page asks for both once the
    recipe is on `main` — rows "Stage · not set up yet · Add stage" (0.11.13); a creation whose
    group writes a reload lost is finished by the page on its next read (0.11.14)
  - _Built in:_ mate 0.11.0 `86d36d625`
  - _Proven by:_ ledger _The backbone's first live run_
- **5.3** — The broker deploys from protected state only
  - _State:_ live — archive or promotion; a queue per environment; commit statuses; `env/*` merges
  - _Built in:_ gitea-mate `9183d6d` `3f97ffc` `476bb5c`
  - _Proven by:_ ledger _The backbone's first live run_ (stage +15 s, serving +173 s);
    `TestNewestApprovedReadsTheStatusesNotTheTagList`, `TestAConflictKeepsTheLastGoodMerge`
- **5.4** — Workflows orchestrate through `POST /deploy`
  - _State:_ live
  - _Built in:_ gitea-mate `0c486b6`, `actions/deploy`
  - _Proven by:_ ledger _The backbone's first live run_ (the action with a job token, green in 71 s)
- **5.5** — Release — a tag as the person, judged on its pusher; the Mate switch (D8)
  - _State:_ live — `v0.1.0` on the rehearsal of 2026-09-17 and again on the owner's from-scratch
    run the same evening (one click in the Git tab, no dialog; "approved" in a second, the stage
    artifact promoted, deployed in 64 s, published from the row, the second Mate's feature in
    production)
  - _Built in:_ mate 0.11.0 `279b2dc7a`; gitea-mate `476bb5c`, `hooks.go` (the switch)
  - _Proven by:_ `release.test.ts`; `TestAReleaseIsJudgedOnItsPusher`,
    `TestARefusedTagStaysRefusedAcrossBothPaths`
- **5.6** — Rollback — a new tag listing an earlier tag's commits
  - _State:_ **live** — Todo's production rolled back from `v0.1.3` to `v0.1.2`'s commits as
    `v0.1.4` in 71 s, then released again as `v0.1.5` in 64 s, 2026-09-18 (ledger, _The last tests
    before the hand-off to zcp hardening_)
  - _Built in:_ mate 0.11.0 `release.ts` `rollbackTo`, _Roll back to this_
  - _Proven by:_ `release.test.ts`; the ledger's run
- **5.7** — A job deploys with `zcli push`; the broker dispatches and grants (D27)
  - _State:_ **live** — proven twice on 2026-09-18 (ledger, _D27 and D28 proven live, twice_):
    Todo's stage from a push in 58 s, Notes' production from a release in 2 min 24 s; earlier state:
    — mate 0.11.17, zcp v9.180.0, gitea-mate v4.0 (2026-09-18); the test org's broker redeployed
    from it and its old runner deleted (ledger, _D27 rolled out to the test org_): gitea-mate (the
    dispatcher in place of the executor, `POST /deploy/grant` and `/deploy/{id}/result`, the
    runner's trust read from the org's runs, a tainted runner replaced, zcli pinned in the runner
    image, the action's `deploy.sh`), zcp (the workflow with `workflow_dispatch` and
    `actions/deploy@v4`), the app (an environment's deploy token minted at _Add stage_ / _Add
    production_ and by the page's repair, kept on the broker's service). Supersedes 5.3's archive
    and promotion and 5.4's `POST /deploy` once merged
  - _Built in:_ gitea-mate `36c011e`…`451392a`, zcp `599ddfb5` `ec08f453`, fork `de9137aed`
    `8bf7b01a8`
  - _Proven by:_ gitea-mate `internal/pipeline/grant_test.go`, `internal/deploy/dispatcher_test.go`,
    `internal/server/deploy_test.go`, `script_test.go` (the action against a scripted broker and a
    stub zcli); zcp `gitea_workflow_emit_test.go`; fork `deployToken.test.ts`,
    `addGroupEnvironment.test.ts`, `groupEnvironments.test.ts`
- **5.8** — A project with no stage releases what is merged (D28)
  - _State:_ **live** — Notes released `v0.1.0` listing `notes/appdev`'s `main` head, 2026-09-18;
    the candidate is each production repository's `main`, the offer carries the entries the tag
    lists
  - _Built in:_ fork `7b1026ee2`
  - _Proven by:_ `release.test.ts` "a project with no stage releases what main holds";
    `groupDeploys.test.ts` "what a release from main has to read"
- **5.9** — One task per pull request: squash, merge in the conversation, the base taken in
  - _State:_ **live** — Todo #6, #7, #8 and Notes #2 merged from their Mates' conversations as
    squashes, each stage live about a minute after the merge; the delivery took `main` in by itself
    on Iris's branch (v9.180.1) and Fen's git-push went to its own branch (v9.180.2), 2026-09-18.
    Found on the way and fixed: the banner stayed after its merge, and the pull the verb ran after
    it never ran (no working directory) — removed, the branch takes `main` in at its next delivery
  - _Built in:_ fork `2de4f2305` `28c3acbff` `fffea4c02` `d3ca1902e` `3a9b48bba`, zcp `3b8616d7`
    `4a5aa2de` `84b12930`
  - _Proven by:_ `mateReview.test.ts`; `giteaClient.test.ts` "squashes by default"; zcp
    `TestBuildGiteaDeliveryCommand_TakesTheBaseInBeforeItPushes`,
    `TestADeliveryBringsTheWorkflowToThisZcps`
- **—** — Recipe deltas imported into each environment of a tier on merge
  - _State:_ built
  - _Built in:_ gitea-mate `d6d97a6`; a changed declaration reported, never applied, `6f6372a`
  - _Proven by:_ `TestARecipeChangeIsImportedIntoEveryEnvironmentOfItsTier`
- **—** — The client state model: fact owners, machines, lifetimes
  - _State:_ partial — Phases 0 to 3 built except 2.5; of Phase 4 the forge store with one
    `MergeState`, the registry as a projection of tags and the one tag writer; Phase 5 open. Item by
    item: [`client-state-model.md`](client-state-model.md#status-by-phase)
  - _Built in:_ mate `main`, merged wave by wave from `e22e38db0`
  - _Proven by:_ the sign-in guards (`ZeropsInventoryProvider.lifecycle.test.tsx`); the zone tests
    (`scripts/mate-zone-architecture.test.ts`)
- **—** — Pass 16: the left menu — rows, the production chip, crews, the band, search
  - _State:_ **live** at the owner's size on the localhost pair, 2026-09-29: at 435 and 256 px the
    faces at 16 px and every word at 56, rows of 76, 58 and 48 px, 30 px from one Mate's words to
    the next's, the menu's words in four sizes (16, 14, 13 and 12 px). The production chip and its
    menu, the crew line, the selected band and a pressed heading that moves 0 px on every frame are
    measured in the harness. **Open**: a working row's step and a waiting row's question (D5, D6)
    are seen on a Mate only once its server runs this build (§7, 34)
  - _Built in:_ mate 0.11.63 (PR #32)
  - _Proven by:_ `SidebarMateRow.logic.test.ts`, `SidebarProductionChip.logic.test.ts`,
    `SidebarProjects.logic.test.ts`, `SidebarSelectedBand.logic.test.ts`,
    `SidebarCrewLine.logic.test.ts`, `SidebarJumpButton.test.tsx`, `menuMemory.test.ts`; the harness
    `/design.html?set=plan`; ledger _Pass 16 as measured_
- **—** — Pass 16: the run's card — a quiet tray, the now line, the fold, a live result
  - _State:_ **live** in the conversation, 2026-09-29: the tray and its 30 px corners, 24 px ink to
    ink from the person's words to the card and from the card to the answer. The now line through a
    run, the fold on return ("Show work" moving the line above it 0 px) and every state of the
    result are measured in the working harness. **Open**: a real pushed change's result row, and its
    "merged as #2", not yet seen live
  - _Built in:_ mate 0.11.63 (PR #32)
  - _Proven by:_ `runCard.logic.test.ts`, `runResult.logic.test.ts`, `runResultFacts.test.ts`,
    `RunChat.test.tsx`, `TurnReport.test.tsx`, `workSteps.logic.test.ts`,
    `MessagesTimeline.logic.test.ts`; the harness `/design-working.html`
- **—** — Pass 16: the conversation and the composer — its top, one control, one white
  - _State:_ **live**, 2026-09-29: turns 24 px inside and about 65 apart, the neutral bubble, the
    header's one button style, the composer the one white surface; the composer's top — the Mate's
    own change as _Review_ — in the first paint wherever this browser remembers it, and the
    conversation never moving (before, the strip came with Gitea's answer 8.6 s after a reload and
    moved the conversation 61 px). **Open**: the flow's pull requests still arrive about 8.6 s after
    a reload (§7, 34)
  - _Built in:_ mate 0.11.63 (PR #32)
  - _Proven by:_ `MessagesTimeline.logic.test.ts` (the gaps, the seams),
    `ZeropsNextStepBanner.test.tsx`, `composerTopMemory.test.ts`, `mateNextStep.test.ts`,
    `ComposerModelControl.logic.test.ts`, `composerTypeScale.test.ts`
- **—** — Pass 16: composer pictures (D9)
  - _State:_ **live** in a Mate's composer, 2026-09-29: a 3210 × 2118 paste stood in the text as a
    121 × 80 picture, and its view said "Sends 2000 × 1320 · PNG, 595 KB" (removed after, never
    sent); a send with _Keep original_ and an image error are not yet seen live. The server fits a
    picture over the limits for every provider, on a worker thread, one at a time. **Open**: Codex
    keeps its image order — its adapter is ported code — so there only the labels tie a picture to
    its place (§7, 34)
  - _Built in:_ mate 0.11.63 (PR #32); the server's worker `dbb52f3eb`
  - _Proven by:_ `composerPictures.test.ts` (shared and web), `imageCompression.test.ts`,
    `ComposerPromptEditor.pictures.test.tsx`, `messagePictures.logic.test.ts`,
    `attachmentFit.test.ts`, `Normalizer.attachments.test.ts`, `ClaudeAdapter.test.ts`; the harness
    `/design-pictures.html`
- **—** — Pass 16: Review, the one door to merge, land, release and roll back (D12)
  - _State:_ built; **live** for a change opened from the composer's top, 2026-09-29: Gitea's real
    files and diff, the verdict "Ready to merge · No checks ran · no conflicts with main · 19
    commits", _Try it_, _Merge_ focused with ⌘↵, Esc closing it and the focus back on what opened it
    — nothing pressed. **Open**: a merge, a release and a roll back through it not run live yet;
    "What it does" (R3) was empty for a change whose run never linked it (§7, 34)
  - _Built in:_ mate 0.11.63 (PR #32)
  - _Proven by:_ `reviewVerdict.test.ts`, `changeDiff.test.ts`, `giteaClient.test.ts`,
    `ZeropsReview.logic.test.ts`, `ZeropsReviewDoors.test.tsx` "every door opens the review and
    never acts itself (R1)"; the harness `/design-change.html?review=all`
- **—** — Pass 16: a thread's live step and waiting question on its shell (D5, D6)
  - _State:_ built — the Mate server relays a running thread's step and a waiting thread's first
    question on its shell, in memory, with no migration and no push added; replayed through the
    recorded Claude streams. **Open**: a Mate shows them only once its server runs this build, which
    its _Update_ brings with a restart; none has yet, so neither is seen live (§7, 34)
  - _Built in:_ mate 0.11.63: `1fea2484b` `56f708bea` `c7172999c` `d49ce44a1` `a5c9cf89e`
  - _Proven by:_ `ThreadLiveStep.test.ts`, `ProviderRuntimeIngestion.test.ts`,
    `ProjectionSnapshotQuery.test.ts`, `pendingUserInput.test.ts`, `liveStep.test.ts`,
    `agentActivity.test.ts`
- **—** — Pass 16: switching Mates (T1) — the place kept by row; at once since 2026-09-30
  - _State:_ **live**. 2026-09-30, the owner on the held picture: "I'd do it immediately then
    start loading content … it feels like when there are two transparent texts transitioning over
    itself". Measured on the localhost pair: the old conversation stayed 250–600 ms after the press
    and crossfaded over the new one for 150 ms; the composer's frame faded its colour three times
    during one first open, as a drawer came and went, showing the page through it. Now the next
    Mate's pane is on screen from the press, its list out of sight until placed and in over 140 ms;
    the picture, its hold and both fades are gone
  - _Built in:_ mate 0.11.63 (PR #32); at once on `fix/pass-23`
  - _Proven by:_ `MessagesTimeline.test.tsx` (placing its rows), `timelineScrollAnchoring.test.tsx`;
    the harness `/design-switch.html`; ledger _Pass 16 as measured_
- **—** — Pass 16's feedback: the run's card — closed its line, open one scroll
  - _State:_ **live** on the localhost pair, 2026-09-29: closed, a run is its summary line (Juno's
    25-minute run 44 px); open, every event in one scroll of 440 px at most that opens at its foot
    and follows it while the Mate works (Nova, at most 9 frames off the foot); a closed run with
    nothing under its line is the line alone, and _Show work_ draws the card around it moving the
    line 0 px. Reverses D4 (no scroll inside the card) and K7
  - _Built in:_ mate 0.11.64
  - _Proven by:_ `RunChat.test.tsx`, `runCard.logic.test.ts`, `MessagesTimeline.logic.test.ts`
    "marks a card alone"
- **—** — Pass 16's feedback: the result — the run's pictures, a service by how it runs, the fix to
  its own Mate
  - _State:_ **live**, 2026-09-29: the run's pictures (each page's last check, every picture the
    Mate looked at) in one strip of 109 × 68 tiles under the rows; a service whose only failed check
    is a subdomain left off reads Healthy (Iris's dev service); "Ask X to fix it" only to the run's
    own Mate while it is the person's — a colleague's run offers none
  - _Built in:_ mate 0.11.64
  - _Proven by:_ `conversation.logic.test.ts`, `runResult.logic.test.ts`, `TurnReport.test.tsx`,
    `fixMates.test.ts`
- **—** — Pass 16's feedback: one Review in two frames
  - _State:_ **live** on Snap #2, 2026-09-29: the dialog (768 px, _Open as page_) and the change's
    page draw the same sections in the same order — the description, the changes, the checks, the
    conversation, the commits — nothing wider than its column; _Try it_ removed (nothing records
    which version a stage runs). **Open**: a description's pictures cannot be read by a browser
    (Gitea answers the attachment preflight 303) and settle on _Open on Gitea_ until the broker
    reads them (§7, 35)
  - _Built in:_ mate 0.11.64
  - _Proven by:_ `ZeropsReview.logic.test.ts`, `useZeropsChangeReadout.test.ts`,
    `useZeropsChangeComments.test.ts`, `giteaClient.test.ts`; the harness `/design-change.html`
- **—** — Pass 16's feedback: the menu's details
  - _State:_ **live**, 2026-09-29: _New project_ at the menu's foot; folded projects 40 px apart
    with a grey hover; a Mate nobody owns on an empty seat saying "Nobody has signed in yet"; the
    logo the mark alone, as wide as a face; the production menu's links led by their service; the
    model menu opening at its own height (441 → 450 px, before 644 then a snap) with a scroll the
    wheel moves; the crew one line under its Mate
  - _Built in:_ mate 0.11.64
  - _Proven by:_ `SidebarChrome.test.tsx`, `SidebarProductionChip.test.tsx`,
    `SidebarWaitingStack.test.tsx`, the kit's popover tests, `ConversationStrip.test.tsx`
- **—** — Pass 18: a project's two chips, the menu's top and its rhythm
  - _State:_ **live** on the localhost pair, 2026-09-29: the `stage` and `prod` chips, each its word
    alone, and the logo 16 px from the top as from the left, seen in the menu signed in to the test
    org. Measured in the harness at 435 and 304 px: every tone one 20 px box in one place across a
    flip (one geometry over 23 frames); amber's word at 4.9:1 in light and 6.1 in dark, red's at 4.7
    and 5.6; a long name truncating before both chips; texts 20, 30 and 50 px apart, and a fold
    landing the next heading where a fresh layout puts it. The owner kept the tones (§7, 37), and
    pass 19 puts the whole top bar on the logo row's 65 px (below)
  - _Built in:_ mate 0.11.66 (PR #36): `bf1b9b242` `a0c6b27ba` `1a7338f82` `b6e81525e` `198bf63eb`
    `2bdb5edec`
  - _Proven by:_ `SidebarProductionChip.logic.test.ts`, `SidebarProductionChip.test.tsx`,
    `SidebarZeropsTree.test.tsx`, `SidebarProjects.logic.test.ts`, `SidebarChrome.test.tsx`,
    `menuMemory.test.ts`; the harness `/design.html?set=plan`
- **—** — Pass 18: _New Mate_ — a name, a colour, a shape; the face on its project
  - _State:_ **live** on the localhost pair, 2026-09-29, a storefront project in the test org: a
    Mate added from its project's heading through the dialog, its picked colour and shape written at
    birth as `mate:face:<tint>:<shape>` beside `mate:standup:`, the project and its eleven services
    active about four minutes after _Add_. That first add recoloured four other Mates — the pick of
    a tint another Mate wore by its name pushed that Mate along — fixed in `10816483d` and checked
    live: a pick recolours nobody. In the harness the dialog stands 323 px tall (573 before), and
    the recipe arriving moves nothing. **Open**: §7, 37
  - _Built in:_ mate 0.11.66 (PR #36): `07172b671` `46fd986e0` `b73107b47` `4375984ff` `10816483d`
  - _Proven by:_ `groups.test.ts`, `createEnvironment.test.ts`, `mateTints.test.ts` "recolours
    nobody when a new Mate picks a tint another Mate wears", `MateFace.test.tsx`,
    `mateIdentities.test.ts`, `ZeropsNewMateForm.test.tsx`,
    `ZeropsEnvironmentCreationDialog.logic.test.ts`; the harness `/design-newmate.html`
- **—** — Pass 18: the stand-up — a new Mate sets its development up after its person's sign-in
  - _State:_ **live** on the localhost pair, 2026-09-29, the same Mate: its conversation said it
    would stand development up after the sign-in; the owner authorized Claude Code from their own
    window, and the browser that had added the Mate sent "Stand up development of the project."
    once, by itself; the Mate stood development up in 13 minutes, both dev services healthy — the
    authorization the one thing a person did. The screen in its final words — "… after you authorize
    your agent." over one _Authorize_ per agent, the composer held back — merged just after that
    sign-in and is not yet seen through a run. A send another surface asks for (`requestSend`) was
    cancelled by its own re-render, its words left in the composer (reproduced in a test); it now
    goes out, so the Git tab's and the jump box's asks send at once. **Open**: §7, 37
  - _Built in:_ mate 0.11.66 (PR #36): `b446994f0` `3d8264772` `331593ac7` `2cef5e40d` `f724de157`
  - _Proven by:_ `mateStandUp.test.ts`, `useMateStandUp.test.tsx`,
    `useComposerSendRequests.test.tsx`, `ZeropsMateEmptyState.test.tsx`, `tagPatch.test.ts`,
    `OrchestrationEngine.test.ts` "takes one turn start when two clients send the same command at
    the same moment"; the harness `/design-standup.html`
- **—** — Pass 18: the conversation's line — its switch in motion, a crewless Mate's subject
  - _State:_ built; measured in the harness, 2026-09-29: every frame of a switch on the curve (≤
    0.01 px off) and the band's pieces overlapping 1 px on every frame; an opening name ≥ 8 px
    inside the band and ≥ 14 px clear of the next face; nothing moving before the press or after it;
    no step at a retarget larger than the curve's peak; every animation on the compositor; at rest
    within 2/255 of 0.11.65's pixels. A crewless Mate's subject stood on its line in the live trial.
    **Open**: the switch not yet sampled live, where the conversation renders more before the commit
    than the harness does (§7, 37)
  - _Built in:_ mate 0.11.66 (PR #36): `1042ded22` `5e16859bf` `6dd4a1b93`
  - _Proven by:_ `ConversationStrip.logic.test.ts`, `ConversationStripMotion.logic.test.ts`,
    `ConversationStrip.test.tsx`; the harnesses `/design-strip.html` and
    `/design-switch.html?line=1`
- **—** — Pass 18: the run's card — folded at its end, its room, its line centred, straight sides
  - _State:_ built; measured in the harness, 2026-09-29: a watched run's work folding into its line
    over 360 ms as it settles, the line moving at most 1.2 px a frame through the fold in the real
    list and the answer under it 1.9 (before, ±45 px); a person reading the work keeps it open; 16
    px of room inside the tray and 34 px corners; the line's words 20 px from what is over and under
    them, its face 20 px in the column; at 1.58× a joint between slices within three grey levels,
    where a device column of border showed before. **Open**: the fold not yet seen on a real Mate's
    run (§7, 37)
  - _Built in:_ mate 0.11.66 (PR #36): `75583d8dc` `01dc5acd0` `5c97b09ac` `6ddab9df6` `59caffa97`
  - _Proven by:_ `RunChat.test.tsx`; the harnesses `/design-working.html` and
    `/design-switch.html?end=<ms>`
- **—** — Pass 18: deleting a Mate — its name typed, Deleting… until the platform lets it go
  - _State:_ **live** on the localhost pair, 2026-09-29, about 22:34Z, on a throwaway Mate in the
    test org: the dialog closed about 2 s after _Delete_, the view moved to the next Mate of the
    project, and the row read "Deleting…" until it left the menu about 30 s later, the API then
    answering 400 for the project. Measured in the harness: the dialog 448 × 319 px in every state,
    nothing in it moving from idle to typed, deleting and refused; a row turning to Deleting… with
    no row moving over 62 frames. Offered where the viewer's role on the Mate's project is OWNER or
    ADMIN, on a Mate only. **Open**: §7, 37
  - _Built in:_ mate 0.11.66 (PR #36): `01a797146` `cade147e4` `3ae17c0c5` `2c0b331d1` `95e0d0b53`
  - _Proven by:_ `mateAccess.test.ts`, `ZeropsDeleteMateDialog.logic.test.ts`,
    `ZeropsDeleteMateDialog.test.tsx`, `deletingMates.test.ts`, `SidebarMateMenu.test.tsx`,
    `SidebarZeropsTree.test.tsx`, `useOpenMate.test.ts`; the harness `/design-delete.html`
- **—** — Pass 19: the top bar stands 65 px beside the menu, one line with its logo row
  - _State:_ built; measured in the harness at 1786 and 1280 px, light and dark, 2026-09-29: the
    logo row, the header and the closed menu's corner mark all 0–65 px, every centre on 32.5 (the
    header's was 26); what stands under the header 13 px lower, a conversation held at its end still
    there; 52 px on a phone and in a desktop window; each top row painted at its final box from the
    first frame. **Open**: §7, 38
  - _Built in:_ mate 0.11.67 (PR #37): `5e3e5f7b2` `c4362ca0f` `cee34dd02`
  - _Proven by:_ `-chatIndexTitlebar.test.ts` (the token, shell by shell), `SidebarChrome.test.tsx`;
    the harnesses `/design.html` (`?menu=closed`, `?crew=1`) and `/design-switch.html`
- **—** — Pass 19: a Mate's ended session is never presented again
  - _State:_ built, 2026-09-29: the client answers a bearer within 30 s of its deadline, or one its
    Mate refused, itself; a link blocked on it waits for the door's new bearer through wakes and
    network changes; a session that reached its end reads "Reconnecting to …", never a refusal; the
    server's 401 says `expired: true` and its log line names the session; the logout sweep skips an
    ended session. Cause, read from the ten test-org Mates' logs: a long-lived client re-presenting
    sessions past their 24 h life on every wake, to all its Mates in one second. **Open**: not
    verified live (§7, 38)
  - _Built in:_ mate 0.11.67 (PR #37): `5980ed13c` `bac5764c8` `24421cdda` `dbc8ecb36` `34797def3`
    `be37a0978`
  - _Proven by:_ `resolver.test.ts`, `supervisor.test.ts`, `presentation.test.ts`,
    `runtime.test.ts`, `EnvironmentAuth.test.ts`, `environmentHttp.test.ts`, `storage.test.ts`;
    `account-lifecycle.md`
- **—** — Pass 19: a new Mate's first minutes — New Mate in place, its own view, the stand-up in
  place
  - _State:_ **live** on the localhost pair, 2026-09-29, 22:26–22:34Z, with a throwaway Mate, Probe,
    on the test org's Snap project: New Mate opened over the view on screen; _Add_ landed on the
    Mate's view in about 8 s, which read "Creating the project", "Building the container" and
    "Closing the project off" and turned into the stand-up screen 2 min 34 s after _Add_. The run
    found the _Authorize_ buttons on a white card and the new row selected under the menu's fold,
    both fixed (`862a19026`, `4dd94eaf1`). Measured in the harness: through the hand-over the face
    and the headline in one place over 37 frames; the coming row's top and face in one place over
    115 frames, from its birth to its first job. **Open**: §7, 38
  - _Built in:_ mate 0.11.67 (PR #37): `1b3720046` `a1109181b` `1faefc6d6` `95904e2cb` `862a19026`
    `4dd94eaf1`
  - _Proven by:_ `mateComing.test.ts`, `SidebarMateRow.logic.test.ts` (`mateRowReading`),
    `SidebarZeropsTree.test.tsx`, `ZeropsMateEmptyState.test.tsx`, `newMate.test.ts`,
    `ZeropsNewMateForm.test.tsx`, `useOpenMate.test.ts`, `birthStore.test.ts`; the harnesses
    `/design.html?set=coming` and `/design-standup.html?state=coming`
- **—** — Pass 19: _Change face…_, and _New project_'s first Mate with its face and the stand-up
  - _State:_ **live** for _Change face…_ on the same throwaway Mate, 2026-09-29: saved in about 1.5
    s, every other tag kept (read back from the API), the face held over a reload. Measured in the
    harness: the dialog 512 × 291 px in every state; over a save, one row geometry and one face
    geometry across 94 frames, the face swapped under the backdrop's veil; the wizard's card 576 ×
    306 px throughout. A face changed on a Mate that wore its name's tint writes `:named`, so nobody
    recolours — in tests, every Mate of a six-Mate account changed in turn. The wizard's first Mate
    not yet made live. **Open**: §7, 38
  - _Built in:_ mate 0.11.67 (PR #37): `49c105cfd` `3e0976bc0` `f2f1882f5` `d6bd47788` `132306274`
    `26be501e6`
  - _Proven by:_ `groups.test.ts`, `mateTints.test.ts`, `tagPatch.test.ts`, `tagWriter.test.ts`,
    `newProject.test.ts`, `ZeropsChangeFaceDialog.logic.test.ts`, `ZeropsChangeFaceDialog.test.tsx`,
    `useMateActions.test.tsx`, `ZeropsNewProjectWizard.test.tsx`; the harnesses `/design-face.html`
    and `/design-newproject.html`
- **—** — Pass 20: the Crew tab as the approved board draws it, and a time limit that counts working
  time
  - _State:_ built; seen live on the localhost pair, 2026-09-30, on Fen's crew on Letopis: the tab's
    column — its goal's title, "Give the crew something to do…" to the lead, a row per crewmate
    under its job — and the mode line "Stopped working on its own: its 8 hours are up. It spent
    $0.00." with nothing to resume: the idle-time case, from a Mate server that still counts wall
    time, which the new clock ends once the Mate updates. Measured in the harness against the board
    at 540 px (390 on a phone), light and dark, in every state: the goal's fields and the job's
    choices where the board draws them, the menus 316 and 364 px wide; _Answer_'s box unclipping
    over 220 ms while the rows below slide from their places, a view sliding 24 px in 220 ms, a fade
    alone under reduced motion. **Open**: §7, 39
  - _Built in:_ mate 0.11.68 (PR #38): `0a50374c4` `b0c04c015` `515767d99` `d09af66b9` `ade2140f6`
  - _Proven by:_ `CrewHead.logic.test.ts`, `CrewRows.logic.test.ts`, `CrewLeadPlan.logic.test.ts`,
    `CrewRunDialog.logic.test.ts`, `CrewGoal.logic.test.ts`, `phrases.test.ts`, `crewRuns.test.ts`,
    `crewMachines.test.ts`, `crewCards.test.ts`, `crewSnapshot.test.ts`,
    `ProjectionSnapshotQuery.test.ts`; the harness `/design-crew.html?state=…`
- **—** — Pass 21: the crew closed to a viewer who may not run its logins
  - _State:_ **live** on the localhost pair, 2026-09-30, on Fen's crew on Letopis, viewed by a
    member who did not sign its agent in: the Crew tab's composer slot reads "Signed in by another
    project member — only they can run this crew." with _Sign in with your own account_, 48 px like
    the composer it replaces; the crew's ··· and every press that runs or changes the crew gone;
    rows, conversations and _In Fen's code_ still open. The server refuses those commands at the
    crew's door for anyone admission would refuse on the logins they reach, in admission's words;
    any member may stop or pause a running crew (D6). **Open**: §7, 40
  - _Built in:_ mate 0.11.69 (PR #39): `afc985197` `fb037dfbf` `14f927c35` `2897faa9f` `e8bf91f67`
    `8eda33226` `d7f68bad8` `15d042d5c`
  - _Proven by:_ `CrewDoor` tests in the server crew suite, `crewAccess.test.ts`,
    `CrewPanel.test.tsx`, `CrewRows.logic.test.ts`; the harness
    `/design-crew.html?state=…&viewer=other`
- **—** — Pass 21: a crewmate's empty conversation — whose it is, its job, its work
  - _State:_ **live** on the localhost pair, 2026-09-30, Lead's empty conversation in Fen's crew:
    its face at the place of Fen's own (72 px, top 410 at 1786), "Fen's lead · plans and reviews the
    crew's work" after Fen's small face, the _Its job_ card with its job's first line in the
    person's words and never the words it says to the crewmate, its finished work, "previous
    conversation ↗" to the stint before; _Change its job_ only where the crew's door would take it;
    the name and face held empty until the crew is read. The fake "Message Lead…" gone. **Open**:
    §7, 40
  - _Built in:_ mate 0.11.69 (PR #39): `a182bbcdc` `772238fb2` `4ba2cd12e` `3d5ba49a4` `514dc7c16`
    `43b8a9598` `b4356072d` `d621dd0f4`
  - _Proven by:_ `CrewmateEmptyState.test.tsx`, `CrewmateEmptyState.logic.test.ts`,
    `phrases.test.ts`; the harness `/design-crewmate.html`
- **—** — Pass 21: a run is opened by the message that started it; Stop settles a start that never
  ran
  - _State:_ built, 2026-09-30, from Juno's "Thinking · 17:42:08": a message whose run never came
    took the next day's run as its opener, and Stop left a session reading running with no turn. A
    run now opens at the first of the person's last messages within 60 s; Stop settles such a
    session as interrupted. Reproduced as the switch harness's Iris state, before and after.
    **Open**: §7, 40
  - _Built in:_ mate 0.11.69 (PR #39): `e75b3831a` `026ecb572` `d2ad2c4e7`
  - _Proven by:_ `conversation.logic.test.ts`, `ProviderCommandReactor.test.ts`; the harness
    `/design-switch.html`
- **—** — Pass 21: every door opens a Mate's own view while its conversation cannot open
  - _State:_ **live** on the localhost pair, 2026-09-30: Quinn pressed a second after a load opened
    its own view, "Reconnecting…", and handed over to its conversation about 6 s later — before, the
    row's press sent the person to the projects screen, silently (the owner: "it just throws me at
    /zerops page"). Causes proved in tests: the row stood for its project until the project's
    services were read, and a registration its machine held could be released for a record it
    lacked. **Open**: §7, 40
  - _Built in:_ mate 0.11.69 (PR #39): `fdb071abc` `cced7161c` `18caf093a` `b2c6bea6c` `25ab4ee17`
  - _Proven by:_ `mateLink.test.ts`, `accountRuntime.test.ts`, `-environmentTargets.test.tsx`,
    `useOpenMate.test.ts`, `useAskMate.test.ts`, `ZeropsMateComingPage.test.tsx`; the harness
    `/design-standup.html`
- **—** — Pass 21: a colleague's Mate wears its owner's picture on its face's corner
  - _State:_ **live** on the localhost pair, 2026-09-30, option A of the board the owner chose from:
    the picture a 12 px badge cut out of the face's bottom-right corner, 3 px in, on colleagues'
    Mates; nobody's Mate the empty seat there; the viewer's own Mates nothing; nothing before the
    name any more ("(face) Cleo" read as a person called Cleo). Measured in the real menu: every
    badge at (19, 19), 12 px
  - _Built in:_ mate 0.11.69 (PR #39): `721c1bc12`
  - _Proven by:_ `SidebarMateRow.logic.test.ts` (`ownerBadge`), `SidebarZeropsTree.test.tsx`
- **—** — Pass 21: the run's card holding only its line
  - _State:_ built, 2026-09-30: a closed card whose line stands alone keeps its box again (0.11.64
    had dropped it); a card holding nothing but its line — live at its first thought, or closed — is
    the composer's rounded rectangle, never a full-width pill, its corners easing to the full card's
    as rows arrive; what ran alongside the live line gives its room back when it ends (the owner's
    "big space … at the bottom"). **Open**: §7, 40
  - _Built in:_ mate 0.11.69 (PR #39): `240c770ef` `8385fc6bf` `40a435519`
  - _Proven by:_ `MessagesTimeline.test.tsx`, `RunChat.test.tsx`; the harnesses
    `/design-working.html` and `/design-switch.html`
- **—** — Pass 25: the add-Mate run's findings, the one voice, the switch, the stand-up's pace
  - _State:_ released 2026-09-30 (mate 0.11.73, zcp v9.186.0, the broker's version names): every
    item of the run's findings board,
    and the stage and production heading (D′: the release under the project's name); a Mate's link speaks with one voice and a
    reload never shows an empty pane; a return to a conversation shows it as it stood; the composer
    never leaves the screen; the stand-up's card shows its builds; zcp stands development up as a
    graph and answers once it is up (`p25/standup`); versions are named for people (with the
    broker's `p25/version-names`); the Mate being opened connects first and paints before its
    socket, once Mates run a server that names the snapshot's parameters
  - _Built in:_ `pass-25` (mate), zcp `p25/standup`, gitea-mate `p25/version-names`
  - _Proven by:_ ledger 2026-09-30 _Pass 25 as measured_; `mateVoice.test.ts`,
    `keptTimelines.logic.test.ts`, `standupBar.logic.test.ts`, `versionName.test.ts`, zcp
    `TestStandupAfter_EveryDevHalfStartsAtOnce`, `TestStandup_ReturnsOnceDevelopmentIsUp`
- **—** — Pass 26: the owner's and a colleague's evening on mate.zerops.io
  - _State:_ built 2026-09-30 on `pass-26`, released as mate 0.11.74: the Mate being opened is
    never kept waiting by another; a project someone else makes is read at once (no endless name
    check, no stray "Still reading…"); a stalled read never covers the product; the arrival names
    the subscription; the first ask waits for its signer record; a colleague's Mate waits on its
    owner; rows keep their height and show drafts, their run clock looks live, and a stop takes a
    second press; the account speaks from one line at the menu's foot; the run card keeps one radius, a calm live line,
    the whole environment in its stand-up bar, a dock that says one true thing and a result with
    every picture; the release line and its folded tag; a release's changes open in its dialog.
    **Open**: a Mate's hand-run git has no token (zcp `p26/git-helper`: the Gitea host's saved
    helper answers `${GIT_TOKEN:-$GITEA_TOKEN}`); zcp to fold a process's `error` into its
    import result and to relay a dev server's state live; dev artefacts' 2–4 min uploads
  - _Built in:_ `pass-26` (mate)
  - _Proven by:_ ledger 2026-09-30 _Pass 26 as measured_; `admission.test.ts`,
    `nowLineCalm.logic.test.ts`, `standupReading.test.ts`, `operationBar.logic.test.ts`,
    `inventoryTrouble.logic.test.ts`, `ZeropsReleaseSteps.logic.test.ts`,
    `SidebarMateRow.logic.test.ts`
- **—** — Pass 34: a stage coming up, a deploy, a release and a new Mate say what is true while
  they happen
  - _State:_ **live** in mate 0.11.87 (2026-10-02), re-checked live in run 5 on mate.zerops.io:
    every step of a stage coming up was true, including the wait for a group's first runner; a
    deploy's "Deployed" held through a stale pending status; a release kept "replaces v0.1.0 · 1
    change" and its roll back to v0.1.0 through Released; a new Mate read "Coming up", then
    "Waiting for your sign-in", in the window that had not made it, and both flows' Mates read the
    same words; a merge reached the other window in 10 s (run 4: 48 s), idle cost unchanged (16 and
    18 requests a minute). A deploy job that fails before the broker stays invisible (§7, 23)
  - _Built in:_ mate 0.11.87 (PR #87 `e46b4a07f`); gitea-mate #7 `76f259c`
  - _Proven by:_ `stopComing.test.ts`, `stageComingUp.replay.test.ts`, `deployment.test.ts`,
    `deploymentStore.test.ts`, `pullWatch.test.ts`, `releaseFacts.test.ts`, `reviewVerdict.test.ts`,
    `candidates.test.ts`, `mateComing.test.ts`, `mateLink.test.ts`, `SidebarMateRow.logic.test.ts`;
    ledger _Run 4 as measured_, _Run 5 as measured_
- **6** — Adopting an existing app
  - _State:_ **open** — nothing built; _New project_ has no _I have code_
- **7** — The raw-token door and the client's re-mint
  - _State:_ done — the server offers `zerops-throwaway` only
  - _Built in:_ mate 0.11.0
  - _Proven by:_ `EnvironmentAuthPolicy.ts`
- **7** — The mock recipe store (H-27) and the lossy clone
  - _State:_ done
  - _Built in:_ mate 0.11.0 `b296a0139`
  - _Proven by:_ `hacks.md` H-26, H-27
- **7** — _Set up Mate_ and _Add Gitea_
  - _State:_ partial — _Add Gitea_ gone (Gitea comes with a project); _Set up Mate_ still offered
    for a project with no container
  - _Built in:_ mate 0.11.1
  - _Proven by:_ `ZeropsProjectRow.logic.ts`
- **7** — zcp's delegated launch and the GitHub `prodCd` track for group Mates
  - _State:_ **open** — `launch_delegation.go` and the build-integration track remain
- **7** — The spec's backbone section
  - _State:_ done
  - _Built in:_ spec §10, 2026-09-17
- **—** — Migrating the live demo account (`mate-gitea`, the `gitea-deploy-*` secrets)
  - _State:_ **open** — the demo projects are untouched

## 6. Decisions that moved since the plan

- **D4 — the broker's home.** Planned as `zcp gitea broker`, a binary from zcp. Built as its own
  repository and Go module, `zeropsio/gitea-mate`, with its own Zerops client; zcp is not a
  dependency. The recipe code it was to reuse lives in zcp and is called from a Mate (2.2), not
  from the broker.
- **D17 — the brief.** The form asks nothing but the name; the owner removed the question and the
  agent-selection step on 2026-09-16. Nothing is written into a new Mate's composer: the generated
  hand-off and the generic onboarding line went on 2026-09-24 (the owner: an empty conversation
  carries no prefilled text). Since pass 18 a Mate added to a project gets one ask on its person's
  behalf: once the person who added it has signed an agent in, their client sends "Stand up
  development of the project." as them — sent, never left in the composer, which is held back until
  it has gone (§5; the owner's call in §7, 33); since pass 19 a _New project_ Mate gets it too.
- **D18 — Gitea at sign-up.** Gitea is made with the org's first _New project_, in the same run as
  the first Mate, and by the same verb on an org that has projects and no Gitea. Nothing happens at
  sign-up; no pool exists.
- **D21 — how a person is signed in to Gitea** (2026-09-17, the owner: "it should use the same
  login I have"). The app proves the person to the broker with a throwaway, the way the door does,
  and the broker, as site admin, makes their account exist bound to the OIDC source and mints a token
  that acts as them. No Gitea screen, no button; the OAuth2 client, the PKCE flow and the callback
  route are gone. Gitea's own pages keep the OIDC sign-in, whose consent completes on its own.
- **D22 — a Gitea serves every app origin** (2026-09-17, the owner, on being told a Gitea made
  from mate.zerops.io could not be driven from localhost: "didn't you just make it use Mate's
  logged-in user's token?"). Under D21 every browser call carries a bearer in a header and no
  cookie, so an origin allowlist proves nothing and only pinned the Gitea to the origin that made
  it. Gitea's `[cors]` and the broker's `POST /person/token` answer `*`; the import sends no origin
  list. Gitea's own-page sign-in is untouched; its consent page stays on the origin that made the
  Gitea (`MATE_APP_URL`, a redirect target).
- **D23 — who merges on the group repo** (2026-09-17, the owner, on a first recipe that sat as a
  pull request waiting for a releaser: "they all should be able to merge on the import yaml repo").
  `main` on the group repo keeps no merge whitelist — the write and release teams merge — and the
  broker merges a pull request a registered Mate's bot opened against it on the next pass, nudged
  by the hook. The `v*` tag protection is what sets the releasers apart. gitea-mate v3.3.
- **D20 — who delivers a Mate's Gitea access** (2026-09-17). The broker's rights loop, for every
  registered Mate, into its `zcp` service's variables; the app grants the broker the Mate project at
  registration and asks it for nothing. `POST /mate/credential` is gone.
- **D25 — delivery is the stage deploy** (2026-09-17, the owner, of a prompt that had to say
  "deliver it with a git-push deploy": "this is fucking unnatural btw, no person is ever going to
  say this"). A deploy onto a wired pair's stage half is the moment the work is shippable, so zcp
  commits the dev half's tree as deployed, in the work session's words, pushes the Mate's branch,
  opens or finds the pull request and proposes the recipe again; a push to the group's Gitea is
  watched for no build and offers no integration; a wired pair's direct deploys are never
  redirected. The group's stage and production tiers build the stage half's setup, and the
  workflow names the promoted runtime — both measured wrong on the same run. zcp v9.179.1, MB-26.
  Measured live on the from-scratch run the same evening: "build a todo app" alone ended with the
  pull request, the recipe re-proposed with `prod`, the second Mate's feature delivered the same way.
- **D26 — the Git tab is the Mate's; the project's flow is the left menu's and the projects
  screen's; Gitea's overview is the footer's** (2026-09-17, the owner: "this seems like git for the
  whole project, shouldn't it be git for this Mate and have project git somewhere else … a list of
  open PRs of each Mate between mates and the stage/prod"). One provider reads every project's
  flow for the account — the declarations and what each environment runs from Zerops, the open
  pull requests with their checks and the releases from Gitea — once a minute and at once after a
  verb. A Mate's tab keeps its own branch and pull request; the left menu draws each project as a
  timeline with _Merge_ and _Release_ inline; the projects screen carries the same rows with the
  release gate's reason and _Roll back to this_; `/gitea` lists every repository the person can
  reach and what is open on it. mate 0.11.16, MB-28.
- **D27 — a job deploys with `zcli push`; the broker decides and hands over the key** (2026-09-18,
  the owner reading a tier's `buildFromGit`, then the broker's own upload: "the gitea runner should
  literally just do zcli push, the whole process must be as standard as possible"). The broker stops
  deploying: a push to `main` starts the repository's workflow by itself, and the broker dispatches
  the same workflow for a release, for a new environment and for whatever a pass finds behind. The
  job asks `POST /deploy/grant` with the commit it checked out and is handed the environment's
  deploy token only when it runs the default branch's own workflow, holds exactly the commit
  protected state wants, and sits on a runner that has run nothing else since it was made — jobs
  share one container and are root in it, so a runner that ran a branch's workflow is deleted and
  imported afresh before a key goes near it. The token is one per environment (`BASIC_USER` on that
  project), minted by the app as the person who adds the environment and kept as a secret variable
  on the broker's service, because a token cannot mint a token. Production is built from the
  release's commits; promotion is gone. Released 2026-09-18 — mate 0.11.17, zcp v9.180.0, gitea-mate v4.0 — and
  not proven live yet. An account made before it needs its broker redeployed from gitea-mate's
  `main`, its runner deleted so a fresh one (with zcli) is imported, its Mates restarted to take the
  zcp release, and each repository's workflow through its Mate's next pull request. MB-29.
- **D28 — a release lists what is merged, and a stage is never what it waits on** (2026-09-18, the
  owner asking for a second project — "this time we can have just one mate and one prod" — and then,
  watching _Release_ do nothing while a stage deployed: "I hope that even with stage prod release is
  not tied to stage in any way"). The candidate is each production service's repository at its
  default branch, stage or no stage: a group may be Mates and a production with nothing between, and
  one that has a stage has it as a place that runs `main` too, not a gate the tag waits behind. The
  person's merge is the review, the tag is still the approval, and the broker still deploys only what
  the tag lists — holding production until a stage has the commit is said once and explicitly, as
  `requireOnStage`. The offer carries the entries the tag will list and the commits it would move,
  so the verb tags what the person saw. MB-30.
- **A pull request is one task, and the person meets it where they are** (2026-09-18, the owner:
  "why don't we have squash and rebase as default?", "can the merge request have a mergable button
  directly in the chat?"). A request is merged by **squash** — its title is the task, its commits are
  the agent's working steps, so `main` reads as the list of tasks delivered. A Mate's open request is
  offered **in its own conversation** with the verb, and merging there also brings the Mate's checkout
  onto the merged `main`. A delivery takes the repository's base in before it pushes, by merge and
  never by rebase, so a group's second Mate stays mergeable after the first lands and its own tree
  carries everybody's work; a collision only a person can settle leaves the checkout whole and is
  named. A refusal keeps Gitea's own sentence instead of a generic one.
- **The account's own project is made as "Headquarters"** (2026-09-18, the owner: "shouldn't be
  called just gitea given it has broker and maybe some master zcp later"). One function names it
  (`toolProjectName`); it is found by its tag, so an account made before keeps the name it has.
- **D24 — a group's Mates share its service repositories** (2026-09-17, the owner asking for a
  run that ends with two Mates, a stage and a production, all wired). The AI Agent tier's
  `buildFromGit` names the same repository for every Mate the recipe creates, and the broker
  answered `409 taken` to every bot but the one that made it, so no second Mate could push. The
  broker now makes a registered Mate of the group a collaborator with write on a service
  repository that exists — its own branch, its own pull requests, `main` behind them; the group
  repository stays refused by name. An owner's _Add Mate_ registers the Mate at birth, as _New
  project_ does. gitea-mate v3.5.
- **0.5** folded into 3.2: the door never had an integration-token check; it takes a throwaway and
  refuses everything else.

## 7. Open

In the order the owner ranked them, then the rest:

1. **A Mate made by _New project_ keeps its delegation and runs un-isolated** (0.4, 0.10). Closed
   in steps: the delegation drop at creation and in the reach reconcile (0.11.28–0.11.29); the
   isolation moved to the connect (0.11.29–0.11.30), where it restarted the Mate seconds after the
   door admitted the person and threw them out (the owner's run, 2026-09-22); since 0.11.39 it is
   the birth wait's `hardening` level, gated on the platform's processes observed finished, run
   before admission, and it never restarts the `zcp` container because the server reads its key
   live (`ZeropsMateKey`). The reading behind it: `../zcp/plans/mate-birth-2026-09-22/`. Unmeasured
   live until the next creation on 0.11.39.
2. **The projects page card stays at "Almost there." after the Mate is up** (owner's run
   2026-09-17). The row gets its origin, its probe and its wait from the pushed inventory, so a
   missed push leaves the card waiting while the Mate answers; a reload redirects to the
   conversation at once. 0.11.9 re-reads the inventory every twenty seconds while a creation is on
   its way (`creationRefresh.ts`) — and re-took the leases for it, which drop what they read: the
   page painted "Reading your projects…" and an empty menu at every tick (the owner, ~14:50Z: "every
   now and then when waiting for the mate to come up it does this full refresh, that's crazy bad").
   Fixed in 0.11.11: a refresh re-reads an organization on a fresh receiver while the reads keep
   what they hold (`runtime.refresh`), and the page and the menu paint from the list already read
   (`readOnce`); a re-read spins the header's glyph and nothing else. The stale card itself is
   unmeasured until the next creation lands without a reload.
3. **The Mate server titles threads with Codex whatever agent is signed in** — Juno's log,
   2026-09-17: `generateThreadTitle: Codex CLI command failed … 401 Unauthorized` on a Mate where only
   Claude Code is authorized; harmless, the title falls back. Fix: the title generator follows the
   signed-in agent, or is skipped. Fixed on `main`
   (`19cc24539`, 2026-09-18): a thread is titled by its own provider when that one is enabled, on the
   provider's title model (`textGenerationSelectionForThread`); it reaches a Mate through the next
   release. Unmeasured live.
4. **A broker-made person on Gitea's own pages** (Q-17): measured 2026-09-17 — Gitea answered 500
   ("user already exists": its callback looks for an external-login row, not a `login_name`, and
   `ACCOUNT_LINKING = disabled` refused to link). Fixed in gitea-mate v3.7 (`auto`) and measured
   working on the test org after a redeploy of `web` (`--setup gitea`): the dashboard as the
   broker-made account. Closed. The app's own links do send people there (a pull request's page,
   _Review_), which is a design question of its own (§7, 27).
5. **The onboarding design pass** — the empty state, the _New project_ form and the first-minutes
   page as one composed flow: the real Mate mark, the sidebar hidden on an empty account, editorial
   type and spacing, one motion moment, verified at 1786 and 1280 in both themes. The 2026-09-16
   rebuild removed the noise and added no design (journal 1b, 2b, 5b).
6. **Typing while the Mate boots** — the conversation route cannot open without a server connection.
7. **A placeholder card from the creation hand-off**, so the page never paints the empty state
   between _Create_ and the inventory's answer; done in part (no first-run screen while a creation
   is pending).
8. **A restart the app did not start reads as "not connected"** — a release rollout looks like an
   outage; the platform's service status could name it (journal 10).
9. **A reconcile that re-grants a registered Mate the broker cannot reach** — a grant that failed
   after the registry write has no retry in the app; the loop reports it every pass.
10. **The bot's full name** is the project's — `Todo - Fen` since a Mate is named after its bot
    (2026-09-17), which reads right by accident of the naming rather than by design.
11. **zcp refreshes its release manifest on boot** when the cache predates the process; today a
    restart within the hour keeps the old Mate build. Fixed in zcp `5ba68b30` (v9.179.3, 2026-09-18): the boot's install
    step asks for a refresh, and keeps the cached manifest when the fetch fails.
12. **Joining from the recipe** (2.4) and a second Mate proven live (4.3) — done 2026-09-17 evening
    (ledger, _The whole chain through the UI_).
13. **A rollback run live** (5.6); the release ran twice (5.5). Done 2026-09-18: `v0.1.4` rolled Todo
    back in 71 s and `v0.1.5` released after it in 64 s (ledger, _The last tests_).
14. **The app's leaver flow** (1.4): Mate keys the leaver minted replaced in order, the leaver's
    tokens deleted, `mate:leaving` cleared; Q-16 open.
15. **The runner's cross-org proof** (1.6) and whether a stopped service is charged (a platform
    question).
16. **The Gitea restore** (1.1), written and run once on a probe.
17. **Adoption** (Phase 6); **_Set up Mate_**, delegated launch and the `prodCd` track removed
    (Phase 7); the demo account migrated.
18. **Platform:** `project.create` fails with `internalServerError` after answering `200`, two of
    five creations on 2026-09-16/17 (process ids in the ledger); the client and the drivers read the
    verdict and retry or show it.
19. **The Git tab's row says "no repository yet" until a reload after the agent makes a checkout**
    (Dara's run, 2026-09-17: "its not updated live?"). A row subscribes to the server's VCS status for
    `/var/www/{host}`, loaded once; the turn-end refresh reached the thread's cwd — the workspace
    root, never a repository. Fixed in 0.11.12: a turn's end refreshes every mounted checkout
    (`CheckpointReactor`, `resolveCheckpointTargets`); it reaches a Mate through the release and the
    Mate's next update, not the running Dara. A change made outside a turn still needs the reload.
20. **A refused import says "Zerops request result is uncertain"** — every failure of `import-project`
    is mapped to that sentence (`uncertainCommandError`), so a plain `400` on a bad document (the
    two-name project block of 2026-09-17) reads as a maybe. Fix: keep the platform's words for a
    refusal the platform clearly gave, and "uncertain" for a request whose outcome is unknown. Fixed on `main` (`71fd3a22c`, 2026-09-18): a `400` is the adapter's `rejected`
    kind, not retryable, and reads "Zerops refused the request: …" with the platform's validation
    words — the one kind whose message is forwarded; every other kind keeps its fixed sentence.
21. **A push to `main` with no environment following it fails the service repo's workflow** — zcp's
    `.gitea/workflows/zerops.yml` runs the deploy action on every push to `main`; with no stage
    declared yet the job fails after 4 s and the Git tab counts a red check on `main` (journal 22, for
    the hardening person: the action could end cleanly on "no environment"). A second cause, the
    workflow naming the dev half (`service: appdev`) where the stage runs `app`, is fixed in zcp
    v9.179.1; a repository whose workflow a v9.178.0 Mate wrote keeps the old name until a Mate on the
    fix rewrites it (Kai's `todo/appdev`). Sized 2026-09-18 and left: every workflow zcp writes pins
    `zeropsio/gitea-mate/actions/deploy@v1`, a tag fixed at `f248c79`, so an action that ends cleanly on
    the broker's "no environment of that tier yet" reaches a repository only by moving that tag or by
    zcp writing a newer pin — a contract change across gitea-mate, zcp and every existing repository,
    not a one-commit fix.
22. **zcp after an expansion** — the recipe was not re-proposed when `zerops.yaml`'s setups changed
    (spec 2.2 "kept current"), and the expansion dropped the pair's Gitea record so `group-recipe`
    refused with "no pair has its Gitea repository yet". The record is kept since zcp `f04dcc77`
    (v9.178.0); re-proposing on a setup change is the hardening person's — and a recipe composed
    before v9.179.1 names the dev half's setup for the group's stage and production (Kai's
    `todo/group` `main`: `zeropsSetup: appdev`, start `zsc noop`); the correction as the bot was
    refused by the session's classifier and waits on the owner (ledger, _The owner's Todo run_).

23. **A signer recorded in another browser is not seen by an open session** — the owner signed
    Claude in from their browser; the audit browser, open on the same Mate, refused the first message
    ("This agent's sign-in was not recorded by Zerops Mate…") until a reload. The client reads the
    signer record from the project's tags it holds, and a tag change does not reach an open session.
24. **The _Add Mate_ creation failed a step after the project on Fen** (2026-09-17) and the panel's
    error text was not read; the token was lowered, so the failure sits in the delegation or the
    isolation step. The consequences (no registration, no hand-off) are fixed; the cause is open.
25. **In a wired Mate zcp still asks the service mode** (dev/stage pair, dev only, simple) although
    the pair is the only answer it takes, and a Mate that adopted the recipe's services suggests
    `launch-production` — zcp's non-Gitea path (Fen, 2026-09-17). Both the hardening person's.
26. **A row-menu verb can miss its first click** — _Publish app_ on the stage row did nothing at
    17:57:33Z and published at 17:59:47Z (the audit browser; unmeasured whether a person's click can).
27. **The Git tab is the project's, not the Mate's** (the owner, 2026-09-17: "shouldn't it be git
    for this Mate and have project git somewhere else … a list of open PRs of each Mate between
    mates and the stage/prod"). Closed in 0.11.16 (D26): the Mate's tab keeps its own branch and
    pull request; the project's flow is the left menu's timeline and the projects screen's rows;
    the Gitea overview is the footer's (ledger, _The Git tab split_; the rows under each Mate
    with _Merge_ measured live at 22:21Z on two pull requests the Mates opened on request). Open on
    it: the pull requests under a Mate fold behind a count past three — the owner asked for
    "smartly expandable", and whether a row itself should expand to its details is unmeasured; the
    sidebar's dots carry the word in a tooltip.
28. **Three faults found by the owner on the Git tab after the run** — the release word "Checking"
    (the status field), the environment rows' statuses read from the runtime's name, the tab
    re-reading the group repo 700 times a minute — fixed in `6790efee0` and `2c9f0bc79` (ledger,
    _The owner's own poking after the run_).
29. **What the audit run through the UI showed about the design** (2026-09-17, driving the whole
    chain in agent-browser; the owner asked for these to be written down): _Release_ is one click
    with no confirmation and no dialog naming what moves; _Merge_ and _Release_ give no feedback
    where they were pressed — the row simply changes on the next read; a stage has no URL until
    _Publish app_ is found in its row's menu; the creation dialogs say "dev" where the product says
    Mate (_Add dev to Todo_); a new Mate's composer arrives prefilled with the hand-off text in
    front of what the person types; the app's links lead out to Gitea's pages for a pull request
    and a run; bot logins (`mate-{id}`) show in the UI where a Mate's name belongs; the Codex
    _ACTION REQUIRED_ card stays after Claude Code is signed in; a failed creation says a generic
    sentence; the stage's row menu offers Mate verbs; and copy leaks the platform's words
    ("startWithoutCode") into rows. Fixed on `main`, 2026-09-18, each unmeasured live (the audit browser's session had ended): _Merge_,
    _Release_, _Roll back_ and the Git tab's verbs say they are running where they were pressed and
    take no second click (`62cf00fe9`); the creation dialog says Mate (_Add Mate to Todo_, _New Mate_,
    `fafe8a27d`); the Gitea overview names a Mate's pull request after the Mate (`44077f9a2`); once
    one agent is signed in the other's row is an offer, not _Action required_ (`7e0708edd`); a stage's
    and a production's menu carries no Mate verb (`2769e98a7`); a request the platform refused says
    so in its words (`71fd3a22c`). Still open, each a slice of its own: _Release_ with no dialog
    naming what moves, a stage with no URL until _Publish app_, the prefilled composer, the links out
    to Gitea's pages, the platform's words in rows.
30. **zcp titles a Mate's pull request "Mate: appdev"** (2026-09-17 22:21Z, both rows of the
    timeline read the same words). The commit is in the work session's words (D25) and the pull
    request's title should be too — the task is what a person scans the list for. zcp
    `openGiteaPairPullRequest`; a zcp release. Fixed in zcp `8e0c665c`
    (v9.179.3, 2026-09-18): the title is the work session's first line, the one the
    delivery commits under, cut at 120 characters; "Mate: appdev" only when no session is open. A
    request already open keeps its title. **Amended 2026-09-18**: a request still under zcp's own
    words takes the task's when the next delivery has them, and only that title is replaced.

    **2026-09-18, measured in the browser**: the running labels, the Mate word in the dialogs, the Gitea page's Mate names, the other agent's row and the stage menu are all live and correct. Two more of the list are closed by the same day's work: _Release_ now names what it would move, under the row that offers it, and _Merge_ is offered where the person is reading — in the Mate's own conversation — and says there what Gitea refused. Still open from this item: a stage has no URL until _Publish app_ is found in its menu; the app's links lead out to Gitea; the Codex card after Claude is signed in; the platform's words in rows. The prefilled composer is closed 2026-09-24: no hand-off and no onboarding line is written into it.

31. **D27 and D28 are live, and open 21 is closed with them** (2026-09-18, the ledger's _D27 and D28
    proven live, twice_). Everything the released code left unmeasured is measured: a bare sha checks
    out from Gitea, `zcli push` takes its key from the environment on a throwaway `HOME`, the
    platform accepts the 62-character variable name, a deleted runner is re-imported and running
    about ninety seconds after the merge, and a push whose branch feeds no environment ends green
    instead of red. What remains: the deploy token is long-lived, because only a person can mint or
    regenerate one, so it is not rotated after a job; and a repository whose `main` still carries the
    workflow from before D27 deploys nothing until its Mate's next delivery brings the current file.

32. **The last tests before zcp hardening** (2026-09-18, the ledger's _The last tests before the
    hand-off to zcp hardening_): merge from the conversation, the stage following, _Release_ with
    the tasks it carries, a roll back, a release after it, and a second task on a Mate whose first
    had landed — each live, in 58–73 s from click to serving. Two faults in the app, both fixed on
    `main`: the Mate's banner stayed after its merge (`d3ca1902e`), and the pull after a merge never
    ran (`3a9b48bba`, removed); the banner fix is measured live on the hosted app (#9, 13:09Z). Open for
    the app: after a merge the verb reads _Merge_ again for about a second before the row goes (the
    pending key ends before the re-read lands); a new release row moves the list under the pointer,
    so a second click lands on the next release's _Roll back to this_; and after a roll back, the
    release it left reads _Roll back to this_ though it is newer than what runs. Everything zcp's is
    in the hand-off, `../zcp/plans/zcp-hardening-handoff-2026-09-18.md`: running Mates keep their zcp
    until a restart, the Mate's branch takes `main` only at a delivery, a wired stage deploy is
    recorded dirty by construction, the recipe is not re-proposed on a setup change, the agents'
    words about their own tools, and agents doing the delivery's merge by hand (Fen merges, Vera
    rebuilt and force-pushed its branch).
33. **A group built from nothing, and what it cost** (2026-09-18, the ledger's _A group built from
    nothing_): the chain runs end to end — project, Mate, app, request, merge, stage, a second Mate
    on the same branch, merge, production, release — on mate 0.11.18, cut so the containers ran
    `main` rather than the morning's release. Three faults in the app, fixed on `main`: a group card
    could never stop saying it was setting up (`1cd211436`), and adding a Mate to an existing group
    failed twice at "Closing the project's shared variables" — a project search with no `clientId`
    (`51d7697c4`) and a create planned against an index that trails the write (`36e81e7ef`). Open
    for the app: a Mate restart can drop
    the projects page to "Could not load your Zerops projects" and pin a renderer at ~106 % CPU; a
    half-created Mate leaves a project the app can neither finish nor delete; _Update_ installs and
    then says nothing about the restart its version needs; a new Mate opens on a model the account
    may have no credits for, said only inside the conversation; and production's public route
    trails its release by ~2 min. The composer's loop is closed at its cause (2026-09-19,
    `0a3a462f9`): the controlled write's echo was suppressed by a flag lowered in a microtask, and a
    keystroke carried by the same Lexical commit was swallowed with it, leaving the screen and the
    editor holding different text and rewriting each other. The write now records what the editor
    actually holds, read back inside the same update, so silence is a comparison rather than a
    moment. Not yet re-measured live — a typing burst pinned a renderer at 101 % CPU before the fix,
    and the signed-in audit browser was lost with its temporary profile. **The owner's calls from
    the run**, for the spec: the golden path
    must not be escapable by wording (one clause, "on dev", left the work in a container,
    unsupervised and undelivered); a new Mate should fetch and run its code itself rather than ask
    the person to send the bootstrap message; deploying dev to dev makes no sense now that git is
    the code of record — it was a snapshot from before a remote existed, and it is what manufactures
    the empty deliveries; and an empty delivery must never become a request (`links/appdev` #2 was
    `zcp init`, zero files, merged by the owner; #3 re-offered it), nor keep its first session's
    title once it holds a later change.

34. **Pass 16's open ends** (2026-09-29; the rows above, the ledger's _Pass 16 as measured_). The
    live step and the question (D5, D6) show on a Mate only once its server runs this build, which
    its _Update_ brings with a restart; none has yet — the dev push needs the project VPN — so
    neither is seen live, and until then a working row keeps its dots and a waiting one its last
    words. Codex keeps its image order: its adapter is ported code and takes pictures by path after
    one text item, so there only the labels tie a picture to its place. "What it does" (R3) was
    empty in a live review of an older change, whose run's answers never linked it; a newer run's
    should, unmeasured. The flow's pull requests arrive about 8.6 s after a reload (Gitea's read):
    the composer's top is painted from memory meanwhile, but the change rows' tints, the chip's
    releases and a review's facts wait for it — slow before this pass too, and worth its own look.
    One first open scrolled its list 4 px while nothing on screen moved (the content above shrank by
    the same 4); the source is unfound. Not built: an approval's words on its waiting row, a long
    step's time in the menu, the browser's pictures in a review's checks (a commit status carries
    none), a release's usual duration, _Start_ on a stopped service in a result; and an ask the app
    sends at once (`requestSend`, from the Git tab or the jump box) still takes an unsent draft's
    place, where a fix request now joins it. Not yet run live: a merge, a release and a roll back
    through the review; a real pushed change's result row. Off the type scale still: the seams' and
    messages' times at 12 px where S1 says 13, and three 11 px leftovers (an image's placeholder in
    the person's message, upstream's review-comment card, the legacy tool output). For the owner to
    judge: the plan ring's removal (`cf210626b` brings it back), a plain disc where a Mate's owner
    is unknown, the Merge button's double focus ring, and the kit's measures kept where the mock
    drew less — _Open in Zerops_ padded 9 px for 6, the header's buttons 4 px apart for 2, the
    Mate's name 12 px from its task for 10, the send button 36 px on a phone.

35. **Pass 16's feedback, its open ends** (2026-09-29, mate 0.11.64). Pictures in a change's
    description need three releases in order: zcp closing the token-rotation gap (a rotated Gitea
    token leaves each dev service's `GIT_TOKEN` stale), gitea-mate adding `write:issue` to the bot's
    scopes with a re-mint and a broker route that reads an attachment for the person, then zcp
    uploading the Mate's screenshots into its description and a mate release reading them through
    the broker; the Mate writing its change's description at all is zcp's `describe-change`, built
    and not released. The menu: the member list's reading is not passed to the menu, so a Mate on a
    shared project token says "Nobody has signed in yet", and a row goes from 58 to 48 px once
    someone signs in. The crew line: the "JOB V1" chip still 10 px capitals, the lane bars as they
    were, and on a reload the header names the crewmate until the crew's feed answers. About twelve
    kit popovers were not opened live after the height fix, and below about 560 px of window the
    model menu opens beside its trigger. The result's tiles are six at 109 × 68 where the plan said
    about 128 × 80 (five would fit that); a file a later run overwrote without looking at it again
    shows its new contents under the older run. `changeVerdict.ts` is used only by a cross-check in
    `gitTab.test.ts`.

36. **Pass 16's second feedback round, open** (2026-09-29, mate 0.11.65). The Crew tab now holds the
    crew's section, but that section still speaks the engine: "CREW" and "LEAD" caps labels,
    `@handles`, "V3 AT NEXT TURN" and "BRIEF V3" chips, jobs written to the crewmate ("You own…"),
    and a run's mechanics ("Paused · time limit reached", "Spend … · Time 8 h of 8 h", _Resume_,
    _Stop_). The owner: "all of this is totally shit essentially, it's not clear how it works at
    all" — crew mode wants its model written in the owner's words and mocked as one flow before the
    section is rebuilt. _Forget memory_ has no door in the web app since the header's rebuild. A
    run's pictures from a late first answer may shift the strip once in a narrow column. The
    end-to-end proof of a change's pictures on a real pull request waits on Nova's usage limit. The
    crew's section is rebuilt in pass 20, as the approved board draws it (39).

37. **Pass 18's open ends** (2026-09-29, mate 0.11.66; the rows above). The live trial on a
    storefront project in the test org went from _Add_ to a running dev store with one person
    action, the authorization. Of what it found, 0.11.66 folds a watched run's card into its summary
    line as it settles and gives the card its room; pass 19 stops the "Session token expired"
    rejections every test-org Mate logged, opens New Mate over the view on screen and lands on the
    new Mate, draws a Mate coming up as coming up, and keeps a working Mate's face awake (38). Still
    open, zcp's two, fixed on a zcp branch not yet released: the recipe's services, imported without
    code, each carry an app version, so the agent read them as deployed; and the dev servers it
    started are not supervised, so a restart or a redeploy of a dev container leaves its address
    failing until someone asks again. Not yet seen live: the stand-up sent from its final screen,
    the line's switch, an ask from the Git tab or the jump box sending at once, a watched run's fold
    on a real Mate. Deleting a Mate, run live since (38): after a reload inside the platform's
    window the row reads Deleting… only once the platform says `DELETING`, and until then paints as
    a Mate that opens; a refusal says the adapter's fixed sentence ("Zerops rejected the request
    (forbidden)."), and a timeout's "Zerops command exceeded its deadline." may mean the delete went
    through; when the listing drops the Mate, the rows under it move up in one cut; a Mate that is
    only its name grows a line as it turns Deleting…; while only this tab knows, the projects
    screen's card still opens it and the jump box still lists it. Not built: a failed read of the
    group repo, or no Gitea session in the tab, still reads as no recipe, so the dialog would add an
    empty Mate. The owner's answers (2026-09-29: "just use your recommendation"): the chips' tones
    stay as built — amber for a release that failed while the old one serves, the hollow ring for a
    production stopped on purpose, nothing while a release runs; the top bar takes the logo row's 65
    px, a face can be changed after birth, and _New project_'s first Mate picks its face and stands
    up (all pass 19); a project with no recipe still gets an empty Mate; the Crew tab board is
    approved — idle time not counting against the limit — and built in pass 20 (39). Still for the
    owner to judge: a Mate row's band on the list's 9 and 8 px where a heading's stands 10 from
    either side; the stand-up replacing an unsent draft, and a colleague opening the new Mate seeing
    today's question; the dialog's title at the kit's 20 px.

38. **Pass 19's open ends** (2026-09-29, mate 0.11.67; the rows above). Run live on the localhost
    pair from 22:26 to 22:34Z with a throwaway Mate, Probe, on the test org's Snap project: New Mate
    opened over the view; _Add_ landed on the Mate's view in about 8 s, which read "Creating the
    project", "Building the container" and "Closing the project off" and turned into the stand-up
    screen 2 min 34 s after _Add_; _Change face…_ saved in about 1.5 s, every other tag kept (read
    back from the API), and held over a reload; _Delete_ closed its dialog in about 2 s, moved the
    view to the next Mate of the project, and the row read "Deleting…" until it left the menu about
    30 s later, the API then answering 400 for the project. The two faults it found are fixed: the
    _Authorize_ buttons on a white card, and the new Mate's row selected under the menu's fold. Not
    yet seen live: the stand-up sent from that screen, _New project_'s first Mate with its face and
    the stand-up, a colleague's client taking a changed face, and _Change face…_ on a Mate that wore
    its name's tint (`:named`). Still open: a colleague opening a new Mate's view sees its coming
    words, then the question; the birth line under the view's headline keeps its 12 px words and 11
    px time; j and k skip a row drawn from a birth alone, in its first second; older clients read
    `:named` as a plain pick, so the others' name tints can shift on them until they update;
    deleting a Mate that wore its name's tint still reshuffles the others'; a row's face swaps under
    the fading backdrop with no cross-fade of its own, and _Rename_, _Hand over…_, _Move to
    project…_ and _Delete_ still vanish in one frame; the wizard's proposed name, read once at
    mount, can collide with a name not yet read and be refused on press; a brand-new project's first
    Mate is asked to stand up development with nothing to stand up yet, as a Mate added to a project
    with no recipe is. The session fix is not verified live — signing a browser in mints throwaways
    — and a tab already open keeps the old code until it is reloaded, so a long-lived tab or window
    goes on presenting its ended sessions until then; the client behind the rejections is unnamed
    until a Mate runs this server, whose log line names the session and so, by its row, the device.
    A visible conversation still shows one quiet "Reconnecting to …" at a session's day boundary:
    hiding it takes a re-exchange minutes ahead with a socket handover, which reverses spec-mate
    §3.3's "the client does not renew" (MB-3) and waits on the owner. A hidden tab's Mates other
    than its route's stay blocked until it is shown, now without a request, and the banner's _Try
    again_ retries the link, which answers locally, not the door. The top bar: the closed menu's
    corner mark is still 20.3 × 24 px where the open mark is 28 × 33 — matching it would move the
    collapsed content's inset, a design call; the bare `ZeropsHostedFrame` bar, outside the menu,
    grows to 65 with the token; the route gate's floating notice centres at about 31 against the
    bar's 32.5; the stand-up harness still draws its own 52 px header.

39. **Pass 20's open ends** (2026-09-30, mate 0.11.68; the row above). The Crew tab
    was seen live only as it stood — Fen's crew stopped, its 8 hours used up at $0.00 by a server
    that counts wall time; the new clock reaches a Mate with its Update, and until then a crew with
    nothing to do still uses up its time. Not yet run live: a plan's _Start_, _Keep going…_ after a
    limit, an _Answer_ in a row, _Let Fen suggest a crew_, a piece of work added to Fen's code and
    shipped from _In Fen's code_. Kept where the board drew otherwise: the kit's look — the dialog's
    title at 20 px, its surface the kit's popover, the kit's radios and checkboxes, the radio
    group's 12 px gap for the board's 10 — and the run dialog as the kit's modal in the middle of
    the window, not inside the panel; times in the left menu's formats ("1d", "40m", "2:02 working")
    where the board wrote "yesterday" and "40 m"; a working row's third line in the card's own words
    ("Reading seasonClock.ts") where the board wrote a path. On touch a row's ··· shows only on
    hover, and everything in it is also in the conversation line's menu and the job view. The
    harness's row menu has no _Try its work_ (its logic is tested), the panel's 1 px border wraps
    one goal line a word earlier than the board, and the board's "Main" artboard, the chat beside
    the tab, was not compared. Older builds pair: an older client shows the new stop words as
    "Backend's task #12 stopped mid-way: when the $20 ran out", and an older server sends no
    `landedAt`, so its _In Fen's code_ rows carry no time.

40. **Pass 21's open ends** (2026-09-30, mate 0.11.69; the rows above). The crew's door on the
    server reaches a Mate with its Update. Mixed-login crews are closed per login in tests only (the
    harness closes every login); the closed composer slot was not measured at phone width. A
    crewmate's empty state wraps its whose line at 1280 with the panel open (a 305 px column). The
    run's opener rule leaves one narrow case: a Stop before the first thought and a resend within
    60 s with no notice between — the server knows which message started which turn
    (`projection_turns.pending_message_id`) and does not send it yet; a start stuck behind
    `WorkspaceHistory.prepare`'s shared lock has no timeout (a likely cause of the start that never
    ran); a restart settles a cut-off run as `error`, which the menu says as failed. The projects
    data layer still drops a project's services query the moment its last lease goes (the Mate's
    view no longer depends on it; its row briefly loses its service line); a stopped Mate's view
    offers the projects screen rather than Start. A result's pictures whose files are gone still
    draw as "Gone" tiles. The lone card's corners jump 20 → 34 if a bar arrives beside a card that holds
    only its line; a result band that ends up empty still draws an empty middle slice; reduced
    motion was checked in code, not in a browser. **The add-Mate flow**, recorded on Beviro the same day (26 min 9 s from
    _Add_ to development up, the person needed at 0:00 and 3:07, the stand-up 16 min of a model
    improvising a procedure zcp knows): the process to replace it is the next pass; its findings —
    `recipeTier.ts` strips `buildFromGit` even from public repositories (mailpit), the Mate tier's
    stage half is imported empty, the dev half's first deploys run one at a time, zcp's checks fail
    on a basic-auth inbox and on a dev service idling before its dev server — are the next pass's
    input.
41. **A deploy job that fails before it reaches the broker is invisible** (run 5, 2026-10-02). A
    group workflow's own step failed (`npm test` with no Node on the runner); the commit on `main`
    carried "Zerops deploy: failure", the broker's status stayed pending, and the menu and the cell
    said "first deploy on its way" for 4.3 min (up to its 15-minute bound). The fix the stage part
    proposed and the pass deferred: read `main`'s head statuses only while a declared stage runs
    nothing, and say "First deploy failed".
42. **zcp's workflow template leaves the runner's runtime to the Mate** — its test step defaults to
    `echo "no test command configured"` under "Replace with this project's own test command"; one
    Mate wrote `npm test` without `actions/setup-node` and the bare Ubuntu runner failed it (run 5),
    another added the setup (run 4). The template should set up the project's runtime, or say the
    runner has none.
43. **Two short blips in a stage's first deploy** (run 5): where the build ends and its version is
    not yet known, one window read "awaiting a first deploy" (menu, ~2 s) and "Checking what runs
    here…" (cell, 1.2 s); and the runner line came 4 s before the project was made, then gave way to
    "adding the app" and came back.
44. **A tainted runner's replacement may register with the org's same token** — Gitea's org
    registration-token read likely returns the latest active token; a replacement after a taint
    should reset it first. Needs Gitea 1.27's API checked (the runner part's review, pass 34).

## 8. Working on it

- **Run it on localhost.** The root `dev` script starts the pair (server on 13774, web on 5734); the
  owner's runs go through it against the test org, so a fix lands without a release. Delivery to a
  running container is the push loop (`../zcp/eval/scripts/mate-dev-push.sh`), not a release.
- **Release.** Fork: bump the three `package.json` versions, tag `vX.Y.Z` on `main`; the workflow
  publishes the tarball, `SHA256SUMS` and `stable.json`; zcp installs it at the next boot or
  `zcp mate update` (manifest cache one hour). The hosted app at mate.zerops.io rebuilds from a push
  to `main` by itself (the root `zerops.yml`, setup `prod`), a new bundle within about two minutes
  (measured 2026-09-17); it does not wait for the tag. zcp: its own release ritual, v9.176.0 carries the
  backbone. gitea-mate: a push to `main` is live for every new import; tag it as a marker.
- **Live checks.** Single-person probes in the Onboarding org, two-person and empty-org runs in the
  test org `Mate`; resources tagged `probe:<topic>-<date>`, listed, deleted, counts diffed. Empty-org
  runs are driven end to end by the scratch driver (`probe_d20_run.py`), the org wiped by the
  cleanup probe (`probe_mateorg_cleanup.py --apply`); both take credentials from the environment
  only. Read sensitive service variables with an integration token: a person's session reads
  `REDACTED`.
- **Where to write.** A decision → the spec. A measured fact → the ledger, one writer. A screen note
  → the journal. A change of state → this page, in the same commit as the change.
