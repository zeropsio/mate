import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";

import type { MateRowActions } from "~/components/zerops/SidebarMateMenu";
import type { ZeropsAgentActivity } from "~/zerops/agentActivity";

/**
 * One project of three Mates as the left menu draws it: one at work, one asking, one done and
 * unread. Invented names; nothing here is read from an account.
 */
const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

function mate(name: string): ZeropsCandidate {
  const id = `kit-docs-${name.toLowerCase()}`;
  return {
    key: `${id}:zcp`,
    group: "connected",
    environmentId: EnvironmentId.make(`env-${id}`),
    project: {
      id,
      name,
      status: "ACTIVE",
      tagList: ["mate"],
      hq: { appId: "kit-docs", appName: "Acme Docs", kind: "mate", mate: { face: "" } },
    },
    service: { id: `zcp-${id}`, name: "zcp", status: "ACTIVE" },
  };
}

export const KIT_MENU_MATES: ReadonlyArray<ZeropsCandidate> = [
  mate("Fen"),
  mate("Quinn"),
  mate("Ada"),
];

function activity(
  candidate: ZeropsCandidate,
  said: Pick<ZeropsAgentActivity, "subject" | "snippet"> &
    Partial<Pick<ZeropsAgentActivity, "kind" | "face" | "unread" | "question">> & {
      readonly minutes: number;
    },
): ZeropsAgentActivity {
  const { minutes, ...rest } = said;
  return {
    threadId: ThreadId.make(`thread-${candidate.project.id}`),
    kind: "idle",
    status: null,
    face: "idle",
    task: said.subject,
    at: minutesAgo(minutes),
    unread: false,
    pausedUntil: undefined,
    threadKey: `${candidate.environmentId}:thread-${candidate.project.id}`,
    ...rest,
  };
}

const [FEN, QUINN, ADA] = KIT_MENU_MATES as [ZeropsCandidate, ZeropsCandidate, ZeropsCandidate];

export const KIT_MENU_ACTIVE = ADA.project.id;

export const KIT_MENU_ACTIVITY = new Map<string, ZeropsAgentActivity>([
  [
    FEN.project.id,
    activity(FEN, {
      minutes: 1,
      kind: "working",
      face: "working",
      subject: "Add the changelog page",
      snippet: "Reading the release notes since 1.0.",
    }),
  ],
  [
    QUINN.project.id,
    activity(QUINN, {
      minutes: 6,
      kind: "input",
      face: "needs",
      subject: "Index the docs for search",
      snippet: "Index the API pages too, or only the guides?",
      question: "Index the API pages too, or only the guides?",
    }),
  ],
  [
    ADA.project.id,
    activity(ADA, {
      minutes: 18,
      face: "done",
      unread: true,
      subject: "Fix the broken links in the guides",
      snippet: "All 14 links point to live pages now.",
    }),
  ],
]);

const noop = () => {};

export const KIT_NO_CREW = { status: "none", crew: null, logins: {} } as const;

export function kitMateActions(candidate: ZeropsCandidate): MateRowActions {
  return {
    muted: false,
    toggleMute: noop,
    toggleUnread: noop,
    copyLink: noop,
    rename: { initialValue: candidate.project.name, validate: () => undefined, commit: noop },
    entries: [
      { id: "restart", label: "Restart", onSelect: noop },
      { id: "assign", label: "Hand over…", onSelect: noop },
      { id: "move", label: "Move to project…", onSelect: noop },
    ],
  };
}
