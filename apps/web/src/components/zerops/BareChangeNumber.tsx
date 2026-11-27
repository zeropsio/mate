/**
 * Links to changes the conversation's application already holds in the client data layer, and a
 * turn answer's bold *Open draft* and *Add to your app* as the presses of the change its turn left
 * for the person (`TurnChangeContext`).
 */
import { useAtomValue } from "@effect/atom-react";
import { shownHqAppChangesAtom } from "@t3tools/client-runtime/data";
import type { ScopedThreadRef, ServerProviderSkill } from "@t3tools/contracts";
import type { ZeropsOperationPullRequest } from "@t3tools/client-runtime/zerops/model";
import { changeUrl } from "@t3tools/shared/hqChanges";
import {
  Children,
  cloneElement,
  createContext,
  Fragment,
  isValidElement,
  type ReactNode,
  use,
  useMemo,
} from "react";

import { useMateOfEnvironment } from "~/zerops/accountEnvironments";
import { useHqAddress } from "~/zerops/projectFlows";
import { useHqAppDetails } from "~/zerops/useHqAppDetail";
import { useKnownMate } from "~/zerops/useZeropsMates";
import { ServiceBrowserLink } from "../ServiceBrowserLink";
import { renderSkillInlineMarkdownChildren } from "../chat/SkillInlineText";
import { useApplicationOfProject } from "./useGitEnvironmentFormInputs";
import { useOpenDraft } from "~/zerops/openInMatePanel";
import { useOpenReview } from "~/zerops/review";
import { InlineButton } from "../ui/button";
import {
  changeActionOf,
  indexChangeNumbers,
  resolveChangeNumbers,
  type ChangeAction,
  type NumberedChange,
} from "./BareChangeNumber.logic";

interface ConversationChanges {
  readonly appId: string;
  /** The conversation's Mate, whose working copy holds a change's Draft. */
  readonly mateProjectId: string | undefined;
  readonly hqAddress: string;
  readonly byNumber: ReadonlyMap<string, NumberedChange | null>;
}

const ConversationChangesContext = createContext<ConversationChanges | null>(null);

/**
 * The change the turn whose answer this is left for the person (`OutcomeModel.change`); none in
 * any other words, whose bold presses stay words.
 */
export const TurnChangeContext = createContext<ZeropsOperationPullRequest | null>(null);

/** One read per conversation; it does not hold or fetch application detail. */
function ConversationChangesProvider({
  threadRef,
  children,
}: {
  readonly threadRef: ScopedThreadRef;
  readonly children: ReactNode;
}) {
  const mate = useKnownMate(threadRef.environmentId);
  const location = useMateOfEnvironment(threadRef.environmentId);
  const mateProjectId = location?.projectId ?? mate?.projectId;
  const appId = useApplicationOfProject(mateProjectId)?.id;
  const appIds = useMemo(() => (appId === undefined ? [] : [appId]), [appId]);
  const open = useAtomValue(shownHqAppChangesAtom);
  const details = useHqAppDetails(appIds);
  const hqAddress = useHqAddress();
  const listed = appId === undefined ? undefined : open[appId];
  const recent = appId === undefined ? undefined : details[appId]?.changes;
  const byNumber = useMemo(() => indexChangeNumbers(listed, recent), [listed, recent]);
  const value = useMemo(
    () => (appId === undefined ? null : { appId, mateProjectId, hqAddress, byNumber }),
    [appId, mateProjectId, hqAddress, byNumber],
  );
  return <ConversationChangesContext value={value}>{children}</ConversationChangesContext>;
}

export function BareChangeNumbersProvider({
  threadRef,
  children,
}: {
  readonly threadRef: ScopedThreadRef | null;
  readonly children: ReactNode;
}) {
  return threadRef === null ? (
    children
  ) : (
    <ConversationChangesProvider threadRef={threadRef}>{children}</ConversationChangesProvider>
  );
}

function BareChangeText({
  text,
  skills,
}: {
  readonly text: string;
  readonly skills: ReadonlyArray<Pick<ServerProviderSkill, "name" | "displayName">>;
}) {
  const context = use(ConversationChangesContext);
  if (context === null) return renderSkillInlineMarkdownChildren(text, skills);
  let offset = 0;
  return resolveChangeNumbers(text, context.byNumber).map((part) => {
    const start = offset;
    offset += part.text.length;
    return (
      <Fragment key={start}>
        {part.change === undefined ? (
          renderSkillInlineMarkdownChildren(part.text, skills)
        ) : (
          <ServiceBrowserLink
            href={changeUrl(context.hqAddress, context.appId, part.change.repo, part.change.number)}
            rel="noopener noreferrer"
            showIndicator={false}
            target="_blank"
          >
            {part.text}
          </ServiceBrowserLink>
        )}
      </Fragment>
    );
  });
}

/** The press a Mate names in bold, bound to the change its turn left for the person. */
function ChangeActionButton({
  action,
  children,
}: {
  readonly action: ChangeAction;
  readonly children: ReactNode;
}) {
  const context = use(ConversationChangesContext);
  const change = use(TurnChangeContext);
  const openDraft = useOpenDraft();
  const openReview = useOpenReview();
  if (context === null || change === null) return children;
  const target = { groupId: context.appId, repository: change.repository, number: change.number };
  const mateProjectId = context.mateProjectId;
  if (action === "draft" && mateProjectId === undefined) return children;
  return (
    <InlineButton
      onClick={(press) => {
        // The Draft opens in its pane; Add to your app opens the change's review, where it is pressed.
        if (action === "draft" && mateProjectId !== undefined) openDraft(mateProjectId, target);
        else openReview({ kind: "change", ...target }, { from: press.currentTarget });
      }}
    >
      {children}
    </InlineButton>
  );
}

/** The words of markdown children, as a block reads them. */
const textOf = (children: ReactNode): string =>
  Children.toArray(children)
    .map((child) =>
      typeof child === "string" || typeof child === "number"
        ? String(child)
        : isValidElement<{ children?: ReactNode }>(child)
          ? textOf(child.props.children)
          : "",
    )
    .join("");

function linkChanges(
  children: ReactNode,
  skills: ReadonlyArray<Pick<ServerProviderSkill, "name" | "displayName">>,
): ReactNode {
  return Children.map(children, (child) => {
    if (typeof child === "string")
      return child.includes("#") ? <BareChangeText text={child} skills={skills} /> : child;
    if (!isValidElement<{ children?: ReactNode; node?: { tagName?: string } }>(child)) return child;
    // Custom markdown components replace the intrinsic type; the hast node names the tag.
    const tag = typeof child.type === "string" ? child.type : child.props.node?.tagName;
    if (tag === "code" || tag === "a" || !("children" in child.props)) return child;
    const action = tag === "strong" ? changeActionOf(textOf(child.props.children)) : undefined;
    if (action !== undefined)
      return <ChangeActionButton action={action}>{child}</ChangeActionButton>;
    return cloneElement(child, undefined, linkChanges(child.props.children, skills));
  });
}

/**
 * Markdown children with known bare change numbers linked outside code and existing links, and
 * their bold presses bound to the change of the turn they answer.
 */
export function renderBareChangeNumbers(
  children: ReactNode,
  enabled: boolean,
  skills: ReadonlyArray<Pick<ServerProviderSkill, "name" | "displayName">> = [],
): ReactNode {
  if (!enabled) return children;
  return linkChanges(children, skills);
}
