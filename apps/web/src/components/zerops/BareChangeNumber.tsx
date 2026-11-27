/** Links to changes the conversation's application already holds in the client data layer. */
import { useAtomValue } from "@effect/atom-react";
import { shownHqAppChangesAtom } from "@t3tools/client-runtime/data";
import type { ScopedThreadRef, ServerProviderSkill } from "@t3tools/contracts";
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
import {
  indexChangeNumbers,
  resolveChangeNumbers,
  type NumberedChange,
} from "./BareChangeNumber.logic";

interface ConversationChanges {
  readonly appId: string;
  readonly hqAddress: string;
  readonly byNumber: ReadonlyMap<string, NumberedChange | null>;
}

const ConversationChangesContext = createContext<ConversationChanges | null>(null);

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
  const appId = useApplicationOfProject(location?.projectId ?? mate?.projectId)?.id;
  const appIds = useMemo(() => (appId === undefined ? [] : [appId]), [appId]);
  const open = useAtomValue(shownHqAppChangesAtom);
  const details = useHqAppDetails(appIds);
  const hqAddress = useHqAddress();
  const listed = appId === undefined ? undefined : open[appId];
  const recent = appId === undefined ? undefined : details[appId]?.changes;
  const byNumber = useMemo(() => indexChangeNumbers(listed, recent), [listed, recent]);
  const value = useMemo(
    () => (appId === undefined ? null : { appId, hqAddress, byNumber }),
    [appId, hqAddress, byNumber],
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

/** Markdown children with known bare change numbers linked outside code and existing links. */
export function renderBareChangeNumbers(
  children: ReactNode,
  enabled: boolean,
  skills: ReadonlyArray<Pick<ServerProviderSkill, "name" | "displayName">> = [],
): ReactNode {
  if (!enabled) return children;
  return Children.map(children, (child) => {
    if (typeof child === "string")
      return child.includes("#") ? <BareChangeText text={child} skills={skills} /> : child;
    if (!isValidElement<{ children?: ReactNode; node?: { tagName?: string } }>(child)) return child;
    // Custom markdown components replace the intrinsic type; the hast node names the tag.
    const tag = typeof child.type === "string" ? child.type : child.props.node?.tagName;
    if (tag === "code" || tag === "a" || !("children" in child.props)) return child;
    return cloneElement(
      child,
      undefined,
      renderBareChangeNumbers(child.props.children, true, skills),
    );
  });
}
