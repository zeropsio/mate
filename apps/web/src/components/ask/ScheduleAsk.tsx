/**
 * A Mate's schedule ask (`schedule-ask` fence) as its card: what runs each time, how often in
 * plain words, and on which project's automated Mates. Create schedule makes it through the
 * Automation section's own write; Edit… opens the Automation section's schedule form filled in
 * with it; Not now tells the Mate, in the conversation. Every state is read from its source: made,
 * from the schedules HQ lists for the project; Not now, from the person's message; refused, from
 * HQ's answer to this card's press. A project with no automated Mates says so, with the press that
 * adds them; anyone but an Owner or Admin reads who can.
 */
import type { ScopedThreadRef } from "@t3tools/contracts";
import type { HqScheduleRequest, HqScheduleView } from "@t3tools/shared/hqIntake";
import { roleAtLeast } from "@t3tools/shared/zeropsRoles";
import { useNavigate } from "@tanstack/react-router";
import { createContext, type ReactNode, use, useMemo, useState } from "react";

import { useComposerDraftStore } from "~/composerDraftStore";
import type { ChatMessage } from "~/types";
import { useAddAutomatedMates } from "~/zerops/newMate";
import { useAddMateOffer } from "~/zerops/useHqOffers";
import { useAppTaskSource } from "~/zerops/useTaskSourceSettings";
import { useZeropsMate } from "~/zerops/useZeropsMates";
import { useZeropsSessionOptional } from "~/zerops/ZeropsSessionProvider";
import { scheduleLine } from "../settings/taskSourcesSettings.logic";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Fact, Facts } from "../ui/facts";
import { Text } from "../ui/text";
import { SourceDialog, useAutomatedMateCount } from "../zerops/projectAutomation/ProjectAutomation";
import { AppSchedulesView, browserTimeZone } from "../zerops/projectAutomation/sourceForms";
import { AskCard, AskFooter } from "./AskCard";
import type { AskState } from "./ask.logic";
import {
  type ScheduleAsk,
  parseScheduleAsk,
  scheduleAskMade,
  scheduleAskNotNowWords,
  scheduleAskRequest,
  scheduleAsksSetAside,
} from "./scheduleAsk.logic";

const NOBODY_SET_ASIDE: ReadonlySet<string> = new Set();

/** The asks of the conversation the person said Not now to (`scheduleAsksSetAside`). */
export const ScheduleAskContext = createContext<ReadonlySet<string>>(NOBODY_SET_ASIDE);

/** The conversation's Not nows; the set changes only when one does, never on each word written. */
export function useScheduleAsksSetAside(
  messages: ReadonlyArray<ChatMessage> | undefined,
): ReadonlySet<string> {
  const setAside = useMemo(() => scheduleAsksSetAside(messages ?? []), [messages]);
  const identity = [...setAside].toSorted().join("|");
  const [held, hold] = useState({ identity: "", setAside: NOBODY_SET_ASIDE });
  if (identity !== held.identity) hold({ identity, setAside });
  return identity === held.identity ? held.setAside : setAside;
}

/** A fence's card once its words are whole; words that propose no schedule stay the code they are. */
export function ScheduleAskFence({
  code,
  isStreaming,
  threadRef,
  children,
}: {
  readonly code: string;
  readonly isStreaming: boolean;
  readonly threadRef: ScopedThreadRef | undefined;
  readonly children: ReactNode;
}) {
  const ask = useMemo(() => (isStreaming ? null : parseScheduleAsk(code)), [code, isStreaming]);
  // Half-written JSON is nothing to read: the card appears once the Mate finished it.
  if (isStreaming) return null;
  if (ask === null || threadRef === undefined) return children;
  return (
    // The card sits in an answer's words; it keeps its own rhythm, not the answer's paragraphs.
    <div className="chat-markdown-island my-4 max-w-[34rem]">
      <ScheduleAskCard ask={ask} threadRef={threadRef} />
    </div>
  );
}

