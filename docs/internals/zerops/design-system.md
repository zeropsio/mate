# Design guide

Shared principles and words for every client surface. Domain meanings live in [the primer](primer.md).

## 1. Shared principles

- Content does not move by itself. Transient state stays in a fixed frame.
- A list has an explicit order. Background arrivals do not rearrange the order the person chose.
- Related words share a text edge; related actions share an end edge.
- Say a state once in a row. Its mark and words belong together.
- A problem gives its cause and the action that can fix it. Do not offer an action the source refused.
- An action's label says what it opens or changes. A different decision needs a separate press.
- A command's label, tooltip, menu wording and accessible name describe the same action on the
  same object. Icon-only controls retain that meaning. Completed feedback keeps the same target.
- Wording may differ across platforms when the meaning agrees. Contextual labels are sufficient
  when the target is unambiguous. Clipboard transport and error reporting are separate concerns.
- Condensed text never quotes credentials.
- Only new arrivals animate. Opening or restoring content places it.
- A view opens or changes place when the person asks; background work does not choose it.
- Resolve a view's destination before painting it.
- Name a Mate's own state in third person; address the person directly for other facts.
- Give a reset time only from source evidence. Promise automatic continuation only while enabled.
  A passed clock time does not prove work resumed.

## 2. Copy glossary

Use short declarative sentences and second person; "developer-first" is the self-description. No hype. These are user-facing words;
identifiers, comments and test titles keep their code names. `t3code/no-legacy-vocabulary` (R4) fails a retired word in
user-facing copy and quotes its replacement; `packages/shared/src/legacyVocabulary.ts` holds the enforced list.

One word for each thing:

- **HQ** — the shared headquarters app, with one tenant per organization. Organizations do not create an HQ project.
  hq.zerops.io (billing, top-ups, tokens) is HQ too. Copy never says "Zerops" as a place: the
  products are Platform (app.zerops.io), Box, Mate and HQ.
- **project** — what the menu lists. Source words: environment (a server connection), application, an HQ application.
  A Zerops project beside an application is called by its name. A Zerops-level part of a project is never a project:
  it is Stage, Production or a Mate's workspace.
- **Mate** — a colleague, always by name; the organization-wide one is the Chief. "A Mate is a coding agent with a
  workspace of its own and one conversation you come back to." Never "the agent" for a Mate.
- **coding agent** — Claude, Codex and the others, only where a Mate is signed in. Source: provider, agent. Say
  "Sign {Mate} in with Claude or ChatGPT", or "Sign this Mate in"; never "Sign in an agent".
- **helpers** — a Mate's own sub-agents; on a crew they are crewmates.
- **persona** — how a Mate works and talks in every chat: a name and instructions its coding agents follow.
  It starts from a template, **from Zerops** or **{organization}'s**, or is written by hand.
- **workspace** — a Mate's own place to build (the engine's dev service, `appdev`); its private address is
  **{Mate}'s preview** (the stage half of a dev/stage pair, `appstage`). Engine service names never stand as copy.
- **Stage**, **Production** — the project's shared environments; "environment" is only their collective word.
- **sign in**, **signed in**, **sign out** — never log in, logged in or log out.
- **change** — never pull request or PR. Name a change by its title rather than its number. A merged change is
  **merged**, never landed. Its merge says **Adds this change to main**; squash and commit counts stay in the
  Commits fold.
- **PR #n** — only for the GitHub pull request a change is mirrored to, linked to it ("PR #2 on GitHub"); Mate's
  own object stays a **change**.
- **release** — "Putting {version} live", "{service} gets {version}". No commit hash names a release.
  In the Git browser a commit's 7-character id may stand beside its subject, as a link, never alone.
