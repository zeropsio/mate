/**
 * The composer's top — what waits on the person, in one look — in the composer's own frame: a
 * Mate's changes waiting for review (one change, two, three, and five: the newest three and "and 2
 * more"), and what it asks: an approval, a question and a vault value.
 *
 * Then the same strip where the Mate's application limits who merges (Ada K. and Sam R. do), as
 * the rule itself reads it (`mateNextStep`): to Dana L., who cannot merge there — a change ready
 * for her ask, one she asked for, several of each — and to Ada K., whom Dana L. asked; and to Ada
 * K. reading along in Nova, Dana L.'s Mate: a colleague's changes, each a plain *View* but the one
 * Dana L. asked her to merge.
 *
 * Then what is being done to a change, as the same rule says it (`changeActOf`): its merge on its
 * way, merged, refused, ended unconfirmed, and its Mate fixing it while it works.
 *
 * Served by the dev server at `/design-composer-top.html` (`?theme=dark`; `?n=2`, `?ask=question`,
 * `?standing=to-ask` or `?act=merging` shows one state alone). Fixtures only: nothing here ships, and no route
 * imports this module.
 */
import {
  changeStandingOf,
  mateNextStep,
  type ChangeAct,
  type FlowPullRequest,
} from "@t3tools/client-runtime/zerops";
import { hqRefusalWords } from "@t3tools/client-runtime/zerops/hq";
import { ApprovalRequestId, type ConversationWorkingOn } from "@t3tools/contracts";
import { type ReactNode, StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { ComposerPendingApprovalActions } from "~/components/chat/ComposerPendingApprovalActions";
import { ComposerPendingApprovalPanel } from "~/components/chat/ComposerPendingApprovalPanel";
import {
  ComposerPendingUserInputPanel,
  ComposerPendingUserInputReadOnlyPanel,
} from "~/components/chat/ComposerPendingUserInputPanel";
import { MateFace } from "~/components/zerops/primitives";
import { VaultAsk } from "~/components/zerops/vault/VaultAsk";
import { VAULT_FIXTURE, VAULT_FIXTURE_NOW } from "~/components/zerops/vault/vaultFixture";
import {
  type VaultAsk as VaultAskModel,
  vaultAskState,
  vaultAskView,
} from "~/components/zerops/vault/vaultRequest.logic";
import {
  zeropsComposerTop,
  ZeropsNextStepStrip,
  type ZeropsNextStepStripModel,
} from "~/components/zerops/ZeropsNextStepBanner";
import { TooltipProvider } from "~/components/ui/tooltip";
import { applyThemePalette, ZEROPS_THEME_ID } from "~/themePalette";
import { reviewQueueOrder } from "~/zerops/reviewQueue.logic";
import "../index.css";

const params = new URLSearchParams(location.search);
const appearance = params.get("theme") === "dark" ? "dark" : "light";
const ONLY = params.get("n");
const ONLY_ASK = params.get("ask");
const ONLY_STANDING = params.get("standing");
const ONLY_ACT = params.get("act");

const FACE = <MateFace size={24} state="needs" tint="sky" />;
const nothing = async () => undefined;

const VAULT_ASK: VaultAskModel = {
  key: "NEW_STRIPE_KEY",
  label: "Stripe secret key",
  scope: { kind: "shared" },
  sensitive: true,
  reason: "to take card payments",
  askedAt: new Date(VAULT_FIXTURE_NOW - 5 * 60_000).toISOString(),
};

const VAULT_STATE = vaultAskState(VAULT_FIXTURE, VAULT_ASK);

const QUESTION = {
  requestId: ApprovalRequestId.make("question-harness"),
  createdAt: "2026-10-12T09:00:00.000Z",
  questions: [
    {
      id: "environment",
      header: "Environment",
      question: "Which environment should I inspect first?",
      options: [
        { label: "Staging", description: "Where the new API runs since this morning" },
        { label: "Production", description: "Read-only: logs and the build version" },
      ],
      multiSelect: false,
    },
  ],
  dismissible: true,
};

const ASKS: ReadonlyArray<{ readonly name: string; readonly top: ReactNode }> = [
  {
    name: "approval",
    top: (
      <ComposerPendingApprovalPanel
        actions={
          <ComposerPendingApprovalActions
            isResponding={false}
            onRespondToApproval={nothing}
            requestId={ApprovalRequestId.make("approval-harness")}
          />
        }
        approval={{
          requestId: ApprovalRequestId.make("approval-harness"),
          requestKind: "command",
          createdAt: "2026-10-12T09:00:00.000Z",
          detail: "zcli service deploy apidev --workspace-state all",
        }}
        face={FACE}
        pendingCount={1}
        who="Wren"
      />
    ),
  },
  {
    name: "question",
    top: (
      <ComposerPendingUserInputPanel
        answers={{}}
        face={FACE}
        onAdvance={() => undefined}
        onDismiss={() => undefined}
        onToggleOption={() => undefined}
        pendingUserInputs={[QUESTION]}
        questionIndex={0}
        respondingRequestIds={[]}
        who="Wren"
      />
    ),
  },
  {
    name: "colleague",
    top: (
      <ComposerPendingUserInputReadOnlyPanel
        face={<MateFace size={24} state="needs" tint="rose" />}
        pendingUserInputs={[QUESTION]}
        waitingLabel="Waiting for Theo"
        who="Rosa"
      />
    ),
  },
  {
    name: "vault",
    top: (
      <VaultAsk
        ask={VAULT_ASK}
        askId="vault-harness"
        density="compact"
        face={FACE}
        mateName="Wren"
        onNotNow={() => undefined}
        onSave={async () => true}
        onShowInConversation={() => undefined}
        onUseGiven={() => undefined}
        vault={VAULT_STATE}
        view={vaultAskView({
          ask: VAULT_ASK,
          mateName: "Wren",
          record: { state: "open", answer: null },
          vault: VAULT_STATE,
          matesOwn: false,
          pending: null,
          refusal: null,
          nameOf: () => undefined,
          clock: () => "",
        })}
      />
    ),
  },
];

const CHANGES = [
  ["apidev", 1, "Rebuild the full API on the new schema, with the old routes kept for a week"],
  ["appdev", 1, "Build the campaign website with the signup form and the countdown"],
  ["appdev", 2, "Add a footer with the press links"],
  ["appdev", 3, "Tune the hero images for phones"],
  ["apidev", 2, "Rate-limit the signup route"],
] as const;

function stripOf(count: number): ZeropsNextStepStripModel {
  const [first] = CHANGES;
  const target = (repository: string, number: number) =>
    ({ kind: "change", groupId: "g-1", repository, number }) as const;
  return {
    title:
      count === 1
        ? "Wren is waiting for your review"
        : `Wren is waiting for your review of ${String(count)} changes`,
    detail: first[2],
    tint: "sky",
    target: target(first[0], first[1]),
    ...(count === 1
      ? {}
      : {
          lines: CHANGES.slice(0, Math.min(3, count)).map(([repository, number, title]) => ({
            label: `${repository} #${String(number)} ${title}`,
            target: target(repository, number),
          })),
          more: Math.max(0, count - 3),
          // Every one is the person's to review: Review all goes through them, oldest first.
          queue: reviewQueueOrder(
            CHANGES.slice(0, count).map(([repository, number]) => ({
              target: target(repository, number),
            })),
          ),
        }),
  };
}

const TEA = "tea";
const NOVA_PROJECT = "p-nova";
const NAMES = { ada: "Ada K.", sam: "Sam R.", dana: "Dana L." };
const MERGERS = { people: ["ada", "sam"] };
/** Dana L., who cannot merge in Tea, and Ada K., who does. */
const AS_DANA = changeStandingOf(
  {
    apps: { [TEA]: { merges: "held", ...MERGERS } },
    names: NAMES,
    // Nova is hers: a comment on its change is for her.
    own: { [NOVA_PROJECT]: true },
  },
  { userId: "dana" },
);
const AS_ADA = changeStandingOf(
  { apps: { [TEA]: { merges: "yes", ...MERGERS } }, names: NAMES },
  { userId: "ada" },
);

const teaChange = (
  number: number,
  title: string,
  asked: boolean,
  /** Somebody commented on it since its person last opened its review. */
  commentedBy?: string,
): FlowPullRequest => ({
  repository: "appdev",
  number,
  title,
  kind: "code",
  mateProjectId: NOVA_PROJECT,
  url: undefined,
  mergeability: "mergeable",
  behind: false,
  merged: false,
  mergedAt: undefined,
  headSha: "abc",
  baseBranch: "main",
  line: `appdev #${String(number)}`,
  updatedAt: `2026-11-16T09:0${String(number % 10)}:00Z`,
  ready: true,
  ...(asked ? { mergeAsk: { by: "dana", at: "2026-11-16T09:30:00Z" } } : {}),
  ...(commentedBy === undefined
    ? {}
    : { lastComment: { at: "2026-11-16T10:00:00Z", by: commentedBy } }),
});

/** The strip of Nova's `changes` in Tea, as the conversation's own rule makes it for who looks. */
function standingStrip(
  changes: ReadonlyArray<FlowPullRequest>,
  standingOf: typeof AS_DANA,
  /** What Nova's conversations work on, while it works. */
  workingOn?: ReadonlyArray<ConversationWorkingOn>,
  /** Nova is the reader's own Mate; a colleague's where false. */
  yours = true,
): ZeropsNextStepStripModel {
  const step = mateNextStep({
    pullRequests: changes,
    mateProjectId: NOVA_PROJECT,
    mateName: "Nova",
    standingOf: (pull) => standingOf(TEA, pull),
    workingOn,
    yours,
  });
  if (step.kind !== "review") throw new Error("the harness' changes ask for no review");
  const { strip } = zeropsComposerTop({
    nextStep: {
      kind: "review",
      step,
      tint: "violet",
      shape: "clover",
      target: {
        kind: "change",
        groupId: TEA,
        repository: step.pull.repository,
        number: step.pull.number,
      },
    },
    pending: { question: false, approval: false, working: workingOn !== undefined },
  });
  if (strip === null) throw new Error("the harness' strip was put away");
  return strip;
}

/** Ada K.'s reader, with `act` on change `number`: what the account's verbs say of it. */
const actingOn =
  (number: number, act: ChangeAct): typeof AS_ADA =>
  (appId, pull) => {
    const read = AS_ADA(appId, pull);
    return pull.number === number ? { ...read, act } : read;
  };

const GIFT = "Add a gift note to the checkout";
const DAYS = "Show delivery days on the cart";
const LIST = "Tidy the tea list on small screens";

const STANDINGS: ReadonlyArray<{
  readonly state: string;
  readonly name: string;
  readonly strip: ZeropsNextStepStripModel;
}> = [
  {
    state: "to-ask",
    name: "Cannot merge here · one change ready",
    strip: standingStrip([teaChange(21, GIFT, false)], AS_DANA),
  },
  {
    state: "waiting",
    name: "Cannot merge here · asked",
    strip: standingStrip([teaChange(21, GIFT, true)], AS_DANA),
  },
  {
    state: "asked-of-me",
    name: "Merges here · Dana L. asked",
    strip: standingStrip([teaChange(21, GIFT, true)], AS_ADA),
  },
  {
    state: "commented",
    name: "Cannot merge here · asked, then Ada K. commented",
    strip: standingStrip([teaChange(21, GIFT, true, "ada")], AS_DANA),
  },
  {
    state: "to-ask-several",
    name: "Cannot merge here · two ready, one asked",
    strip: standingStrip(
      [teaChange(21, GIFT, true), teaChange(22, DAYS, false), teaChange(23, LIST, false)],
      AS_DANA,
    ),
  },
  {
    state: "waiting-several",
    name: "Cannot merge here · asked for both",
    strip: standingStrip([teaChange(21, GIFT, true), teaChange(22, DAYS, true)], AS_DANA),
  },
  {
    state: "asked-of-me-several",
    name: "Merges here · two changes, Dana L. asked for one",
    strip: standingStrip([teaChange(21, GIFT, false), teaChange(22, DAYS, true)], AS_ADA),
  },
  {
    state: "colleague-several",
    name: "A colleague's Mate · three changes, Dana L. asked for one",
    strip: standingStrip(
      [
        teaChange(21, GIFT, true),
        teaChange(22, DAYS, false),
        { ...teaChange(23, LIST, false), mergeability: "conflicting" },
      ],
      AS_ADA,
      undefined,
      false,
    ),
  },
];

const ACTS: ReadonlyArray<{
  readonly state: string;
  readonly name: string;
  readonly strip: ZeropsNextStepStripModel;
}> = [
  {
    state: "merging",
    name: "Merge pressed in the review · on its way",
    strip: standingStrip([teaChange(21, GIFT, false)], actingOn(21, { kind: "merging" })),
  },
  {
    state: "merged",
    name: "Merged · said for a beat, then it folds away",
    strip: standingStrip([teaChange(21, GIFT, false)], actingOn(21, { kind: "merged" })),
  },
  {
    state: "failed",
    name: "Merge refused · the way back",
    strip: standingStrip(
      [teaChange(21, GIFT, false)],
      actingOn(21, {
        kind: "merge-failed",
        reason: hqRefusalWords({ code: "conflict", reason: "head_moved" }),
      }),
    ),
  },
  {
    state: "unconfirmed",
    name: "Merge ended with no word from HQ · the way back",
    strip: standingStrip([teaChange(21, GIFT, false)], actingOn(21, { kind: "merge-unconfirmed" })),
  },
  {
    state: "fixing",
    name: "Its Mate fixing it, asked from the review",
    strip: standingStrip([teaChange(21, GIFT, false)], AS_ADA, [
      { kind: "change", repo: "appdev", number: 21, head: "abc" },
    ]),
  },
  {
    state: "merging-several",
    name: "Two changes · one merging",
    strip: standingStrip(
      [teaChange(21, GIFT, false), teaChange(22, DAYS, false)],
      actingOn(22, { kind: "merging" }),
    ),
  },
];

function Composer({
  name,
  state,
  top,
}: {
  readonly name: string;
  readonly state: string;
  readonly top: ReactNode;
}) {
  return (
    <section className="flex w-full max-w-3xl flex-col gap-2" data-composer-top-harness={state}>
      <span className="text-xs font-medium text-muted-foreground">{name}</span>
      <div
        className="w-full max-w-3xl overflow-hidden rounded-3xl border border-border bg-card"
        data-chat-composer-main-surface="true"
      >
        <div data-chat-composer-surface="true">
          {top}
          <div className="px-4 pt-3 pb-12 text-placeholder text-sm">Ask anything...</div>
        </div>
      </div>
    </section>
  );
}

function Harness() {
  const one = ONLY !== null || ONLY_ASK !== null || ONLY_STANDING !== null || ONLY_ACT !== null;
  const counts = ONLY !== null ? [Number(ONLY)] : one ? [] : [1, 2, 3, 5];
  const asks = ASKS.filter(({ name }) => (one ? name === ONLY_ASK : true));
  const standings = STANDINGS.filter(({ state }) => (one ? state === ONLY_STANDING : true));
  const acts = ACTS.filter(({ state }) => (one ? state === ONLY_ACT : true));
  return (
    <TooltipProvider>
      <div className="flex min-h-screen flex-col items-center gap-10 bg-background p-10 text-foreground">
        {counts.map((count) => (
          <Composer
            key={count}
            name={count === 1 ? "One change" : `${String(count)} changes`}
            state={String(count)}
            top={
              <ZeropsNextStepStrip onMore={() => {}} onReview={() => {}} strip={stripOf(count)} />
            }
          />
        ))}
        {standings.map(({ state, name, strip }) => (
          <Composer
            key={state}
            name={name}
            state={state}
            top={<ZeropsNextStepStrip onMore={() => {}} onReview={() => {}} strip={strip} />}
          />
        ))}
        {acts.map(({ state, name, strip }) => (
          <Composer
            key={state}
            name={name}
            state={`act-${state}`}
            top={<ZeropsNextStepStrip onMore={() => {}} onReview={() => {}} strip={strip} />}
          />
        ))}
        {asks.map(({ name, top }) => (
          <Composer key={name} name={`Asks: ${name}`} state={name} top={top} />
        ))}
      </div>
    </TooltipProvider>
  );
}

document.documentElement.classList.toggle("dark", appearance === "dark");
applyThemePalette(ZEROPS_THEME_ID, appearance);

const host = document.getElementById("design");
if (host) {
  createRoot(host).render(
    <StrictMode>
      <Harness />
    </StrictMode>,
  );
}