function ScheduleAskCard({
  ask,
  threadRef,
}: {
  readonly ask: ScheduleAsk;
  readonly threadRef: ScopedThreadRef;
}) {
  const whoLivesHere = useZeropsMate(threadRef.environmentId);
  const mate = whoLivesHere.kind === "mate" ? whoLivesHere.mate : undefined;
  const groupId = mate?.groupId ?? null;
  const admin = roleAtLeast(useZeropsSessionOptional()?.activeOrganization?.roleCode, "ADMIN");
  // Only an Owner or Admin reads an application's schedules; HQ refuses anyone else.
  const schedules = useAppTaskSource("hqAppSchedules", admin ? groupId : null);
  const automatedMates = useAutomatedMateCount(groupId ?? "");
  const addOffer = useAddMateOffer();
  const addAutomatedMates = useAddAutomatedMates();
  const navigate = useNavigate();
  const setAside = use(ScheduleAskContext).has(ask.key);
  // The press this card made: its write's progress and refusal are the setting's latest write.
  const [pressed, setPressed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [zone] = useState(browserTimeZone);
  const request = scheduleAskRequest(ask, zone);
  // A Mate HQ names a project of but no application yet is unread, not in no project.
  const project =
    mate === undefined
      ? undefined
      : groupId !== null
        ? (mate.project ?? "")
        : mate.project === undefined
          ? null
          : undefined;
  const setting = schedules.read.setting;
  const action = schedules.read.action;
  const listed = setting.state === "known" ? scheduleAskMade(ask, setting.held) : undefined;
  const made =
    listed ??
    (pressed && action.kind === "done" && action.verb === "schedule-make"
      ? { rule: request.rule }
      : undefined);
  const press: SchedulePress = !pressed
    ? { kind: "idle" }
    : action.kind === "working"
      ? { kind: "working" }
      : action.kind === "failed" || action.kind === "unresolved"
        ? { kind: "refused", words: action.words }
        : { kind: "idle" };
  const create = () => {
    setPressed(true);
    schedules.write({ kind: "schedule-make", request });
  };
  return (
    <>
      <ScheduleAskCardView
        admin={admin}
        ask={ask}
        automatedMates={automatedMates}
        made={
          made ?? (setting.state === "unread" || setting.state === "reading" ? null : undefined)
        }
        mate={mate?.name}
        onAddAutomatedMates={
          groupId !== null && addOffer(groupId).kind === "allowed"
            ? () => {
                addAutomatedMates(groupId);
              }
            : undefined
        }
        onCreate={create}
        onEdit={() => {
          // What the form makes is its own write: this card's press no longer stands for it.
          setPressed(false);
          setEditing(true);
        }}
        onNotNow={() => {
          // The words lead, so the conversation reads them back; anything typed goes with them.
          const drafts = useComposerDraftStore.getState();
          const typed = drafts.getComposerDraft(threadRef)?.prompt.trim() ?? "";
          const words = scheduleAskNotNowWords(ask);
          drafts.requestSend(threadRef, typed === "" ? words : `${words}\n\n${typed}`);
        }}
        onOpenAutomation={() => {
          if (groupId === null) return;
          void navigate({ to: "/group/$groupId/board", params: { groupId } });
        }}
        press={press}
        project={project}
        request={request}
        setAside={setAside}
      />
      {editing ? (
        <SourceDialog
          kind="schedule"
          onClose={() => {
            setEditing(false);
          }}
        >
          <AppSchedulesView
            controls={schedules}
            initial={request}
            name={
              project === null || project === undefined || project === "" ? "This project" : project
            }
          />
        </SourceDialog>
      ) : null}
    </>
  );
}

/** Where this card's own press stands; a press made elsewhere is no press of its. */
export type SchedulePress =
  | { readonly kind: "idle" }
  | { readonly kind: "working" }
  | { readonly kind: "refused"; readonly words: string };

/**
 * The card as it reads its sources, every read handed in. `project`: the Mate's project by name
 * (`""` where HQ has not named it), `null` for a Mate in none, `undefined` while who lives here is
 * unread. `automatedMates`: how many, `null` unread. `made`: the schedule HQ lists for it, `null`
 * while its schedules are read, `undefined` for none.
 */
export function ScheduleAskCardView({
  ask,
  request,
  mate,
  project,
  admin,
  automatedMates,
  made,
  press,
  setAside,
  onCreate,
  onEdit,
  onNotNow,
  onOpenAutomation,
  onAddAutomatedMates,
}: {
  readonly ask: ScheduleAsk;
  readonly request: HqScheduleRequest;
  readonly mate: string | undefined;
  readonly project: string | null | undefined;
  /** An Owner or Admin: who may add a schedule. */
  readonly admin: boolean;
  readonly automatedMates: number | null;
  readonly made: Pick<HqScheduleView, "rule"> | null | undefined;
  readonly press: SchedulePress;
  readonly setAside: boolean;
  readonly onCreate: () => void;
  readonly onEdit: () => void;
  readonly onNotNow: () => void;
  readonly onOpenAutomation: () => void;
  /** Opens Add automated Mates over the conversation; absent where the person may not add them. */
  readonly onAddAutomatedMates: (() => void) | undefined;
}) {
  const name = mate ?? "This Mate";
  const named = typeof project === "string" && project !== "" ? project : undefined;
  const noMates = automatedMates === 0;
  const state: AskState =
    made !== null && made !== undefined
      ? { kind: "done", words: `Scheduled · ${scheduleLine(made.rule)}`, told: null }
      : setAside
        ? { kind: "notNow", words: "Not now" }
        : project === null
          ? {
              kind: "failed",
              words: `${name} is in no project, so no automated Mates can run this.`,
            }
          : !admin
            ? {
                kind: "othersToAnswer",
                words: `Only an Owner or Admin can add a schedule to ${named ?? "this project"}.`,
              }
            : press.kind === "refused"
              ? { kind: "failed", words: press.words }
              : press.kind === "working"
                ? { kind: "working", words: "Creating…", pressed: "main" }
                : { kind: "waiting" };
  const live =
    state.kind === "waiting" ||
    state.kind === "working" ||
    state.kind === "othersToAnswer" ||
    (state.kind === "failed" && press.kind === "refused");
  const unread = project === undefined || automatedMates === null || made === null;
  const main =
    state.kind !== "waiting" && state.kind !== "working"
      ? null
      : noMates
        ? onAddAutomatedMates === undefined
          ? null
          : { label: "Add automated Mates…", onPress: onAddAutomatedMates }
        : { label: "Create schedule", disabled: unread, onPress: onCreate };

  return (
    <AskCard
      askId={`schedule:${ask.key}`}
      density="full"
      footer={
        <AskFooter
          action={
            state.kind === "done" ? (
              <Button onClick={onOpenAutomation} size="md" variant="secondary">
                Open in Automation
              </Button>
            ) : state.kind === "failed" && press.kind === "refused" ? (
              <Button onClick={onCreate} size="md" variant="secondary">
                Try again
              </Button>
            ) : undefined
          }
          also={
            noMates || state.kind !== "waiting" ? undefined : (
              <Button disabled={unread} onClick={onEdit} size="md" variant="secondary">
                Edit…
              </Button>
            )
          }
          density="full"
          main={main}
          onNotNow={state.kind === "waiting" ? onNotNow : undefined}
          state={state}
        />
      }
      kind="schedule"
      state={state.kind}
      title={ask.title}
      where={named === undefined ? null : { scope: "project", detail: named }}
      why={live && ask.why !== undefined ? { who: name, words: ask.why } : null}
    >
      {live ? (
        <div className="mt-1 grid min-w-0 gap-4">
          <section className="grid min-w-0 gap-1">
            <Text render={<h3 />} variant="label">
              Each time
            </Text>
            <p className="line-clamp-4 whitespace-pre-line text-body text-foreground">
              {ask.brief}
            </p>
          </section>
          <Card size="sm" variant="inset">
            <Facts>
              <Fact label="Repeats">{scheduleLine(request.rule)}</Fact>
              <Fact label="Runs on">{`${named ?? "The project"}'s automated Mates`}</Fact>
              <Fact label="Named">{ask.name}</Fact>
            </Facts>
          </Card>
          {noMates && state.kind === "waiting" ? (
            <Text data-schedule-ask-no-mates="" render={<p />} variant="note">
              {`${named ?? "The project"} has no automated Mates yet, so nothing would run it.`}
            </Text>
          ) : null}
        </div>
      ) : null}
    </AskCard>
  );
}