- **didn't go out**, **didn't go live** — a release that did not go through, said with HQ's own words for why
  (the platform's build message, HQ's refusal, its rollout's note, a service it left out) on every surface that
  says it; **Deploy status unknown** only where HQ itself could not tell how the deploy ended. Every surface reads
  one verdict, `releaseFailure` in client-runtime's `zerops/releaseFacts.ts`.
- **key was refused**, **HQ doesn't accept the key**, **HQ couldn't check the key** — HQ's word on a Mate's key,
  told to the people in the Mate over its conversation with what its owner can do and, for a refusal, when the
  Mate asks HQ again (a refusal is not redialled on a timer of seconds), until the key works again.
  Zerops is named as the one that did not answer only where HQ says so; its `1011` at admission does not.
  Every surface reads one verdict, the Mate server's `hqKeyOf` (`ServerConfig.hqKey`).
- **planning** — HQ deciding which deploys a merge or release asks for. Until HQ has, a surface says **Waiting for
  planning**, never that nothing will deploy. Source words: rollout, plan lock.
- **setup**, **setup files** — never recipe or import files.
- **Code kept**, **Setup kept** — a project's code or only its setup remains when nothing is placed;
  **Keep its code?**, **Keep code**, **Delete code…** ask about it. Never "Kept Git" or "Keep its Git?".
- **No access** — a project HQ does not list for this person, explained under it as **Deleted or access removed**.
  HQ never says which of the two it was, so no surface does.
- **Read access**, **Full access** — sentence case, each explained once where it is chosen.
- **Owner**, **Admin**, **Developer**, **Guest** — the roles, as the invite names them; the menu's foot says
  "{organization} · {role}" for every role. A Zerops role no preset names reads by what it reaches (**Works on every
  project**, **Sees every project**); a Zerops role code appears only where a Zerops role itself is chosen.
- **Invited — accept from the Zerops email** — an organization whose Zerops invitation the account has not
  accepted: listed with the organizations, never chosen, because only the email's link accepts it.
- **Put it on your domain** — the first own domain, everywhere it is offered; **Manage addresses** once
  there is one.
- **page** — what the side panel opens; never surface.
- **Zerops Control Plane** — never zcp.

Source words and the product words that replace them:

- pull request, PR → **change**
- rebase → **merge main into it**
- provider → **coding agent**
- pairing → **Sign in with Zerops**
- Connections → **Devices**
- worktree, Local checkout, lane → **its own copy of {Mate}'s code**
- T3 Connect, Tailscale, T3 Code → **omit**
- Open in editor → **Cloud IDE**
- zcp → **Zerops Control Plane**
- project-level variables → **Shared vault**, "accessible to every app"; an app's own → **{app} vault**, "only {app} can read";
  the apps' own vaults together, under the shared one → **Each app's own**; the variables of a Mate's own computer →
  **{Mate}'s vault**, "only {Mate} can read", a name never said of Shared or of an app's vault
- environment variables, Plain / Sensitive → **vault values**; sensitive: **hidden**
- control plane (product name) → **Zerops Mate**
- stage half of a dev/stage pair, appstage → **{Mate}'s preview**
- dev service, appdev → **{Mate}'s workspace**
- deploying a crewmate's work → **Deploy to {host}**
- group stage project → **Stage**
- a Mate's recipe proposal, recipe, import files → **setup files**
- agent on a crew → **crewmate**
- orchestrator → **lead**
- crew intent, brief → **goal**
- crewmate intent, role → **job**
- assignment → **task**
- conversation tab, thread → **chat**
- land a crewmate's work → **add to {Mate}'s code; in {Mate}'s code**
- landed (a change) → **merged**
- squash-merge → **Adds this change to main**
- your tree → **{Mate}'s code**
- deliver → **ship**
- crew run → **working on its own**
- budget → **what it may spend**
- Start fresh → **Clear its conversation**
- Discard → **Drop it; Drop the plan**
- Allow → **Let it; Not now**
- Back to my tree → **Back to {Mate}'s**
- parked → **Stopped**
- writer, reader, lead → **Builds, Reviews, Plans**
- backup set, backup store → **backup, backup bucket**
- git repositories → **repositories**
- environment deploy token, token-encryption key → **deploy tokens, key for its deploy tokens**
- connected presence → **online**
- degraded → **Needs attention**
- healthy → **Running**
- log in, logged in, log out → **sign in, signed in, sign out**
- Sign in an agent → **Sign {Mate} in**
- Basic user, Read only (an organization's role) → **Works on every project**, **Sees every project**; at least
  Basic user access (a project's) → **Edit**; Member → the role's own name
- surface → **page**
- Add your domain → **Put it on your domain**
- Set custom accesses → **Choose projects**; Advanced (a role's Zerops settings) → **Fine-tune permissions**
- container (a Mate's) → **its computer**

## 3. Visual grammar

Use tint to show depth. Blue acts; teal identifies. Palette and contrast come from shared tokens.
A status mark carries its word or an accessible name. Use scalable vector icons rather than an icon
font. Clients share meaning and copy while using their native containers.
Nested rounded edges run parallel: the outer radius is the inner radius plus the space between them.

- One scale, from `packages/shared/src/brand.ts` and projected into the web theme: twelve type steps
  and no others (`text-caption`, `text-body`, `text-emphasis`, `text-title`, `text-display`; `text-2xs`
  to `text-5xs` for dense metadata and icon badges; `text-line` and `text-prose`, the conversation's
  quiet voice and prose; `text-typed`, a phone's field at 16 px), spacing on a 4 px
  grid with 2 px half-steps (a value moving onto it moves up: room over squeezing), four nested radii (`rounded-mark` for a key, a checkbox or a swatch, inside `rounded-control`
  inside `rounded-card` inside `rounded-sheet`; `rounded-full` only for a pill or a circle), three
  durations (`--duration-quick`, `--duration-base`, `--duration-slow`) with `ease-out-strong` for
  what arrives and `ease-in-out-strong` for a paired enter and leave.
- An action is a `Button`: `primary` for the one next step, `secondary` beside it, `ghost` for
  quiet tools, `sidebar` for the menu's own presses on its ground, `destructive` only for what deletes, stops or acts on Production, `link` inside
  text. Buttons are rectangles, except `shape="round"`: the round icon press (the composer's send)
  and the pill press (a quiet choice under a name, like Shuffle). A word that acts inside a sentence
  is `InlineButton`; a name that opens what it names is its `plain` tone. A list's row is `Row`,
  `xs` for a tree or a dense list.
- A hairline that parts things inside one surface is drawn in one ink, the rule (`--color-rule`),
  quieter than the surface's own edge. Like things in one column are parted by their `List`, which
  draws the rules (full, or inset to the words); two different parts, or groups on one line, by a
  `Separator`; a break in a sequence (a day, an "or") by a `Separator` with its words.
- Words are named by what they are, with `Text`: a `headline`, a `heading`, a `label`, a
  `description`, a `remark`, a `note`, a `meta` fact, an `error`, a `code` literal. The variant
  fixes the step, the ink and the weight; a kit piece that draws its own words (a row, a section
  label, a page header, an empty place, a field, a failure) keeps them.
- What is wrong is said in one red ink, `status-failed-text`: a value's error, a refusal, a failed
  count, a failed step's mark. `destructive` and its foreground are a press's that deletes, stops or
  acts on Production, never the words of something wrong.
- Who or what a thing is stands before its name: a person is a `PersonAvatar` (`nobody` for the
  seat no person holds, `PersonAvatarStack` for who has access), a Mate its `MateFace`, anything
  else a `LogoTile` (a logo, an organization's letter, a kind of thing's icon), each at the size of
  the row it leads. An icon in a kit slot (a `Row`'s lead, a `Button`, a `Badge`, a menu item) takes
  the slot's size, and in a row's lead the muted ink unless its ink means something; it names no
  size of its own.
- A box is the kit's: a `Card` form (`flat` on a page, `inset` set into another surface, `well`
  for the working area set into a tray or a page, `wash` for the one thing that stands out by what
  it is, `slot` for a place not yet filled, `sheet` alone among its kind), its `tone` the state of
  what it holds; a message in a conversation is a `MessageBubble` in its speaker's form; a picture
  or a page shown is in a `PictureFrame`; machine text another renderer draws stands in a
  `CodeFrame`; presses standing over what they act on sit on a `Toolbar`; a label beside its value
  is a `Fact` in `Facts`. A row's lit or picked ground is drawn by its state (`data-*`), never by a
  class branch.
- A message is written in a `ComposerFrame`: the composer's ground, edge and lift, `sheet` at a
  page's foot, `card` inside a panel, `locked` where nothing can be written now. The conversation's
  composer is drawn in the same look by its shell, which joins it to its drawers and strip.

- A page stands in `Page`: its width by what it holds (`column`, `page`, `wide`, `full`), the
  frame's gutter and top, its blocks 48 px apart. `PageHeader` heads it, its trail above the title;
  a section's heading is `SectionHeader`, in the foreground on a page's ground and quiet
  (`size="panel"`) over a group inside a card, a panel or the menu; a panel's or a pane's top strip
  is `PanelBar`.
- A label is a `Badge` pill in one of five tones (`neutral`, `info`, `success`, `warning`,
  `danger`), so it never reads as a press; `danger` also names Production. A status before its
  words is its `dot` form; a number is its `count` form, beside a title or on a control's corner.
  A state mark with no words of its own (a line's mark, something new on an icon's corner) is a
  `Dot` in the same tones.

- A quantity is drawn by the kit: one amount against its limit is a `Meter`, a whole split into
  parts a `ShareBar`, and a chart's legend, hover readout, time axis and plot ground are its chart
  pieces (`components/ui/chart.tsx`). A series takes its colour from a token: `--color-series-1` to
  `-8` in that order, a coding agent's `--color-agent-*`, spend's `--color-spend-*`; the words
  beside it stay in the ink of words.

## 4. Asks

An ask is one thing a Mate needs from a person: approve a prepared change, provide a value only
they have, connect a sign-in, reveal what the agent cannot see, or choose. A composite ask is
numbered steps of these. Every ask is the same card, in two densities.

- **Anatomy**, top to bottom: where it acts (This Mate, Stage, Production, Project or
  Organization, then the service), a title that is a verb and its subject and says what the main
  press does, the Mate's why in its own words, the body, then the footer. Production is the only
  red: its chip and its main press.
- **States**: waiting (the main press and Not now), working (the press as a present participle),
  done (the real result and who), Not now (who and when), failed (the source's own sentence and
  the press that retries), someone else's (who can answer, by name, and a press to ask them),
  replaced (what took its place). Each kind maps its source onto these; no other state words.
- **Truth lives at the source**: every state is read from where the setting lives (the vault,
  the engine's request record, HQ's decision record, the MCP list). A card remembers only a press
  under way and its refusal, never an answer.
- **Words**: the second press is always "Not now", never Decline or Dismiss. A hidden value is
  "hidden" and "Keep hidden", never "secret". A title never says what the Mate needs or wants.
- **Placement**: the full card stands in the conversation where it was asked. While the Mate's
  turn has stopped on it, the same ask also stands above the composer, compact, with "Show in
  conversation".
- **Secrets go card to store**: a value travels from the card to where it is stored, as the
  person. It never enters the agent's context, the conversation, logs, telemetry or a tool
  result; cards show names, masks and facts. The Mate hears outcomes, including Not now, never
  values.
- **A revealed value** stands only on the person's screen, read with their access, and hides
  after 30 seconds or when they leave; it is recorded at HQ (who, which key, when) before it shows,
  and the Mate hears nothing of it.
- **Authority**: anyone in the conversation sees the ask; only someone with the authority acts,
  and the card names who can.

## 5. Rules — machine-checked

- **R1** — `client-runtime/src/zerops/**` is UI-free and platform-free
  - _Enforced by:_ `t3code/zerops-runtime-zones` (import prefixes, layer direction, account constructor ownership) +
    `t3code/no-platform-globals` (resolved globals)
- **R2** — Protected roots render only
  - _Enforced by:_ `t3code/protected-roots-render-only` (module-graph walk over the protected roots + explicit `WS_METHODS`
    read/allowed-command sets)
- **R3** — Tokens only
  - _Enforced by:_ `t3code/no-theme-escape-hatches` (semantic sinks) + `scripts/check-css-tokens.ts`
    (parser over declarations)
- **R4** — No legacy vocabulary in user-facing copy
  - _Enforced by:_ `t3code/no-legacy-vocabulary` (closed sink list, word boundaries)
- **R5** — One status resolver, one phrase producer
  - _Enforced by:_ `packages/shared/src/threadStatus.ts` + the vector test + `t3code/web-never-derives`
    (the named consumers import a shared status module and hold no local status phrase)
  - _Test(s):_ `packages/shared/src/shared.unit.test.ts` (the one-resolver sentence: every vector
    through the resolver and the relay's awareness phase)
- **R6** — No continuous repaint
  - _Enforced by:_ `scripts/check-css-motion.ts` (`animation`/`animation-iteration-count` with
    `infinite` ⇒ stepped helper or exception) + `t3code/no-infinite-motion` (`withRepeat(-1)`
    resolved to its import; `Spinner` by binding in the protected roots)
- **R7** — The theme is complete and legible
  - _Enforced by:_ a `packages/shared` test over `ZEROPS_THEME` × `THEME_COLOR_ROLES`
  - _Test(s):_ `packages/shared/src/shared.unit.test.ts` (the theme sentence: exact key equality both
    appearances; alpha 1; the named contrast pairs)
- **R8** — Generated copies are current
  - _Enforced by:_ `scripts/generate-theme-tokens.ts --check` in CI's `Check Guards` job
- **R9** — UI kit exports are used, not restyled
  - _Enforced by:_ `t3code/no-restyle` — `@shadcn/lint`'s no-restyle run as a fork guard through
    `oxlint-plugin-t3code/shadcnGuard.ts` (a `CollapsibleTrigger` is exempt); its ledger is reconciled by
    `scripts/check-guard-exceptions.ts` at every landing and in CI's `Check Guards` job
- **R10** — Class names are known and static
  - _Enforced by:_ `t3code/no-unknown-classes` + `t3code/require-static-classes` — `@shadcn/lint`
    against `apps/web/src/index.css` and its imports; both ledgers are reconciled the same way
- **R11** — Scale values, not arbitrary ones
  - _Enforced by:_ `t3code/no-arbitrary-values` (Tailwind arbitrary values where the theme has a
    token: `text-2xs`/`text-3xs`, `ease-drawer`, the gutters); its ledger is reconciled the same
    way; hand-written CSS sizes, corners and transition lengths between the scale's steps are held
    to a budget that only shrinks (`scripts/check-css-tokens.ts`)

- **R12** — Presses, links and fields are the kit's
  - _Enforced by:_ `t3code/no-raw-controls` (a `<button>`, `<a>`, `<input>`, `<textarea>` or `<select>`
    in the web client outside `components/ui`, the kit and the design harness, also one handed to a
    `render` prop that carries its own `className`); its ledger only shrinks

- **R13** — A surface draws with the kit and utilities, not a stylesheet
  - _Enforced by:_ `scripts/check-css-tokens.ts` (`WEB_STYLESHEETS`: the foundation, tokens, base,
    document, rendered markdown, fonts, the boot frame's geometry, the Mate face's drawing and the
    few rules no utility can say; a list that only shrinks); a surface's keyframes go in
    `apps/web/src/styles/motion-*.css`, which holds `@keyframes` only

- **R14** — Words in a `Text` variant's look are `Text`
  - _Enforced by:_ `t3code/prefer-text` (a plain element whose class string is exactly one variant's
    step, ink and weight, beside only what `Text` takes in `className`); its ledger only shrinks

- **R15** — An icon in a kit slot takes the slot's size
  - _Enforced by:_ `t3code/no-sized-slot-icon` (a lucide icon with a `size-*` class as a `Row`'s
    `lead` or directly inside a `Button`, `InlineButton`, `Badge` or menu item); its ledger only
    shrinks

- **R16** — A pressable item lights on `bg-item-hover` (a disclosure stays lit while open) and
  the one its list shows stands on `bg-item-picked`; a chosen value says itself in its own mark
  (`RadioRow`, `RadioCard`, a check box), never in a ground
  - _Enforced by:_ `t3code/prefer-item-grounds` (a theme ground or a step of the ink behind a
    `hover` variant, in a class string with no resting ground of its own); its ledger only shrinks

- **R17** — A failure is said in one form: an action's refusal is `Failure size="line"` (what
  failed, why, its one action, the source's words under Details), a value's error is `Text
  variant="error"`, a place that failed is `Failure`; a notice across a panel's edge is `Alert
  surface="band"`
  - _Enforced by:_ `t3code/prefer-failure` (a plain element whose class string is a failure's ink
    with a type step or an alert/status role, beside only its place); its ledger only shrinks

- **R18** — Machine text is the kit's: a block is `CodeBlock`, arriving lines `LogView`, one value to
  copy `CopyLine`, a change's size `DiffStat`
  - _Enforced by:_ `t3code/prefer-code-block` (a `<pre>` in the web client outside `components/ui`,
    the kit and the design harness); its ledger only shrinks

- **R19** — What floats is the kit's: a popup tied to a press or a point is `Popover`, `Tooltip` or
  `Menu` (a point is a virtual `anchor`), a layer over a surface is `Overlay`, a press over
  scrolling content is `FloatingAction`
  - _Enforced by:_ `t3code/no-hand-popup` (a plain element that is `fixed` or `absolute`, stacked
    with `z-*`, on a popup's ground: `bg-popover`, `dropdown-glass` or `shadow-popup`); its ledger
    only shrinks

- **R20** — A box is a kit piece: a `Card` form, a `ComposerFrame`, a `PictureFrame`, a
  `CodeFrame`, a `Toolbar`, a `MessageBubble`
  - _Enforced by:_ `t3code/no-hand-drawn-box` (a plain element whose class string holds, at rest, a
    box's radius and a ground); its ledger holds only drawings of their own, and only shrinks

- **R21** — A dot is a `Dot`, a count is a `Badge` count
  - _Enforced by:_ `t3code/prefer-marks` (a plain element that always draws `rounded-full` with a
    fill and a dot's size, 4 to 10 px, or with even figures in a dense step and a height); its
    ledger only shrinks

- **R22** — Dividers are a `List`'s or a `Separator`
  - _Enforced by:_ `t3code/no-hand-drawn-rules` (on a plain element in the web client: `divide-y`
    without `divide-x`, an item ruling itself by its place (`border-t first:border-t-0`, a
    `not-first:before:h-px` hairline), an unpositioned one-pixel element in the border's or the
    rule's ink, an empty element that only draws a rule); its ledger only shrinks

- **R23** — A quantity drawn as a shape is the kit's
  - _Enforced by:_ `t3code/prefer-meter` (a plain element whose inline style sizes a fill from data,
    a width in percent or a scale or slide along x, on a ground; or paints a small round swatch from
    data: `Meter`, `ShareBar`, `SeriesSwatch`); its ledger only shrinks

- **R24** — A page's title is its `PageHeader`'s
  - _Enforced by:_ `t3code/page-title-is-page-header` (an `<h1>` outside the kit, written or passed
    as a `render`); its ledger holds the heroes and bars that are not a page's head, and only shrinks

## 6. Exceptions

A guard exception names one finding, its owner, reason and expiry. Review a changed finding again;
remove a dead or expired exception. A permanent exception needs a reason why the finding is correct.
The machine ledgers own the entries and fingerprints; do not copy their counts into documentation.

## 7. Building with the kit

The kit is the web client's component library (`apps/web/src/components/ui`) and its workbench at
`/kit`, served by every dev server, preview and production build.

- Before drawing anything, find the piece that does the job. `/kit` groups the components by what
  they are for, and each page shows its forms, a playground and its import line. Read the
  component's doc comment before deciding nothing fits.
- A surface composes kit pieces and lays them out with utilities. A look belongs to the kit, never
  to the surface: never restyle a piece from outside, and never draw a look by hand that a piece
  already draws.
- If nothing fits, extend the kit, not the surface. Add a variant or size when the job is the
  same, and a new component when it differs. Either one lands in its own commit, before the
  surface uses it, with:
  - its doc comment;
  - its kit section (`apps/web/src/kit/sections/<id>.tsx`, on `kit/Specimen.tsx`'s tiles);
  - its playground (`apps/web/src/kit/playground/<id>.tsx`).

  A job others would otherwise draw by hand also gets a guard (§5).

- To see a surface in a state, use its flow, never a throwaway page. Each `apps/web/design-*.html`
  page draws one surface over fixtures (`apps/web/src/design/`) and needs no account, project or
  Mate. Its states are listed in its `kit-states` meta, and it appears in `/kit` under Flows, with
  a link per state in light, dark or both. A missing state is added to the surface's flow as a
  fixture and a `kit-states` entry. A surface without a flow gets one.
- A look is checked in `/kit` in both appearances and on the canvas's grounds before it lands.
