# Zerops Mate and HQ — the primer

2026-10-05, `main` after mate 0.13.11 (`b4fddb6aff`). The one page that says what this project is, where each
piece lives, what is built, what is proven on the platform, and what is open — slice by slice. It
carries **state** and nothing else: design is the spec (`../../../../zcp/docs/spec-mate.md`), the
decisions and their reasons are [`design-decisions.md`](design-decisions.md), measured facts are the
ledger (`verified.md`), the client's state model — fact owners, machines, lifetimes — is
[`client-state-model.md`](client-state-model.md), crew mode as built is [`crew.md`](crew.md), and
the owner's screen-by-screen notes are the journal in `../../../../zcp/plans/` (transient). A row
here changes in the commit that changes the fact; the commit is the evidence.

**This page describes the release.** HQ is released and mandatory: mate **0.13.x** from `main`,
zcp from its own `main`, the client on mate.zerops.io. There is no product without HQ and no
fallback beside it. The Gitea backbone and its broker are retired: no client, Mate server or zcp
of the release reads or writes them, and their code is gone. One old Gitea project still runs, in
Mate s.r.o., until the pairs wired to it and each Mate's `GITEA_TOKEN` env are cleaned (§1, §7 2).
Where this page says what something does, it means `main`.

The slice names (T0–T14, TP, TB) are the rebuild's tickets, kept with the owner's plans (transient);
the plans say what is wanted, this page what stands.

---

## 1. What it is

Every Zerops organization that uses Mate has one **HQ**: a Zerops project named `Headquarters` and
tagged `mate:hq`, holding **Core** (the service `hq`), its Postgres (`db`), a volume (`vol`) where
the git repositories live and a bucket (`backup`) for its backup sets. The product opens only over
it: an owner or an admin opening an organization without one sees it born there and then, and
anybody else is told whom to ask and offered nothing more. An HQ is the organization's official one
when an org-Admin integration token named `mate-hq:<projectId>:<address>` names its project and its
address — the project's own domain — and no such token names another; two HQs are none.

HQ holds the organization's **structure**: its applications, the Zerops projects each holds with
their kind (`mate`, `devstage`, `stage`, `production`), a Mate's record — its face, who made it,
who asked for its stand-up, whether its project is closed off; never its name, which is its Zerops
project's (D3) — and an environment's record with its deploy token. A person reads it through HQ's own door, filtered by what they see in Zerops, and the
client draws its menu from one stream of it. An application is HQ's record, never a Zerops project
of its own.

Each person works in a **Mate**: a Zerops project with a `zcp` container running the Mate server and
a coding agent, its dev/stage pairs one per codebase. zcp enrolls the Mate with its HQ, and the Mate
server keeps a link to it: up goes its overview for every surface that draws a Mate it has not
opened, down comes its record. HQ keeps each
application's **repositories** — one per codebase, and the recipe repository `group`, whose `main`
holds every tier's import file. A Mate's work reaches `main` only as a **change**: HQ's record of
its branch `mate/<projectId>/<n>`, one open per Mate and repository, which a person merges as a
squash or closes. Core lands by itself a recipe change that only adds files.
After a squash, zcp's next explicit delivery starts its change from current `main` and keeps the
prior history under a recorded local ref; a background pass only records the landing. HQ decides
whether the delivered tree differs from `main`, and equal trees open no change.

**Core deploys.** When `main` moves, every stage that follows it gets the commit's archive, built
with the stage tier's setup by the environment's own deploy token. A release — an annotated tag on
`group`'s `main` that Core makes for whoever may release — sends production each service at the
commit it lists; a roll back is a new release listing an earlier one's commits. No CI, runner or
workflow holds a deploy credential.

Who proves what: a person's Zerops token stays in the app; entering a Mate or HQ hands that door a
throwaway, and HQ answers a session of its own. A Mate's Zerops key never leaves its container; it
proves the Mate to HQ by writing a challenge into its own project's env, and gets a Mate credential
back. Core reads Zerops with an org Read only token and deploys only with an environment's own key.

```
Zerops org (the owner)
├── Headquarters — tagged mate:hq; the anchor mate-hq:<projectId>:<address> names it
│   ├── hq — Core: the door, the structure, the git host, changes, deploys, releases
│   ├── db — postgresql@18, one node: the structure, sessions, changes, deploys
│   ├── vol — /mnt/vol/git: the application's repositories, bare
│   └── backup — Object Storage, 80 GB: the backup sets, by hour, day and month
└── Todo — an application: HQ's record, no project of its own
    ├── Todo - Fen — a Mate (kind mate): zcp, the Mate server, the agent; its dev/stage pairs
    ├── stage — Add stage: a project from the recipe's stage tier, follows main
    └── production — Add production: from the production tier, code only by release

HQ's repositories of Todo, at /git/<appId>/<repo>.git
├── group — the recipe: 0 — AI Agent, 3 — Stage, 4 — Small Production; release tags v{x.y.z}
└── appdev — one per dev pair; mate/<projectId>/<n> per change; main moved only by Core
```

An organization that ran the Gitea release kept its Gitea project, the broker's token, the
`deploy-*` tokens and each Mate's `GITEA_TOKEN`. Mate s.r.o.'s still runs: pairs wired to it
still name it as their checkout's `origin`, which a worktree's preparation fetches
(`apps/server/src/ws.ts`). It goes once those pairs are rewired and the `GITEA_TOKEN` env is taken
off. Nothing writes to it. HQ holds it as a tool (`hq_tool`, streamed as `tools`), but the client's
exclusion of it from the applications (`tools.ts`) reads `hqTool`, which nothing sets today: the
structure's parser (`hqStructureOf`) drops `tools`. The client neither reads nor writes the old Gitea, calls no broker and
sweeps none of the `gitea-signin:` throwaways an earlier client minted. The migration ran (T13,
T14) and its code is gone.

## 2. The parts and where they live

- **The app — web, desktop, mobile** — this repo (`zeropsio/mate`): `apps/web/src/zerops`,
  `apps/web/src/components/zerops`, `packages/client-runtime/src/data` (the account data layer),
  `packages/client-runtime/src/zerops` (HQ wire/client utilities in its `hq/`)
  - _Does:_ sign-in; HQ's birth and the gate in front of the product (`hqBirth.ts`, `hqGate.ts`);
    the menu from HQ navigation projections (`data/projections/hqNavigation.ts`); _New project_,
    _Add Mate_, _Add stage_, _Add production_ written into HQ, with an environment's deploy token minted and handed over; a Mate's
    change, its review, _Merge_ and _Close_, the Git tab and the Git page `/git`, from HQ;
    _Release_, _Roll back to this_, a repository's history and what each release carried, from HQ;
    what the stage and production run, as HQ records it; every verb HQ owns drawn from what HQ offers
    the person in scoped facts, the client deciding no permission
  - _Data flow (Mate 0.14.26):_ adapter → reducer → keyed account store → projection → component.
    One Zerops socket per account carries organization-wide membership/update registrations for
    projects, processes, services, active versions and public HTTP routings (10 registrations,
    independent of the Mate count). Detail is demanded while drawn. Remote facts live in account
    memory, with no browser-storage caches and no fixed-interval polling for live facts. Sources
    without realtime use a declared sampled policy while demanded. The old Zerops runtime, query
    cells, grant driver and second socket are removed; inventory's presentation join remains D03,
    database catalog/query reads D57 and versioned browser frames D47 ([data layer](data-layer.md)).
    HQ writes are operations with receipts: accepted, reflected and completed are distinct; a lost
    answer is recovered from identity or proven effect, never a blind resend
- **HQ Core** — `apps/hq`, the service `hq`, deployed by HQ's birth from the build the app came with
  - _Does:_ the leader lock and its epoch, the official check, `/health`; the door and its sessions;
    the scoped HQ protocol (navigation, app-detail, change, discussion, operation and attention);
    the Mate credential and the Mate's link; git at `/git/*`; changes,
    merges, comments and pictures; the recipe; environments and their deploy tokens; stage and
    production deploys; releases; backup sets and their restore; and what each reader may do, its
    one rule `can` (`permissions.ts`) streamed as offers (`offers.ts`)
- **The git layer** — `packages/hq-git`, inside Core
  - _Does:_ bare repositories on the volume, smart HTTP, the write rule — a Mate pushes only
    forward, only to its own open change's branch; nobody deletes; `main` and tags move only by Core
    — squash merges against the head that was reviewed, bounded reads, archives, the event log. Git
    runs with `core.hooksPath=/dev/null` and `core.fsmonitor=false`
- **The shared rules** — `packages/shared/src`: `zeropsPermissions.ts` (the wire contract of HQ's
  `can`: its reasons and a decision's shape; the rule itself is HQ's alone, and the lint rule
  `no-direct-permission-rule` reports any client import of it), `hqOffers.ts` (what HQ offers, and
  the four states a control draws), `zeropsDoor.ts` (the throwaway check behind HQ's door; the Mate
  server's door judges a token's shape by the same `checkDoorTokenShape`), `zeropsRoles.ts` (with
  the client's two Zerops predicates, `mayBearHq` and `mayCreateProjects`), and the wire contracts
  `hqChanges.ts`, `hqDeploys.ts`, `hqRecipe.ts`, `hqRelease.ts`, `mateLink.ts`
- **The Mate server** — `apps/server/src/zerops`, installed into every Mate by zcp from the release
  manifest
  - _Does:_ the door (`zerops-throwaway`), the membership watch, the agent-signer gate over its own
    sign-in record (`zeropsSignIns.ts`), the link to HQ (`ZeropsHqLink.ts`), the setup report
    `/setup.json` and the stand-up it sends once its asker has signed in (`ZeropsSetup.ts`), the
    checkout side of the Git tab
- **zcp** — `../zcp`, its own `main`
  - _Does:_ in every Mate: finds the official HQ and keeps the Mate enrolled (`internal/hq`); a
    repository in HQ per dev pair; the delivery as the Mate's change; the recipe proposed as a
    change of `group`, and the stand-up from its AI Agent tier; `zcp hq git-credential`, which
    answers git with the Mate credential for HQ alone. It installs the Mate server from the latest
    release's `stable.json`, with no pin, and seeds a Mate's absent sign-in record from the signers
    HQ names for it, once
- **The old Gitea** — `../gitea-mate` (`zeropsio/gitea-mate`): retired from the product; the one
  Gitea project still running, Mate s.r.o.'s, waits for its pairs to be rewired (§1, §7 2)

The hosted build packs Core under `hq-core/` beside the web bundle (`apps/hq/scripts/pack-core.ts`,
the root `zerops.yml`), so an HQ is born with the Core of the client that bore it. Later, an owner or
an admin updates it from HQ's card at the projects page's end to the Core the client carries
(`client-runtime hq/update.ts`).

## 3. Who holds what

- **a person's Zerops token** — the app
  - _Reaches:_ the Zerops API only; no container, and not HQ
- **a door throwaway `mate-door:{project}:{nonce}`** — minted by the app for one entry, `NO_ACCESS`,
  no grants, no flags, at most five minutes old by the API's clock; deleted by the app right after,
  and one whose delete did not land swept by the browser that owes it, by the id its mint answered
  (by its name only where that answer was lost), never by its look
  - _Reaches:_ one Mate's door, or HQ's (`POST /api/door`, named for HQ's project); each reads its
    creator and the role fresh with its own key
- **an HQ session** — answered at HQ's door, kept per account, organization and HQ across loads
  (K7) and sent as a bearer; HQ keeps only its SHA-256, for 12 hours, a throwaway opens one session,
  and the account's close revokes every kept one at its HQ
  - _Reaches:_ HQ's API as that person, every verb decided by `can` over the org as HQ reads it; a
    write that cannot be undone over roles read for it (§5, TP)
- **HQ's anchor `mate-hq:{projectId}:{address}`** — an integration token minted at HQ's birth with
  the org role Admin, its value dropped at once
  - _Reaches:_ nothing: it is the mark in the member list that makes this HQ the official one
- **HQ's working token `mate-hq-org:{projectId}`** — org Read only, the sensitive `HQ_ORG_TOKEN` of
  `hq`, minted by the owner's or admin's client at the birth
  - _Reaches:_ reads of the org, its members and projects, and a project's env (a Mate's challenge);
    it writes nothing on the platform
- **a Mate's Zerops key `ZCP_API_KEY`** — `NO_ACCESS` at the org and `BASIC_USER` on its own
  project, nothing more (`api.ts:1819`, ADR 0003); a sensitive variable of its `zcp` service. Its
  harden (`hardenMate`), when a person finishes setting the Mate up and never on a page's read (step
  A, A11), sets it to its own project alone (`planMateKey`): a key found by the id the Mate enrolled
  with HQ loses every other grant, a `READ_ONLY` grant on a sibling an earlier client gave included;
  a key found only by its name is the Mate's only while it holds its own project alone, and is never
  narrowed. A widened key the Mate names, HQ says (`keyWider`) and tells Finish setup by its id. A
  grant on a key HQ cannot identify stays until it is taken off by hand
  - _Reaches:_ its own project — the door's role reads, zcp's every platform call, the challenge it
    writes for HQ
- **a Mate credential** — issued by HQ for a challenge whose nonce it finds in the Mate's own
  project env (`MATE_HQ_CHALLENGE`); 256 bits, HQ keeping only the hash; one live per project, no
  expiry, revoked by the next issue or when the project goes; kept by zcp in
  `~/.zcp/hq/enrollment.json`. One Mate per project (D2): the Mate's record names its zcp service,
  the first that enrolls naming itself; another zcp service of the project is refused with
  `not_this_projects_mate` (409) and never revokes the Mate's credential, unless Zerops no longer
  has the one named
  - _Reaches:_ the Mate's side of HQ — its repositories and changes, its recipe, `/api/mate/self`,
    the link — and git at `/git/<appId>/<repo>.git` as the user `mate`; it never leaves the
    container
- **an environment's deploy token `mate-hq-deploy:{environment}:{projectId}`** — `NO_ACCESS` at the
  org, `BASIC_USER` on that stage or production and nothing else, minted by the client of the
  person who adds the environment and handed to HQ, which never answers it back; checked at the
  hand-over and before every deploy. Its name sets it apart from main's `deploy-*` keys
  - _Reaches:_ that one project: Core deploys to it and opens its subdomains with it
- **an agent's login** — each Mate; whose it is, the Mate server's own record
  (`~/.mate/signed-in.json`), written at each sign-in it saw and relayed to HQ in its overview's
  logins
  - _Reaches:_ turns from the signer only; signed out when the signer leaves the org
- **a deploy credential in CI, a runner or a repository** — none
- **the old Gitea's tokens** — the broker's, the `deploy-*` keys on its service, each Mate's
  `GITEA_TOKEN`: still in Mate s.r.o. until its pairs are rewired and the env is cleaned (§7, 2); zcp
  still masks `GITEA_TOKEN` and keeps it out of a recipe (`isControlPlaneEnv`). The client mints no
  `gitea-signin` throwaway and sweeps none

## 4. How a run goes

On `rebuild/int`, in KRLS's `mate-rig-*` projects and its `Headquarters`, 2026-10-01/02 (the
ledger's _The HQ rebuild, as measured_):

1. **The organization's HQ.** An owner opening KRLS saw its HQ born in seven steps, which this
   browser keeps so that a reload goes on from the step it reached: the `Headquarters` project from
   an import sent at most once, its services, `HQ_ORG_TOKEN` once the import's variables have
   synced, Core deployed from the client's own build — uploaded once, its build asked again while
   Zerops still syncs the variables (`birth.ts:13-21`) — the project's domain routed to Core with
   its certificate (about ten seconds), the anchor, and `/health` answering `official: ok`. A
   Developer of KRLS sees the product; in an organization without HQ anybody but an owner or an
   admin is told whom to ask (`hqGate.ts`).
2. **A Mate joins HQ.** HQ holds the Mate's record from the client that made it; zcp finds the
   official HQ from the member list, writes its challenge into its project's env and enrolls
   (`mate-rig-a - Gita`); the Mate server opens its link and sends its overview, and the menu draws
   the Mate from HQ's stream.
3. **Delivery.** A deploy onto the pair's stage half delivers: zcp takes `main` in, opens the Mate's
   change once the checkout is ahead of it, and pushes the change's branch with the Mate credential.
   A change opened under the default title takes the work session's first line.
4. **The recipe.** At the bootstrap's close zcp proposes the tiers `group`'s `main` lacks as its own
   change, and Core lands it, for it only adds files; every tier then reads back as the Mate and as
   the owner.
5. **Merge.** The owner merges a change from its review in the browser — a squash onto `main`, which
   HQ refuses as `head_moved` if the branch moved since the review — and the next delivery takes the
   squash into the Mate's branch, so its next change carries only the new work.
6. **Stage.** A project from the stage tier, attached to the application as `stage`, its deploy
   token handed to HQ (`keyHeld`): a merge into `main` was deploying about 10 s later and live about
   81 s later, the service running the version named `main <7 hex>` and its subdomain answering.
   Run twice; both stages and tokens deleted after.
7. **Release and production** are built in Core (T9a) and in the client (T9b) and not run live.

## 5. Status, slice by slice

**live** = built and proven on the platform · **built** = code and tests, no live proof yet ·
**partial** · **open**. "Built in" names the merge into `rebuild/int` (zcp's on its own) before
the switch, into `main` after it, or a release; "proven by" a ledger row or a test. A live proof whose ledger entry is
still to come says so.

### HQ

- **T0** — The platform's facts HQ stands on
  - _State:_ measured 2026-10-01 and 02 in KRLS (the ledger's _The HQ rebuild, as measured_): an
    unmarked project env a `BASIC_USER` token writes is read at once by an org Read only token's
    direct `env-file` read, while the project search trails it by up to about 1.6 s; an org-Admin
    token named `mate-hq:…` is listed among the members to every reader; a version deployed with
    `readinessCheck` and `temporaryShutdown: false` takes over without a failed request, and one
    whose check never passes fails while the old one serves; a project with Postgres and a runtime
    imports in 54–66 s. The hostname `core` is reserved: an import under it made a project that
    could not be deleted
  - _Proven by:_ what leans on them says so — `mateCredentials.ts`, `apps/hq/zerops.yml`,
    `hq/birth.ts`
- **T2a, T2b** — The git layer: repositories, smart HTTP and the write rule; changes, squash, reads,
  archive, events
  - _State:_ live — under every run of §4
  - _Built in:_ `d5558dc9bc`, `772934187d`
  - _Proven by:_ `packages/hq-git`: `rules.test.ts` (another's branch, `main`, a tag and a deletion
    refused to a Mate), `integration.test.ts` against real git ("disables a malicious hook during
    real stateless receive-pack without HTTP"), `operations.test.ts`, `protocol.test.ts`
- **T3, T3c** — Core: one leader, migrations, `/health`, the official check, the Zerops port; HQ on
  its project's own domain
  - _State:_ live — Core on the rig and as KRLS's `Headquarters`; a new version stands by on
    `/health` until the old one gives up the lead, and one whose `/health` never answers fails while
    the old one serves
  - _Built in:_ `8c05a9fa73`, `ce67d50fb6`, `ec40911287`
  - _Proven by:_ `leader.test.ts`, `health.test.ts`, `migrations.test.ts`, `official.test.ts`,
    `core.test.ts`; `zerops/contract.test.ts`, one contract the fake and the real API both pass
- **T4a** — HQ's door for a person, the structure and its API
  - _State:_ live — the client enters HQ through its door on every run of §4
  - _Built in:_ `397ec2741b`
  - _Proven by:_ `zeropsDoor.test.ts` (shared), `sessions.test.ts`, `rateLimit.test.ts`,
    `structure.test.ts`, `api.test.ts`
- **T4b, T4c** — HQ's birth, and the gate in front of the product
  - _State:_ live — KRLS's `Headquarters` born from the app with `official: ok`, a Developer of KRLS
    in the product, an owner seeing HQ born in an organization without one, 2026-10-02 (ledger entry
    pending). The birth runs at an owner's or an admin's first visit, never at _New project_; a
    project is never taken for HQ by its name or tag; an HQ that does not answer is no gate but a
    line saying since when
  - _Cross-browser birth:_ built and tested locally, not live-verified: the nascent project's
    append-only env journal owns progress and action receipts; 90-second claims arbitrate its
    browsers, failed steps require **Again**. Automatic admin entry stays. See
    [HQ birth](hq-birth.md) for the claim, read lag and interrupted-request limits.
  - _Built in:_ `5c884c0176`, `ced74baea4`, `1dff2924db`, `c846f34f66`, `cbfecb6f58`
  - _Proven by:_ `hq/birth.test.ts`, `hq/anchor.test.ts`; `hqBirth.test.ts`, `hqGate.test.ts`,
    `accountHq.test.ts`, `ZeropsHqGate.test.tsx`
- **T5** — The structure in HQ, and the menu from its stream
  - _State:_ live on the rig — _New project_, _Add Mate_, an environment's attach and a Mate's
    registration write HQ through operations with receipts. One HQ socket per renderer and organization
    carries revisioned navigation, with app-detail, change, discussion, operation and attention
    scopes demanded separately. Reconnect resumes each scope by incarnation/revision and known keys;
    retained deltas or a scope reset end at `scope-ready`. Navigation never hydrates detail.
    Explicit removals distinguish deletion from lost access; outages retain last-known facts.
    HQ follows Zerops by itself — a deleted project leaves, a lost role hides — and its server
    reconciliation is separate from client demand ([HQ scopes](hq-scopes.md)). The client writes no
    structure tag: its one tag is the `mate` marker
    (`tagPatch.ts`), written for the Zerops GUI and read by nothing — a Mate exists where HQ places
    it, its container the only other evidence (`groups.ts`); a project carrying only the marker is
    no Mate row, no _Set up Mate_ and no taken name. Every press — a Mate's, a stage's or a
    production's — holds its project at HQ while it runs (`hq_press`, migration `0041`): taken
    once Zerops accepts the project, by a person who is a Basic user or above there, renewed every
    60 s and at its steps (at most every 20 s) for a 300 s hold, and given its container import's
    Zerops process once Zerops answers; a second press of the project is refused before it writes,
    and a hold HQ refuses this person is never asked again. A press that finishes deletes its record
    (an environment's with its registration); one that stops ends its hold and keeps it. Another
    browser reads a held press as still on its way and one that stopped as half made — _Finish
    setup_ for its kind — never by the project's age; a stage or a production cut short before its
    registration is placed in its application by its press's record, never offered as a Mate
  - _Built in:_ `85c663ae23`, `00836084d9`; existence by placement `eb8a681c13`; the press hold
    `1fcde9dacb`, `d6e7485483`, `4fa50db240`, `abac4d3da8`, `246c6c49ab`, `89078e24cc`,
    `081ee073c4`, `d4bb69191e`, `5944268673`
  - _Proven by:_ `structure.test.ts`, `api.test.ts`; `hq/stream.test.ts`, `hq/registry.test.ts`,
    `hq/placement.test.ts`, `hq/pressElsewhere.test.ts`; `hqStructure.test.ts`,
    `useZeropsRegistry.test.tsx`, `matePress.test.ts`, `usePressesElsewhere.test.tsx`,
    `finishSetup.logic.test.ts`
- **TP** — Who may: one pure rule, `can`, HQ's alone, and what HQ offers by it
  - _State:_ built — HQ asks `can` (`apps/hq/src/permissions.ts`) for every structure, change,
    deploy and release verb, and streams what each reader may do in its navigation facts
    (`offers.ts`): the organization's verbs in the org message, a `can` record beside each
    application, environment and Mate, and a Mate's `moveTo` choices — decided over the target the
    write is enforced with, over the org as HQ last read it. The client decides no permission: it
    draws each verb from that record (`hqOffers.ts`) as allowed, refused in HQ's words, unknown —
    drawn not pressable, "HQ has not said yet" — or unavailable since HQ stopped answering, and a
    re-read keeps the last record. A Mate's Open, Start, Restart and Remove are the door's and
    Zerops' to refuse, hidden only where HQ refuses following the Mate. The client's own Zerops
    predicates are two, `mayBearHq` and `mayCreateProjects` (`zeropsRoles.ts`), and
    `no-direct-permission-rule` reports any client import of `can`, with no exception ledger. A write that
    cannot be undone — a merge, a close, a release or a roll back, a deploy asked again, a service
    added, deleting an application or preparing and completing a project's deletion, keeping a
    deploy token, moving or detaching a project, attaching an environment — is decided over roles
    read after it was asked (`decidedFresh`, within the write's 35 s); Zerops silent, HQ writes
    nothing and answers 503 `zerops_unanswered`, which the client says as a refusal, never as a
    write that may have landed. A change of kind between a Mate and an environment is the
    structure's writers' alone, so an Admin of a production alone can no longer make it a Mate
  - _Built in:_ `ec23795d2c`, `5e13b14ed6`, `1ecee21489`, `812b8078d9`; the offers `1b01acb0a5`,
    `39274b6f2f`, `878c578a51`, `3efa9f5105`, `97cda83b41`; `can` moved into HQ `15d8b38602`; fresh
    roles `345f70fe35`, `94447479d9`
  - _Proven by:_ `permissions.test.ts` — a table per verb, and over the whole input space "never
    lets a grant on the target stand in for the structure's writer", "never allows more after a
    lowering…"; `offers.test.ts`, `roles.test.ts`, `structure.test.ts`; `hqOffers.test.ts`
- **T6a** — A Mate proves itself to HQ through its own project's env
  - _State:_ live — `mate-rig-a - Gita` enrolled, 2026-10-02 (the ledger's _The HQ rebuild, as
    measured_). zcp keeps the enrollment (`hq.Keep`): retried with a growing wait while there is no
    official HQ or no record of the Mate yet, and asked again every 10 min, which enrolls anew once
    HQ no longer knows the credential
  - _Built in:_ `be33fff375`; zcp `0af31ed28`, `abd07e960`
  - _Proven by:_ `mateCredentials.test.ts`; zcp `internal/hq/enroll_test.go`, `keep_test.go`,
    `official_test.go`, `store_test.go`
- **T6b** — The Mate's link to HQ; a Mate's birth and its signer out of the project's tags
  - _State:_ live on the rig, 2026-10-02 (ledger entry pending). The Mate server holds one outbound
    socket, reads the enrollment again before every connect, and tries again after 1, 2, 5, 10, 30
    s. Up goes its overview (`zeropsHqOverview.ts`): its main chat as a menu row reads it, a digest
    of its other chats, its logins and its crew — whole first on every link, then only the sections
    that changed, on its own events. HQ keeps it, stored across a restart (`mateOverviews.ts`), and
    hands each Mate's view and source-ordered attention to whoever may observe it through HQ scopes;
    the menu, the rows,
    notifications, the palette and the crew line draw from that, with no socket to the Mate (step
    A, A0–A8, A12). Who
    asked for a Mate's stand-up and its close-off are HQ's record; whose a login is, the server's
    `~/.mate/signed-in.json`. No `mate:signer:`, `mate:standup:` or `mate:closed-off` tag is
    written; zcp seeds an absent sign-in record once from the signers HQ names for the Mate
  - _Built in:_ `c199e51eef`, `14369a03c6`, `71258784ef`, `d168c83f84`, `2b022c8341`; zcp
    `abd07e960`, `9f800923f`
  - _Proven by:_ `ZeropsHqLink.test.ts`, `zeropsHqOverview.test.ts`, `zeropsSignIns.test.ts`,
    `ZeropsProjectSigners.test.ts` ("signs out the agent whose signer the org no longer knows"),
    `ZeropsSetup.test.ts`, `hqMateBirth.test.ts`; zcp `internal/mate/signins_test.go`
- **T7a** — A Mate's changes in HQ: the contract, git in Core, records, events
  - _State:_ live with T7b
  - _Built in:_ `1e57d21699`; a Mate's own changes with their titles in its state, `1a936d7272`
  - _Proven by:_ `changes.test.ts`, `api.test.ts`, `gitHost.test.ts`; `hqChanges.test.ts`
- **T7b** — zcp delivers into HQ
  - _State:_ live on the rig, 2026-10-02 (the ledger's _The HQ rebuild, as measured_): a delivery
    opened the Mate's change; the next delivery took the merged squash into its branch, its change
    carrying only the new file; a change opened under the default title took the work session's
    first line. Not run live: a delivery owed while HQ did not answer, finished afterwards
    (`FinishPendingDeliveries`)
  - _Built in:_ zcp `3e2d569d7`…`d4637b69e`
  - _Proven by:_ zcp `internal/hq/changes_test.go`, `gitcredential_test.go`;
    `internal/tools/hq_delivery_test.go`, `hq_git_push_test.go`, `hq_pending_test.go`,
    `hq_wiring_test.go`, `hq_pair_lock_test.go`
- **T7c** — The client reads a Mate's changes from HQ: review, chip, Git tab, comments
  - _State:_ live with T8a. A change carries no checks; its files, diffs and commits come in one
    read (`changeReadout.ts`), and a diff past 2,000 lines says how many it leaves out
  - _Built in:_ `df9660695a`
  - _Proven by:_ `changeReadout.test.ts`, `reviewVerdict.test.ts`, `changeDiff.test.ts`,
    `ZeropsReview.logic.test.ts`, `useZeropsChangeDetail.test.ts`,
    `useZeropsChangeComments.test.ts`, `useOpenZeropsChange.test.tsx`
- **T8a** — Merge and close in HQ
  - _State:_ live — a change merged by the button in the browser on the rig, 2026-10-02 (the
    ledger's _The HQ rebuild, as measured_). A squash onto `main` carries the change's and the
    crew's trailers and is refused as `head_moved` if the branch moved since the review; one merge
    of a repository runs at a time
  - _Built in:_ `d97d83e90a`, `bf727bd498`
  - _Proven by:_ `merge.test.ts`, `mergeRetry.test.ts`; `ZeropsChangeReview.test.tsx`,
    `ZeropsReviewDoors.test.tsx`
- **T8b** — Environments, deploy tokens, stage deploys
  - _State:_ live — a stage on the rig twice, 2026-10-02 (the ledger's _The HQ rebuild, as
    measured_): attached with its token, a merge deploying about 10 s later and live about 81 s
    later as `main <7 hex>`, its subdomain answering. Only the leading Core deploys. Since the
    deploy-jobs design (built 2026-10-03, not yet measured on a rig) nothing deploys on a timer and
    nothing is tried twice: every deploy is a job an event asked for — a merge, a release, _Run
    again_, _Add {service}_, an environment added, a deploy key kept — submitted in that event's
    own request, which answers where each job stands; one build at a time per environment, the
    rest queued behind it, a newer job superseding only one still queued; a lost answer is read
    back from the version HQ made, never submitted again; HQ follows a build 75 min at most, and
    every job ends live, failed (the build's own, final until a person asks again), refused (HQ's
    words why), skipped (HQ's words why it submitted nothing) or superseded; a Core taking the lead
    follows what builds and submits what waits; a service running a version HQ did not deploy is
    said with _Deploy {sha} again_ and never overwritten; a recipe merge imports only the services
    its tier change added, follows its own import to its end and only then asks for their deploys,
    and a service a person deleted comes back only by _Add {service}_; every Zerops request is
    asked once, a read too. A version still waiting for its archive is measured from HQ's own
    upload, recorded once it answered (migrations `0039`, `0040`; a job from before keeps its
    submission's window), and an upload that went unanswered asked for no build; a subdomain's
    process is followed on its own 75 min from when it was asked. Each environment carries its
    **birth** (`hqDeploys.ts`): HQ is bringing it up from its attach through every `env_added`,
    `key_kept` and _Run again_ rollout until the first deploy that went live or failed in its
    build, and a first deploy ends live only once its subdomain's process ended. The client says an
    environment is coming up while that birth runs or the platform makes something of it — never by
    its age — and a first deploy fails by its owner's word: HQ's job for a build HQ made, the build's
    Zerops process for one it did not. The broker grant and the Gitea deploy path are gone from the
    client
  - _Built in:_ `2d93cc977d`, `bfc003b9fb`; the upload's window `68f33a591b`, `ddf07a6cab`; births
    `62b5a2ac29`, `96d69d4a46`, `66d748d75e`; a first deploy's verdict `22c61df584`, `421c789375`;
    the subdomain's clock `9fffa914d6`
  - _Proven by:_ `deploys.test.ts`, `environments.test.ts`, `tierRuntimes.test.ts`,
    `recipeDeltas.test.ts`, `versionNames.test.ts`, `zerops/deploy.test.ts`, `structure.test.ts`;
    `hq/environments.test.ts`, `hq/deployAnswer.test.ts`, `flow/stopDetail.test.ts`,
    `stopComing.test.ts`, `ZeropsDeployAnswer.test.tsx`,
    `addGroupEnvironment.test.ts`, `deployToken.test.ts`, `ZeropsProjectFlowProvider.render.test.tsx`,
    `SidebarProductionChip.logic.test.ts`, `ZeropsGroupDetail.test.tsx`,
    `stageComingUp.replay.test.ts`
- **T10a** — The application's recipe in HQ
  - _State:_ live on the rig, 2026-10-02 (the ledger's _The HQ rebuild, as measured_): zcp proposed
    the tiers `main` lacked as the Mate's change of `group` at the bootstrap's close, Core landed it
    by itself, and every tier read back as the Mate and as the owner. A recipe change that edits a
    file waits for a person, an empty one Core closes. A scale a Mate learned is proposed, when
    asked, as a change of its own that a person merges; with one open change per Mate and
    repository, it and the additive proposal never write over each other. _Add Mate_ and a new
    environment read their tier from HQ
  - _Built in:_ `69502d179b`, `a2daa87881`, `7e41c9e963`; zcp `deab144c3`…`5865657ce`; the
    proposal's title from the Mate's state, zcp `5697ab07c`
  - _Proven by:_ `recipe.test.ts`, `hqRecipe.test.ts`; `useZeropsAppRecipes.test.tsx`,
    `useZeropsGroupRecipe.test.tsx`; zcp `internal/tools/hq_recipe_test.go`,
    `hq_recipe_scaling_test.go`, `internal/hq/recipe_test.go`
- **T10** — The stand-up from HQ's recipe
  - _State:_ built — _Add Mate_ with an agent records the person pressing as the stand-up's asker
    (`standupRequestedBy`), and _New project_'s Mate gets no ask; the Mate's server sends "Stand up
    development of the project." once that person has signed an agent in, and zcp's stand-up reads
    the AI Agent tier from HQ. The setup's Git step reads zcp's enrollment outcome, and says why
    when it failed. A stand-up ends by its process and its turn, never by a clock: zcp names the MCP
    server running it by PID and start time, and the stand-up fails (`process_gone`) only once that
    process is provably gone — no such PID, or the PID under another start time — never because its
    status file is quiet; the relay matches each section to the call running it (`callStartedAt`),
    and a stage wait ends with the turn of the call it waits on (`stage_not_built`: development
    stands, the stages were not built). Only `send_failed` offers the manual retry. Not yet seen in
    the browser
  - _Built in:_ `14369a03c6`, `2b022c8341`, `3e3b62e964`, `322899cfe9`; zcp `deab144c3`…`5865657ce`;
    its end `6cf294ea0c`, `d99e980b77`, `ea31e04e43`, `ae51c29807`, `233eddb243`, `ebfd159388`
  - _Proven by:_ `ZeropsSetup.test.ts`, `zeropsSetupSteps.test.ts`, `ZeropsStandUpRelay.test.ts`,
    `hqMateBirth.test.ts`; zcp `internal/tools/standup_test.go`
- **T9a** — Releases in HQ, production from the newest approved release, a roll back as a new
  release
  - _State:_ built — Core checks a release under the recipe repository's lock (a name newer by
    version than every release; `main` still the head offered; each service's commit on its
    repository's `main`) and tags `v{x.y.z}` on `group`'s `main` for whoever `can`'s `release`
    allows; production deploys each service at the commit the newest approved release lists, named
    `<tag> <7 hex>`; a roll back is the next patch, listing an earlier release's entries. No check
    waits on a stage. Each production streams its application's newest approved release with its
    rollout: planned, `ended` once every job it asked for there ended (and every job of a commit it
    left out as under way), and `landed` where every job and every job it waited on went live and
    its plan is complete; a release with no rollout of its own is ended. Not run live
  - _Built in:_ `b07384435b`; the rollout's stream `829bd22ee3`, `ada55703b8`
  - _Proven by:_ `releases.test.ts`, `hqRelease.test.ts`, `deploys.test.ts`
- **T9b** — The client's release from HQ: offer, review, history, roll back, the production chip
  - _State:_ built — _Release_ is offered by HQ's rule and made in HQ as the person
    (`HqApi.release`), what it would put live read from HQ's comparisons; _Roll back to this_ is a
    release HQ makes (`HqApi.rollback`); a project's releases, a repository's history and what each
    release carried are HQ's records and comparisons; a release's verdict is HQ's. A release is on
    its way until HQ ends its rollout in every production, and a review is stalled only where HQ
    ended it without landing — no client clock decides either, and _Release_ is not offered while HQ
    still follows a build; a production failure is a release's where HQ's rollout links it — the job
    it asked for, or the job of the commit it left the service out for — never by time. A press of
    _Release_, _Merge_, _Close_ or _Run again_ holds until HQ reads its effect back or stops
    answering. Until HQ's releases are read, the production chip is only partial. A roll back lists what leaves production and what
    comes back, each row opening its change's review, and redeploys the services `rollbackServices`
    names (`releaseCompare.ts:189`); the production chip never says healthy over a service whose
    version cannot be told (`SidebarProductionChip.logic.ts`). No release, stop, history or review
    surface reads or writes the old Gitea. Not run live
  - _Built in:_ the compare route `fdd2f82cd0`; `17b5f14e3d`, `f2ac9f4ef8`, `c602ed6d80`,
    `3cbebe4e90`, `2bf7dbf48e`, `690a9997b2`, `a6cf7aeb87`, `fe416b2b05`; ended by HQ's rollout
    `1991abae3d`, `ec7486335e`, `ebd1841969`; held presses `c648607c1f`, `9344ad2a24`
  - _Proven by:_ `compare.test.ts`; `hq/client.test.ts`, `releaseCompare.test.ts`,
    `useZeropsAppReleases.test.tsx`, `useZeropsCompares.test.tsx`, `useZeropsHistory.test.tsx`,
    `ZeropsReleaseReview.test.tsx`, `SidebarProductionChip.logic.test.ts`, `menuMemory.test.ts`
- **T11** — The Git page and the Git tab over HQ
  - _State:_ built — `/git` lists every application's repositories and the changes open on them; the
    Git tab keeps the Mate's checkout and its change
  - _Built in:_ `ddb3c88a08`; the path `/git`, `7cd89a21a6`
  - _Proven by:_ `ZeropsGitPage.test.tsx`, `ZeropsGitPage.logic.test.ts`, `gitOverview.test.ts`,
    `ZeropsGitPanel.test.tsx`
- **T12** — Nothing of Gitea or the broker left but what the old system needs
  - _State:_ built — the client opens no Gitea session, calls no broker and has no Gitea client: the
    `/gitea-signin` page, the session store and machine, the broker call, the Gitea client and the
    projects page's read of the old Gitea's organizations are gone, and with them the group's Gitea
    state. It mints no `gitea-signin:` throwaway, and its sweep takes back only the `mate-door:`
    ones this browser owes, by the id each mint answered (`zeropsThrowaway.ts`,
    `useZeropsThrowawaySweep.ts`). A Mate's key holds
    no grant on its application's other projects (ADR 0003, see 0.2 below). The copy says _change_,
    never _pull request_, and a change in conflict asks its Mate to merge `main` in and deliver it
    again (`gitTab.ts`, `reviewVerdict.ts`), as HQ takes a Mate's push only forward. Kept by the
    owner's rule: the tool partition (`tools.ts`), and zcp's masking of `GITEA_TOKEN` and
    `isControlPlaneEnv`, while the old token stays on a Mate's container
  - _Built in:_ `7cd89a21a6`; the release path `7418440275`; the sign-in page `bb9fc20db8`; the
    session, the broker, the Gitea client and its state `23762ac9b3`; the keys and the copy
    `04d73b1557`
  - _Proven by:_ `-accountGate.test.ts`, `ZeropsProjectFlowProvider.render.test.tsx` ("opens no Gitea
    session: the flow names no sign-in to Gitea and no Gitea org"), `accountRuntime.test.ts` (the
    post-grant stage holds no forge), `zeropsThrowaway.test.ts`, `doorThrowaway.test.ts`
- **T13** — The migration of an organization that ran the release
  - _State:_ done and removed — read 2026-10-04 before the removal: Mate s.r.o.'s HQ
    recorded 11 imports, all done; KRLS's recorded none; neither held an environment. The one-off code is
    gone: the `import` command and job, `Deploys.hold` and `Deploys.baseline`, the change heads and
    merges of `@t3tools/hq-git` that served it, and its tables (migration `0037`); in zcp, the move of a
    pair off main's Gitea. The rollout cause `import` stays, as rollouts of it are recorded. Gone
    since, with the HQ-answers pass: the one-shot project-tag port (`scripts/project-tag-port.mjs`
    and its HQ route), `@t3tools/hq-git`'s source import, and the Mate name source the port kept
    (migration `0038`)
  - _Built in:_ `1377934c18`, `1659ebf499`, `d3a5672413`, `617c9ff93e`; zcp `9f800923f`,
    `e7965d4d1`, `38c4695c6`; removed since `56d6859a10`, `bf7189f88a`, `b3790cc692`
  - _Proven by:_ `migrations.test.ts` (none of its tables left)
- **TB** — HQ's git backed up, and restored in step with Postgres
  - _State:_ live — on KRLS's `Headquarters`, 2026-10-02 (the ledger's _The HQ rebuild, as
    measured_): `/health` said `backup: ok` 36 s after the build answered, a whole set of five
    repositories in the bucket and on the volume; `hq restore <set> --replace` ran in 8.3 s, HQ down
    2 min 50 s in all, and Core came back active at epoch 14. The leading Core takes a set every
    hour: the database's dump, then a bundle of every repository, the manifest last. It stages the
    newest on the volume and keeps in the bucket the newest set of each hour for a day, of each day
    for 14 days and of each month for 6 months; `/health` tells the newest set's outcome. An HQ born
    before TB gains its bucket by hand
  - _Built in:_ `d5b54a9d4c`, `ec1ae73186`
  - _Proven by:_ `backup.test.ts`, `bucketStore.test.ts`, `restore.test.ts`, `reconcile.test.ts`
- **T14** — The switch
  - _State:_ done — the Mate server and zcp released with HQ, the client on mate.zerops.io, HQ
    mandatory; the live migration ran and its code is gone (T13). What stays of the old system is
    Mate s.r.o.'s Gitea project and the pairs wired to it (§7, 2)

### What carries over from the release

- **0.1** — zcp on a `BASIC_USER` container token
  - _State:_ live
  - _Proven by:_ ledger 2026-09-16 _A `BASIC_USER` project token does everything zcp does_
- **0.2** — Each Mate's key lowered to `NO_ACCESS` + `BASIC_USER` on its own project, and nothing
  more (0.3's read-only reach of its application's other projects is gone, ADR 0003)
  - _State:_ built — a new Mate's key is minted with its own project alone (`api.ts:1819`); its
    harden, when a person finishes setting the Mate up and never on a page's read (step A, A11;
    `hardenMate`), sets it to its own project alone (`planMateKey`): a key found by the id the Mate
    enrolled with HQ (`foundBy: "id"`) loses any other grant; one found by its name alone is the
    Mate's only while it holds its own project alone, and is never narrowed
  - _Built in:_ mate 0.11.0 `04a8468d5`; without the reach `04d73b1557`; own project alone
    `2f75bd226b`
  - _Proven by:_ `groupReach.test.ts`, `newProject.test.ts`,
    `matePress.test.ts` ("writes no other Mate's key")
- **0.4, 0.10** — A new Mate's key on `zcp` and its project closed off before anyone is admitted
  - _State:_ live — the press does it in the foreground before _Add_ returns, and records the
    close-off in HQ (`matePress.ts`, `hqMateBirth.ts`); a Mate whose press stopped before it holds
    no lease's connection until HQ records it, and offers _Finish setup_ (`closeOff.ts`). Only a
    fact holds one — HQ's record, or where HQ says nothing this browser's own stopped press — and
    every hold says why on the Mate's own view
  - _Proven by:_ `matePress.test.ts`, `projectIsolation.test.ts`, `createEnvironment.test.ts`,
    `closeOff.test.ts`, `accountRuntime.test.ts` ("the close-off gate")
- **0.6** — The _Update_ verb's scope
  - _State:_ live
  - _Built in:_ mate 0.11.0 `2ff377304`
- **0.8** — One admission rule at a Mate's door, verbs by role, _Assign_
  - _State:_ live
  - _Built in:_ mate 0.11.0 `949693a1c`, `6f662df6c`
  - _Proven by:_ `mateAccess.test.ts`
- **0.9** — zcp stops handing its key out
  - _State:_ live
  - _Built in:_ zcp v9.176.0 `e36c6352`
  - _Proven by:_ `workflow_build_integration_citoken_test.go`, `deploy_ssh_test.go`

### Historical release backbone (origin facts; replaced by HQ above)

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

### Continuing release features

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
- **4.2, 4.3** — _New project_ and _Add Mate_: a name, a face, a Mate registered at birth
  - _State:_ live — the press writes the Mate's record into HQ; _Add Mate_ reads its tier from HQ's
    recipe and converts it to `startWithoutCode`; since pass 19 _New Mate_ opens over the view on
    screen and lands on the new Mate's own view
  - _Built in:_ mate 0.11.0 `311546d8d`, `b296a0139`; pass 19 `132306274` `26be501e6`; HQ, T5 and
    T10a
  - _Proven by:_ `newProject.test.ts`, `newMate.test.ts`, `recipeTier.test.ts`,
    `recipeTierImport.test.ts`, `ZeropsNewMateForm.test.tsx`
- **4.5** — The Git tab, the project's flow
  - _State:_ live — the Git tab is the Mate's own leg (D26): its checkout, the remote probed live,
    its change as _Review_; the project's flow is the left menu's (Mates, their changes, the stage
    and production chips) and the projects screen's rows, read from HQ for the account; the Git
    page `/git` from the footer
  - _Built in:_ mate 0.11.0 `253c402ca` `9223ddf02` `be946f5b0`; 0.11.16; HQ, T7c and T11
  - _Proven by:_ `gitTab.test.ts`, `projectFlow.test.ts`, `SidebarZeropsTree.test.tsx`,
    `ZeropsGitPanel.test.tsx`, `ZeropsGitPage.test.tsx`
- **—** — The projects page and _New project_ rebuilt from the owner's notes
  - _State:_ live; the design pass **open** (§7)
  - _Built in:_ mate 0.11.2 `68634f145` `e090a363b` `7abefe78f` `938de7167`; 0.11.3 `682ce19ed`
  - _Proven by:_ ledger _A project creation that the platform failed after answering 200_
- **—** — The client state model: fact owners, machines, lifetimes
  - _State:_ superseded by the shipped account data layer in Mate 0.14.26. Its source adapters,
    reducer, keyed store, projections and operations replace the old Zerops runtime, query cells,
    grant driver, duplicate transport and browser-storage remote caches. The remaining presentation
    and source-contract work is D03, D57 and D47, listed in [data-layer.md](data-layer.md).
    [`client-state-model.md`](client-state-model.md#status-by-phase) records the earlier phases.
  - _Built in:_ Mate 0.14.26, following the data-layer waves
  - _Proven by:_ `packages/client-runtime/src/data` tests; hosted scenarios in
    `apps/web/test/scenarios/areas/{a-signin,b-menu,c-mate,d-change,e-env,f-create,g-outage,h-budget}`
- **—** — Pass 16: the left menu — rows, the production chip, crews, the band, search
  - _State:_ **live** at the owner's size on the localhost pair, 2026-09-29: at 435 and 256 px the
    faces at 16 px and every word at 56, rows of 76, 58 and 48 px, 30 px from one Mate's words to
    the next's, the menu's words in four sizes (16, 14, 13 and 12 px). The production chip and its
    menu, the crew line, the selected band and a pressed heading that moves 0 px on every frame are
    measured in the harness. **Open**: a working row's step and a waiting row's question (D5, D6)
    are seen on a Mate only once its server runs this build
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
    conversation never moving (before, the strip came with the forge's answer 8.6 s after a reload
    and moved the conversation 61 px). HQ's answer, not Gitea's, confirms the remembered strip now
    (`changesKnown`)
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
    its place (§7, 19)
  - _Built in:_ mate 0.11.63 (PR #32); the server's worker `dbb52f3eb`
  - _Proven by:_ `composerPictures.test.ts` (shared and web), `imageCompression.test.ts`,
    `ComposerPromptEditor.pictures.test.tsx`, `messagePictures.logic.test.ts`,
    `attachmentFit.test.ts`, `Normalizer.attachments.test.ts`, `ClaudeAdapter.test.ts`; the harness
    `/design-pictures.html`
- **—** — Pass 16: Review, the one door to merge, land, release and roll back (D12)
  - _State:_ **live** — first for a change opened from the composer's top, 2026-09-29, read from
    Gitea then: _Merge_ focused with ⌘↵, Esc closing it and the focus back on what opened it. It
    reads the change from HQ now — its files, diffs and commits in one read, no checks — and a merge
    through it ran on the rig with T8a, HQ refusing one whose head moved (`head_moved`). **Open**: a
    release and a roll back through it, built with T9b, not yet run live; "What it does" (R3) was
    empty for a change whose run never linked it (§7, 19)
  - _Built in:_ mate 0.11.63 (PR #32); HQ, T7c and T8a
  - _Proven by:_ `reviewVerdict.test.ts`, `changeDiff.test.ts`, `changeReadout.test.ts`,
    `ZeropsReview.logic.test.ts`, `ZeropsReviewDoors.test.tsx` "every door opens the review and
    never acts itself (R1)"; the harness `/design-change.html?review=all`
- **—** — Pass 16: a thread's live step and waiting question on its shell (D5, D6)
  - _State:_ built — the Mate server relays a running thread's step and a waiting thread's first
    question on its shell, in memory, with no migration and no push added; replayed through the
    recorded Claude streams. **Open**: a Mate shows them only once its server runs this build, which
    its _Update_ brings with a restart; neither is seen live yet
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
    which version a stage runs). A change has no checks in HQ, so that section is gone. A
    description's pictures are HQ's: zcp attaches them to the Mate's open change, and the review
    reads them as the person (`useProjectedHqPicture.ts`)
  - _Built in:_ mate 0.11.64; HQ, T7a and T7c
  - _Proven by:_ `ZeropsReview.logic.test.ts`, `useZeropsChangeDetail.test.ts`,
    `useZeropsChangeComments.test.ts`, `data/adapters/hqPictures.test.ts`, `data/projections/hqPicture.test.ts`; the harness
    `/design-change.html`
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
    landing the next heading where a fresh layout puts it. The owner kept the tones (§7, 22), and
    pass 19 puts the whole top bar on the logo row's 65 px (below)
  - _Built in:_ mate 0.11.66 (PR #36): `bf1b9b242` `a0c6b27ba` `1a7338f82` `b6e81525e` `198bf63eb`
    `2bdb5edec`
  - _Proven by:_ `SidebarProductionChip.logic.test.ts`, `SidebarProductionChip.test.tsx`,
    `SidebarZeropsTree.test.tsx`, `SidebarProjects.logic.test.ts`, `SidebarChrome.test.tsx`,
    `menuMemory.test.ts`; the harness `/design.html?set=plan`
- **—** — Pass 18: _New Mate_ — a name, a colour, a shape; the face on its project
  - _State:_ **live** on the localhost pair, 2026-09-29, a storefront project in the test org: a
    Mate added from its project's heading through the dialog, its picked colour and shape written at
    birth — then as project tags, now into HQ's record of the Mate — the project and its eleven
    services active about four minutes after _Add_. That first add recoloured four other Mates — the
    pick of a tint another Mate wore by its name pushed that Mate along — fixed in `10816483d` and
    checked live: a pick recolours nobody. In the harness the dialog stands 323 px tall (573
    before), and the recipe arriving moves nothing. **Open**: §7, 22
  - _Built in:_ mate 0.11.66 (PR #36): `07172b671` `46fd986e0` `b73107b47` `4375984ff` `10816483d`
  - _Proven by:_ `groups.test.ts`, `createEnvironment.test.ts`, `mateTints.test.ts` "recolours
    nobody when a new Mate picks a tint another Mate wears", `MateFace.test.tsx`,
    `mateIdentities.test.ts`, `ZeropsNewMateForm.test.tsx`,
    `ZeropsEnvironmentCreationDialog.logic.test.ts`; the harness `/design-newmate.html`
- **—** — Pass 18: the stand-up — a new Mate sets its development up after its person's sign-in
  - _State:_ **live** on the localhost pair, 2026-09-29, the same Mate: its conversation said it
    would stand development up after the sign-in; the owner authorized Claude Code from their own
    window, and "Stand up development of the project." went once, by itself — from the browser that
    had added the Mate then, from the Mate's own server now, once HQ names who asked
    (`ZeropsSetup.ts`); the Mate stood development up in 13 minutes, both dev services healthy — the
    authorization the one thing a person did. The screen in its final words — "… after you authorize
    your agent." over one _Authorize_ per agent, the composer held back — merged just after that
    sign-in and is not yet seen through a run. A send another surface asks for (`requestSend`) was
    cancelled by its own re-render, its words left in the composer (reproduced in a test); it now
    goes out, so the Git tab's and the jump box's asks send at once. **Open**: §7, 22
  - _Built in:_ mate 0.11.66 (PR #36): `b446994f0` `3d8264772` `331593ac7` `2cef5e40d` `f724de157`
  - _Proven by:_ `mateStandUp.test.ts`, `useMateStandUp.test.tsx`,
    `useComposerSendRequests.test.tsx`, `ZeropsMateEmptyState.test.tsx`, `ZeropsSetup.test.ts`,
    `OrchestrationEngine.test.ts` "takes one turn start when two clients send the same command at
    the same moment"; the harness `/design-standup.html`
- **—** — Pass 18: the conversation's line — its switch in motion, a crewless Mate's subject
  - _State:_ built; measured in the harness, 2026-09-29: every frame of a switch on the curve (≤
    0.01 px off) and the band's pieces overlapping 1 px on every frame; an opening name ≥ 8 px
    inside the band and ≥ 14 px clear of the next face; nothing moving before the press or after it;
    no step at a retarget larger than the curve's peak; every animation on the compositor; at rest
    within 2/255 of 0.11.65's pixels. A crewless Mate's subject stood on its line in the live trial.
    **Open**: the switch not yet sampled live, where the conversation renders more before the commit
    than the harness does (§7, 22)
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
    run (§7, 22)
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
    ADMIN, on a Mate only. **Open**: §7, 22
  - _Built in:_ mate 0.11.66 (PR #36): `01a797146` `cade147e4` `3ae17c0c5` `2c0b331d1` `95e0d0b53`
  - _Proven by:_ `mateAccess.test.ts`, `ZeropsDeleteMateDialog.logic.test.ts`,
    `ZeropsDeleteMateDialog.test.tsx`, `deletingMates.test.ts`, `SidebarMateMenu.test.tsx`,
    `SidebarZeropsTree.test.tsx`, `useOpenMate.test.ts`; the harness `/design-delete.html`
- **—** — Pass 19: the top bar stands 65 px beside the menu, one line with its logo row
  - _State:_ built; measured in the harness at 1786 and 1280 px, light and dark, 2026-09-29: the
    logo row, the header and the closed menu's corner mark all 0–65 px, every centre on 32.5 (the
    header's was 26); what stands under the header 13 px lower, a conversation held at its end still
    there; 52 px on a phone and in a desktop window; each top row painted at its final box from the
    first frame. **Open**: §7, 23
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
    verified live (§7, 23)
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
    115 frames, from its birth to its first job. **Open**: §7, 23
  - _Built in:_ mate 0.11.67 (PR #37): `1b3720046` `a1109181b` `1faefc6d6` `95904e2cb` `862a19026`
    `4dd94eaf1`
  - _Proven by:_ `mateComing.test.ts`, `SidebarMateRow.logic.test.ts` (`mateRowReading`),
    `SidebarZeropsTree.test.tsx`, `ZeropsMateEmptyState.test.tsx`, `newMate.test.ts`,
    `ZeropsNewMateForm.test.tsx`, `useOpenMate.test.ts`; the harnesses
    `/design.html?set=coming` and `/design-standup.html?state=coming`
- **—** — Pass 19: _Change face…_, and _New project_'s first Mate with its face
  - _State:_ **live** for _Change face…_ on the same throwaway Mate, 2026-09-29: saved in about 1.5
    s — then into the project's tags, every other kept; into HQ's record of the Mate now
    (`updateMate`) — the face held over a reload. Measured in the
    harness: the dialog 512 × 291 px in every state; over a save, one row geometry and one face
    geometry across 94 frames, the face swapped under the backdrop's veil; the wizard's card 576 ×
    306 px throughout. A face changed on a Mate that wore its name's tint writes `:named`, so nobody
    recolours — in tests, every Mate of a six-Mate account changed in turn. The wizard's first Mate
    not yet made live. **Open**: §7, 23
  - _Built in:_ mate 0.11.67 (PR #37): `49c105cfd` `3e0976bc0` `f2f1882f5` `d6bd47788` `132306274`
    `26be501e6`
  - _Proven by:_ `groups.test.ts`, `mateTints.test.ts`, `structure.test.ts`, `newProject.test.ts`,
    `ZeropsChangeFaceDialog.logic.test.ts`, `ZeropsChangeFaceDialog.test.tsx`,
    `useMateActions.test.tsx`, `ZeropsNewProjectForm.test.tsx`; the harnesses `/design-face.html`
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
    alone under reduced motion. **Open**: §7, 24
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
    any member may stop or pause a running crew (D6). **Open**: §7, 25
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
    §7, 25
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
    **Open**: §7, 25
  - _Built in:_ mate 0.11.69 (PR #39): `e75b3831a` `026ecb572` `d2ad2c4e7`
  - _Proven by:_ `conversation.logic.test.ts`, `ProviderCommandReactor.test.ts`; the harness
    `/design-switch.html`
- **—** — Pass 21: every door opens a Mate's own view while its conversation cannot open
  - _State:_ **live** on the localhost pair, 2026-09-30: Quinn pressed a second after a load opened
    its own view, "Reconnecting…", and handed over to its conversation about 6 s later — before, the
    row's press sent the person to the projects screen, silently (the owner: "it just throws me at
    /zerops page"). Causes proved in tests: the row stood for its project until the project's
    services were read, and a registration its machine held could be released for a record it
    lacked. **Open**: §7, 25
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
    "big space … at the bottom"). **Open**: §7, 25
  - _Built in:_ mate 0.11.69 (PR #39): `240c770ef` `8385fc6bf` `40a435519`
  - _Proven by:_ `MessagesTimeline.test.tsx`, `RunChat.test.tsx`; the harnesses
    `/design-working.html` and `/design-switch.html`
- **—** — Pass 25: the add-Mate run's findings, the one voice, the switch, the stand-up's pace
  - _State:_ released 2026-09-30 (mate 0.11.73, zcp v9.186.0): every item of the run's findings
    board, and the stage and production heading (D′: the release under the project's name); a
    Mate's link speaks with one voice and a reload never shows an empty pane; a return to a
    conversation shows it as it stood; the composer never leaves the screen; the stand-up's card
    shows its builds; zcp stands development up as a graph and answers once it is up
    (`p25/standup`); versions are named for people, by HQ now (`versionNames.ts`); the Mate being
    opened connects first and paints before its socket, once Mates run a server that names the
    snapshot's parameters
  - _Built in:_ `pass-25` (mate), zcp `p25/standup`; the names HQ gives, T8b
  - _Proven by:_ ledger 2026-09-30 _Pass 25 as measured_; `mateVoice.test.ts`,
    `keptTimelines.logic.test.ts`, `standupBar.logic.test.ts`, `versionName.test.ts`,
    `versionNames.test.ts` (HQ), zcp
    `TestStandupAfter_EveryDevHalfStartsAtOnce`, `TestStandup_ReturnsOnceDevelopmentIsUp`
- **—** — Pass 26: the owner's and a colleague's evening on mate.zerops.io
  - _State:_ built 2026-09-30 on `pass-26`, released as mate 0.11.74: the Mate being opened is
    never kept waiting by another; a project someone else makes is read at once (no endless name
    check, no stray "Still reading…"); a stalled read never covers the product; the arrival names
    the subscription; the first ask waits for its signer record — the Mate server's own now, so a
    turn waits only on a sign-in code still being checked (`SIGN_IN_CHECK_WAIT`); a colleague's Mate
    waits on its owner; rows keep their height and show drafts, their run clock looks live, and a
    stop takes a second press; the account speaks from one line at the menu's foot; the run card
    keeps one radius, a calm live line, the whole environment in its stand-up bar, a dock that says
    one true thing and a result with every picture; the release line and its folded tag, and a
    release's changes in its dialog, read from HQ since T9b. A Mate's hand-run git
    reaches HQ through `zcp hq git-credential`. **Open**: §7, 26
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
- **7** — _Set up Mate_
  - _State:_ partial — offered on a dev environment or a declared Mate with no container, to
    whoever may open its Mate, and on an existing plain project to whoever may write its Mate's
    record at HQ (`ZeropsProjectRow.logic.ts`, `plainZeropsProject`); it registers the Mate in HQ
- **7** — zcp's delegated launch and the GitHub `prodCd` track for group Mates
  - _State:_ **open** — `launch_delegation.go` and the build-integration track remain in zcp
- **8** — The vault: an environment's values (its own plus each app's), who reads each, what is
  not live, and the Mate told of the person's changes
  - _State:_ released (0.14.27; the approachable panel after it) — the Vault tab beside a Mate's
    conversation and beside a stage or production page: Values in cards named for what each is
    for, Apps in words, each app's page with what it reads from its deploy config; reads are live
    queries; writes, restarts and edit as text; the composer's
    chips and the `<zerops-update>` note; zcp acts strict (readers-only restarts, a preflight that
    fails an unresolved reference, sensitive values masked in every tool output). Open: who reads a
    value at build (exposed nowhere), the release gate (a release naming what production's vault
    lacks), Logs beside the vault, and `KEY: ${KEY}` resolving on the platform (until then zcp
    renames: `APP_KEY: ${APP_KEY_SECRET}`)
  - _Built in:_ branches `vault/base` (mate) and `vault/strict` (zcp), 2026-10-07
  - _Proven by:_ `vaultReferences.test.ts`, `vault.test.ts`, `vaultChanges.test.ts`,
    `vaultWrite.test.ts`, `projectVariables.test.ts`, `vault.logic.test.ts`,
    `vaultTurnNotes.logic.test.ts`, `vaultGroups.logic.test.ts`, `VaultPanel.test.tsx`; ledger _The vault's platform, measured_;
    a live look on Rhea's and xyz's projects (2026-10-07)

## 6. Decisions behind it

The reasons are [`design-decisions.md`](design-decisions.md)'s and the spec's; this is where each
lands.

- **HQ replaces Gitea and its broker** (the owner, 2026-10-02). One HQ per organization, and the
  product waits for it; the structure, the changes, the recipe, the environments, the deploys and
  the releases are HQ's. The Gitea-era decisions about the broker, its sign-in, its rights loop, its
  Actions and runners — D4, D18, D20–D23, D27 — went with it.
- **The old Gitea stays as it is** (the owner, 2026-10-02): nothing writes to it, and the client
  is to keep it out of the applications (`tools.ts`; not wired today, §1). Mate s.r.o.'s goes once its pairs are rewired and
  each Mate's `GITEA_TOKEN` env is cleaned (§7, 2).
- **HQ answers; the client draws** (the owner, 2026-10-05): what a person may do, where a release
  stands, whether an environment is coming up, whether a Mate exists, whether a stand-up or an
  update still runs — each is its owner's answer, streamed by HQ or read from Zerops, the Mate
  server or zcp; no client clock stands in for one, and a write that cannot be undone is decided
  over roles read for it.
- **A Mate's key reaches its own project and nothing more** (the owner, ADR 0003, 2026-10-02): a
  `READ_ONLY` grant on production reads its unmarked secrets, and grants are writes somebody must
  keep in step; an agent reaches past its project only through HQ, later.
- **HQ is born at the first visit of an owner or an admin**, never adopted: a project is HQ's only
  by the anchor, never by its name or the `mate:hq` tag (`hq/birth.ts`).
- **HQ's address is its project's own domain** — the one the anchor names, Core serving it over
  HTTPS with the platform's certificate.
- **A change is one task.** A Mate's work lands on `main` as one squash, its subject the change's
  title and number; a person merges it from its review, wherever the review is opened, and HQ
  refuses a merge whose head moved since (`head_moved`). The delivery takes `main` in by merge,
  never by rebase, so a second Mate's change stays mergeable after the first lands. HQ keeps one
  open change per Mate and repository.
- **D25 — delivery is the stage deploy**: a deploy onto a wired pair's stage half commits the dev
  half's tree and delivers it, now into the Mate's change in HQ.
- **D24 — an application's Mates share its repositories**: each fetches all of them and pushes only
  to its own change's branch.
- **D26 — the Git tab is the Mate's; the project's flow is the left menu's and the projects
  screen's; the Git page is `/git`**, every application's repositories and the changes open on them.
- **D28 — a release lists what is merged, and a stage is never what it waits on**: HQ's release
  checks `group`'s head and each service's commit on its repository's `main`, and no stage.
- **A recipe change that only adds is Core's to land** (`land_recipe`); one that edits a file waits
  for a person.
- **Whose a login is, is the Mate server's record**, relayed to HQ; **a Mate's birth is HQ's
  record**, and the Mate's own server sends its stand-up, so no browser needs to stay open.
- **D17 — the brief.** The form asks nothing but the name, and nothing is written into a new Mate's
  composer. A Mate made by _Add Mate_ with an agent gets one ask on its person's behalf, "Stand up
  development of the project.", sent by its server once that person has signed an agent in; _New
  project_'s Mate gets none.
- **HQ's project is called `Headquarters`** (`HQ_PROJECT_NAME`), as the Gitea project was.
- **0.5** folded into 3.2: the door takes a throwaway and refuses everything else.

## 7. Open

### The rebuild's

1. **Grants an earlier client left on a Mate's key.** The Gitea release gave each Mate's key
   `READ_ONLY` on its application's other projects, and the rebuild's client did until
   `04d73b1557`. The client adds no such grant now, and a Mate's harden takes any other grant off a
   key HQ knows by the id the Mate enrolled with (`planMateKey`, `2f75bd226b`), or by the id of a
   widened key the Mate named (`keyWider`); a key HQ cannot identify — found only by its name — is
   never narrowed, and its grants are removed by hand.
2. **The pairs the Gitea release's zcp wired to the old Gitea.** zcp's move of such a pair to HQ
   (`38c4695c6`) is removed from zcp. Their checkouts still name Mate s.r.o.'s old Gitea as
   `origin`, which a worktree's preparation fetches (`apps/server/src/ws.ts`), so that project runs
   until each checkout is rewired to HQ and each Mate's `GITEA_TOKEN` env is taken off.
3. **An agent's reach past its own project** comes only through HQ (ADR 0003):
   `zerops_observe` lists permitted stage and production environments, then reads their status,
   active versions and bounded service logs. HQ checks current placement and the people who can
   operate the Mate on every call, then reads with the environment's deploy key. No sibling
   Zerops grant or environment variables reach the agent. See `observation.ts` and the zcp spec
   §10.8; live verification remains part of the release gate.
4. **T13 — the exporter and the rehearsal.** Closed: the migration ran and its code is gone (§5,
   T13).
5. **T14 — the switch.** Closed: HQ is released and mandatory (§5, T14).
6. **An HQ born before TB has no bucket**: the birth's import brings one, and nothing adds it to an
   existing HQ but a hand import into its project.
7. **HQ's own updates are a person's.** Core is deployed at the birth from the build that bore it,
   and `/health` names its `build`; an owner or an admin updates it from HQ's card to the Core their
   client carries (§2, `hq/update.ts`), and nothing brings a newer Core without that press.
8. **The old system's own machinery** in Mate s.r.o.: its broker keeps its passes and the
   `deploy-*` keys of the stages and productions HQ deploys since the import. Whether a pass of the
   old broker would deploy Gitea's commits over HQ's is unmeasured; it ends with the old Gitea
   project (2).
9. **Not yet run live**: a production released and rolled back from HQ (T9a, T9b); _Add Mate_'s
   stand-up from HQ's recipe in the browser (T10); a delivery owed through an HQ outage and
   finished after (T7b); an enrollment HQ no longer knows, renewed by zcp's 10-minute recheck
   (T6a).

### Carried from the release, as last recorded

What the release's runs and passes left open, from the first owner's runs to pass 26 — not
re-checked against passes 27 and later, nor against the rebuild.

10. **The onboarding design pass** — the empty state, the _New project_ form and the first-minutes
    page as one composed flow: the real Mate mark, the sidebar hidden on an empty account, editorial
    type and spacing, one motion moment, verified at 1786 and 1280 in both themes.
11. **Typing while the Mate boots** — the conversation route cannot open without a server
    connection.
12. **A restart the app did not start reads as "not connected"** — a release rollout looks like an
    outage; the platform's service status could name it.
13. **Platform:** `project.create` fails with `internalServerError` after answering `200`, two of
    five creations on 2026-09-16/17 (process ids in the ledger); the client and the drivers read the
    verdict and retry or show it.
14. **The Git tab's row says "no repository yet" until a reload after the agent makes a checkout**
    (Dara's run, 2026-09-17: "its not updated live?"). A row subscribes to the server's VCS status for
    `/var/www/{host}`, loaded once; the turn-end refresh reached the thread's cwd — the workspace
    root, never a repository. Fixed in 0.11.12: a turn's end refreshes every mounted checkout
    (`CheckpointReactor`, `resolveCheckpointTargets`); it reaches a Mate through the release and the
    Mate's next update, not the running Dara. A change made outside a turn still needs the reload.
15. **A refused import says "Zerops request result is uncertain"** — every failure of `import-project`
    is mapped to that sentence (`uncertainCommandError`), so a plain `400` on a bad document (the
    two-name project block of 2026-09-17) reads as a maybe. Fix: keep the platform's words for a
    refusal the platform clearly gave, and "uncertain" for a request whose outcome is unknown. Fixed on `main` (`71fd3a22c`, 2026-09-18): a `400` is the adapter's `rejected`
    kind, not retryable, and reads "Zerops refused the request: …" with the platform's validation
    words — the one kind whose message is forwarded; every other kind keeps its fixed sentence.
16. **A push to `main` with no environment following it fails the service repo's workflow** — zcp's
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
17. **zcp after an expansion** — the recipe was not re-proposed when `zerops.yaml`'s setups changed
    (spec 2.2 "kept current"), and the expansion dropped the pair's Gitea record so `group-recipe`
    refused with "no pair has its Gitea repository yet". The record is kept since zcp `f04dcc77`
    (v9.178.0); re-proposing on a setup change is the hardening person's — and a recipe composed
    before v9.179.1 names the dev half's setup for the group's stage and production (Kai's
    `todo/group` `main`: `zeropsSetup: appdev`, start `zsc noop`); the correction as the bot was
    refused by the session's classifier and waits on the owner (ledger, _The owner's Todo run_).

18. **A signer recorded in another browser is not seen by an open session** — the owner signed
    Claude in from their browser; the audit browser, open on the same Mate, refused the first message
    ("This agent's sign-in was not recorded by Zerops Mate…") until a reload. The client reads the
    signer record from the project's tags it holds, and a tag change does not reach an open session.
19. **The _Add Mate_ creation failed a step after the project on Fen** (2026-09-17) and the panel's
    error text was not read; the token was lowered, so the failure sits in the delegation or the
    isolation step. The consequences (no registration, no hand-off) are fixed; the cause is open.
20. **In a wired Mate zcp still asks the service mode** (dev/stage pair, dev only, simple) although
    the pair is the only answer it takes, and a Mate that adopted the recipe's services suggests
    `launch-production` (Fen, 2026-09-17). zcp's.
21. **A row-menu verb can miss its first click** — _Publish app_ on the stage row did nothing at
    17:57:33Z and published at 17:59:47Z (the audit browser; unmeasured whether a person's click
    can).
22. **From the audit run through the UI** (2026-09-17): the Codex _ACTION REQUIRED_ card stays after
    Claude Code is signed in; the platform's words ("startWithoutCode") leak into rows.
23. **A group built from nothing** (2026-09-18, the ledger's _A group built from nothing_), open for
    the app: a Mate restart can drop the projects page to "Could not load your Zerops projects" and
    pin a renderer at ~106 % CPU; _Update_ installs and then says nothing about the restart its
    version needs; a new Mate opens on a model the account may have no credits for, said only inside
    the conversation; production's public route trails its release by ~2 min. The composer's loop is
    fixed at its cause (`0a3a462f9`) and not re-measured live. **The owner's calls from the run**,
    for the spec: the golden path must not be escapable by wording; a new Mate should fetch and run
    its code itself rather than ask the person to send the bootstrap message; deploying dev to dev
    makes no sense now that git is the code of record; and an empty delivery must never become a
    change, nor keep its first session's title once it holds a later change.
24. **Pass 16's open ends** (2026-09-29; the ledger's _Pass 16 as measured_). Codex keeps its image
    order: its adapter is ported code and takes pictures by path after one text item, so there only
    the labels tie a picture to its place. "What it does" (R3) was empty in a live review of an
    older change, whose run's answers never linked it; a newer run's should, unmeasured. One first
    open scrolled its list 4 px while nothing on screen moved (the content above shrank by the same
    4); the source is unfound. Not built: an approval's words on its waiting row, a long step's time
    in the menu, a release's usual duration, _Start_ on a stopped service in a result; and an ask
    the app sends at once (`requestSend`, from the Git tab or the jump box) still takes an unsent
    draft's place, where a fix request now joins it. Not yet run live: a release and a roll back
    through the review; a real pushed change's result row. Off the type scale still: the seams' and
    messages' times at 12 px where S1 says 13, and three 11 px leftovers (an image's placeholder in
    the person's message, upstream's review-comment card, the legacy tool output). For the owner to
    judge: the plan ring's removal (`cf210626b` brings it back), a plain disc where a Mate's owner
    is unknown, the Merge button's double focus ring, and the kit's measures kept where the mock
    drew less — _Open in Zerops_ padded 9 px for 6, the header's buttons 4 px apart for 2, the
    Mate's name 12 px from its task for 10, the send button 36 px on a phone.
25. **Pass 16's feedback, its open ends** (2026-09-29, mate 0.11.64). The menu: the member list's
    reading is not passed to the menu, so a Mate on a shared project token says "Nobody has signed
    in yet", and a row goes from 58 to 48 px once someone signs in. The crew line: the "JOB V1" chip
    still 10 px capitals, the lane bars as they were, and on a reload the header names the crewmate
    until the crew's feed answers. About twelve kit popovers were not opened live after the height
    fix, and below about 560 px of window the model menu opens beside its trigger. The result's
    tiles are six at 109 × 68 where the plan said about 128 × 80 (five would fit that); a file a
    later run overwrote without looking at it again shows its new contents under the older run.
26. **Pass 16's second round** (2026-09-29, mate 0.11.65): _Forget memory_ has no door in the web
    app since the header's rebuild; a run's pictures from a late first answer may shift the strip
    once in a narrow column.
27. **Pass 18's open ends** (2026-09-29, mate 0.11.66). Not yet seen live: the stand-up as the
    Mate's server sends it, the line's switch, an ask from the Git tab or the jump box sending at
    once, a watched run's fold on a real Mate. Deleting a Mate: after a reload inside the platform's
    window the row reads Deleting… only once the platform says `DELETING`, and until then paints as
    a Mate that opens; a refusal says the adapter's fixed sentence ("Zerops rejected the request
    (forbidden)."), and a timeout's "Zerops command exceeded its deadline." may mean the delete went
    through; when the listing drops the Mate, the rows under it move up in one cut; a Mate that is
    only its name grows a line as it turns Deleting…; while only this tab knows, the projects
    screen's card still opens it and the jump box still lists it. The owner's answers (2026-09-29:
    "just use your recommendation"): the chips' tones stay as built — amber for a release that
    failed while the old one serves, the hollow ring for a production stopped on purpose, nothing
    while a release runs; a project with no recipe still gets an empty Mate. Still for the owner to
    judge: a Mate row's band on the list's 9 and 8 px where a heading's stands 10 from either side;
    the dialog's title at the kit's 20 px.
28. **Pass 19's open ends** (2026-09-29, mate 0.11.67). Not yet seen live: _New project_'s first
    Mate with its face, a colleague's client taking a changed face, and _Change face…_ on a Mate
    that wore its name's tint (`:named`). Still open: a colleague opening a new Mate's view sees its
    coming words, then the question; the birth line under the view's headline keeps its 12 px words
    and 11 px time; j and k skip a row drawn from a birth alone, in its first second; older clients
    read `:named` as a plain pick, so the others' name tints can shift on them until they update;
    deleting a Mate that wore its name's tint still reshuffles the others'; a row's face swaps under
    the fading backdrop with no cross-fade of its own, and _Rename_, _Hand over…_, _Move to
    project…_ and _Delete_ still vanish in one frame; the wizard's proposed name, read once at
    mount, can collide with a name not yet read and be refused on press. The session fix is not
    verified live, and a tab already open keeps the old code until it is reloaded. A visible
    conversation still shows one quiet "Reconnecting to …" at a session's day boundary: hiding it
    takes a re-exchange minutes ahead with a socket handover, which reverses spec-mate §3.3's "the
    client does not renew" (MB-3) and waits on the owner. The top bar: the closed menu's corner mark
    is still 20.3 × 24 px where the open mark is 28 × 33; the bare `ZeropsHostedFrame` bar, outside
    the menu, grows to 65 with the token; the route gate's floating notice centres at about 31
    against the bar's 32.5; the stand-up harness still draws its own 52 px header.
29. **Pass 20's open ends** (2026-09-30, mate 0.11.68). Not yet run live: a plan's _Start_, _Keep
    going…_ after a limit, an _Answer_ in a row, _Let Fen suggest a crew_, a piece of work added to
    Fen's code and shipped from _In Fen's code_. Kept where the board drew otherwise: the kit's look
    — the dialog's title at 20 px, its surface the kit's popover, the kit's radios and checkboxes,
    the radio group's 12 px gap for the board's 10 — and the run dialog as the kit's modal in the
    middle of the window; times in the left menu's formats ("1d", "40m", "2:02 working") where the
    board wrote "yesterday" and "40 m"; a working row's third line in the card's own words. On touch
    a row's ··· shows only on hover. Older builds pair: an older client shows the new stop words as
    "Backend's task #12 stopped mid-way: when the $20 ran out", and an older server sends no
    `landedAt`, so its _In Fen's code_ rows carry no time.
30. **Pass 21's open ends** (2026-09-30, mate 0.11.69). Mixed-login crews are closed per login in
    tests only; the closed composer slot was not measured at phone width. A crewmate's empty state
    wraps its whose line at 1280 with the panel open (a 305 px column). The run's opener rule leaves
    one narrow case: a Stop before the first thought and a resend within 60 s with no notice
    between; a start stuck behind `WorkspaceHistory.prepare`'s shared lock has no timeout; a restart
    settles a cut-off run as `error`, which the menu says as failed. A stopped Mate's view offers
    the projects screen rather than Start. A result's pictures whose files are gone still draw as
    "Gone" tiles. The lone card's corners jump 20 → 34 if a bar arrives beside a card that holds
    only its line; a result band that ends up empty still draws an empty middle slice; reduced
    motion was checked in code, not in a browser. **The add-Mate flow**, recorded on Beviro the same
    day (26 min 9 s from _Add_ to development up, the person needed at 0:00 and 3:07, the stand-up
    16 min of a model improvising a procedure zcp knows), was the input of pass 25.
31. **Pass 26's open ends** (2026-09-30, mate 0.11.74): zcp to fold a process's `error` into its
    import result and to relay a dev server's state live; dev artefacts' 2–4 min uploads.

## 8. Working on it

- **Run it on localhost.** The root `dev` script starts the pair — server 13773 and web 5733 in the
  main checkout, a worktree on ports derived from its path (`scripts/dev-runner.ts`). A localhost
  client reaches an organization's HQ only if that HQ was born from it (§7, 8).
- **The rig.** KRLS's `mate-rig-*` projects: the web from a branch on localhost or from `main` on
  mate.zerops.io, dev builds of zcp and the Mate server pushed into a Mate. Only `mate-rig-*` projects; a stage or a
  token a run makes is deleted after it, and a credential never reaches a transcript.
- **HQ Core.** Built with the web app (`apps/hq/scripts/pack-core.ts`) and deployed by an HQ's birth
  or update with `apps/hq/zerops.yml`, setup `hq`, as app version `hq-core.<identity>`. The identity
  is `<commit UTC>.<sha256 of the deployed bundle and zerops.yml, first 12 hex>`
  (`apps/hq/src/coreIdentity.ts`): `/health`'s `build` and `hq-core/build.json`. A Core of the same
  digest is never offered, whatever its commit; the digest holds only while `vp pack` is
  byte-deterministic across machines (another Node or bundler build would offer the same Core). Its contract tests run against the real API with
  `HQ_ZEROPS_CONTRACT=1` and an org Read only token read from a file.
- **Release.** Fork: bump the three `package.json` versions, tag `vX.Y.Z` on `main`; the workflow
  publishes the tarball, `SHA256SUMS` and `stable.json`; zcp installs the latest release's
  `stable.json` at the next boot or `zcp mate update`, no pin. The hosted app at mate.zerops.io
  rebuilds from a push to `main` by itself (the root `zerops.yml`, setup `prod`); it does not wait
  for the tag. zcp: its own release ritual.
- **Live checks.** Resources tagged `probe:<topic>-<date>`, listed, deleted, counts diffed;
  credentials from the environment only. Read sensitive service variables with an integration token:
  a person's session reads `REDACTED`.
- **Where to write.** Follow `CLAUDE.md`'s “What a doc may hold”. General rules → the design guide;
  domain terms → one domain document; the zcp↔mate seam → the spec §2.8. Behaviour → a test whose
  title is the product sentence; appearance → code; reasons and reversals → the commit message,
  never the decision log. Platform facts our code relies on → a comment beside that code or a short
  ledger entry with its verification command, one writer. Transient work stays local.

41. **A deploy job that fails before it reaches the broker is invisible** (run 5, 2026-10-02).
    Closed in pass 35 (mate 0.11.88), measured in run 6 (the menu and the cell said it on the first
    status read that carried the failure, 21 s after the job failed): while a declared stage runs
    nothing, the group's deploy reader reads `main`'s head and its statuses — the broker's `failed: …`
    report, or the deploy workflow's own failure whenever posted, until the broker says `deploying` —
    and the menu says "Stage didn't come up · its first deploy failed", the cell "First deploy
    failed" (design decisions, 2026-10-03). Superseded 2026-10-05: the broker and its statuses are
    gone; a first deploy fails by its owner's word — HQ's job, or the build's Zerops process (§5,
    T8b).
42. **zcp's workflow template leaves the runner's runtime to the Mate** (run 5). Closed in zcp
    v9.189.0: the workflow sets Node.js, Go or Java up at the dev half's version before the Test
    step; Bun, Deno, Python and PHP get a comment naming what works on the runner (it has no `unzip`
    and no hosted tool cache); a file still exactly zcp's old template is brought up to it, and a
    file a project touched is left as it is; measured for Node.js in run 6 (`actions/setup-node@v4`,
    node 24, before Test). Moot since HQ: no workflow or runner deploys.
43. **Two short blips in a stage's first deploy** (run 5). Closed in pass 35, measured in run 6 (no
    step back at the build's end; the import before the runner on the menu and the card): a build's end holds "deploying" until its version is known or the 20 s grace ends, the
    grace's timer kept through a re-check of the listing; the stage's own import comes before the
    first deploy and the runner on every surface ("Setting up a stage…"). Superseded 2026-10-05: the
    20 s grace is gone; a build's end is its job's or its process's word (§5, T8b).
44. **A tainted runner's replacement may register with the org's same token.** Partly closed in
    gitea-mate#8: Gitea 1.27.2's API returns the org's latest active token and only its web UI
    resets one, so every runner import first deletes every runner registration in the group's org,
    which removes the tainted container's own credential and anything registered before the import.
    Moot since HQ: no runner is registered.
45. **Idle cost grows with the account's orgs** (run 6, 2026-10-03): 22.2 and 20.3 requests a minute
    per window against run 5's 16–18, 13.4 of them each Gitea org's repository list once a minute.
    Closed in pass 37 (one id-ordered listing of the person's repositories a tick feeds every
    group; 14 groups idle: 14 requests a minute → 1), unmeasured live until run 7. Moot since HQ:
    the client lists no Gitea; changes arrive on HQ's stream.
46. **A coming-up Mate wears the asleep face** (run 6): `mateComingRowView` makes it the coming pose
    in every window, and the coming-up page shows the same closed eyes; runs 5 and 6 expected none.
    Closed in pass 37 (the owner left it to the lead): a Mate arriving wears `waking`, closed eyes
    that breathe, for at most 30 minutes from its creation; unmeasured live until run 7.
47. **Two screens for one coming-up** (the owner, run 6): the "Setting up …" dialog (the steps the
    browser runs with the person's session, "keep this open") and the coming-up page behind it.
    Closed in pass 37: the press lands on the coming-up page, the browser's steps as the first
    row's sub-steps; unmeasured live until run 7.
48. **Pass 36's open ends** (mate 0.11.89). Mobile's feed reads the conversation's follow rule
    (`thread-feed-live-follow.ts`), unmeasured on a device: a simulator look before the next mobile
    build. A settled deploy older than the project's last 100 processes shows only what its call
    returned. A running build's reserved log room stands empty (about 60 px) until its first line.
49. **Pass 36's live look** (mate 0.11.89, 2026-10-03). A running build's log streamed nothing: its
    stream was asked with a time as `from` (closed in pass 37, asked as the GUI asks; unmeasured live
    until run 7). Open: at a turn's end the line a person reads above moved up 53 px once while the
    list's scroll held (something above it shrank; the "New since" divider is the guess); the menu
    harness repaints about 190 times a second with every face still.
