import { createContext, useContext, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { rightPanelPageHead, type RightPanelKind } from "../rightPanelKinds";
import { PageHeader } from "./ui/page-header";

/**
 * Where a page's one action goes: the head's edge, `null` for a page kept open behind another,
 * `undefined` outside any side-panel page (a design harness), where the action stays in place.
 */
const PageEdgeContext = createContext<HTMLElement | null | undefined>(undefined);

/**
 * Every side-panel page opens the same way: its title, one line saying what it shows, and at
 * most one action at the title's edge (`RightPanelPageEdge`). The head paints with the page's
 * first frame, before the page itself has read anything, so nothing below it moves when its data
 * arrives.
 */
export function RightPanelPage(props: {
  /** A change's page (`kind: "change"`) wears its own head. */
  readonly kind: RightPanelKind | "change";
  /** The Mate's name, while it is known. */
  readonly mate: string | undefined;
  readonly children: ReactNode;
}) {
  const [edge, setEdge] = useState<HTMLElement | null>(null);
  const head = props.kind === "change" ? null : rightPanelPageHead(props.kind, props.mate);
  if (head === null) return props.children;
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col" data-right-panel-page={props.kind}>
      <PageHeader
        actions={<span className="flex items-center" ref={setEdge} />}
        line={head.line}
        size="panel"
        title={head.title}
      />
      <PageEdgeContext value={edge}>
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">{props.children}</div>
      </PageEdgeContext>
    </div>
  );
}

/** The page's one action, drawn at its head's edge. */
export function RightPanelPageEdge(props: { readonly children: ReactNode }) {
  const edge = useContext(PageEdgeContext);
  if (edge === undefined) return props.children;
  return edge === null ? null : createPortal(props.children, edge);
}

/** A page kept mounted behind the open one (`hidden`): its action stays off the head. */
export function RightPanelPageEdgeScope(props: {
  readonly hidden: boolean;
  readonly children: ReactNode;
}) {
  const edge = useContext(PageEdgeContext);
  return (
    <PageEdgeContext value={edge === undefined || !props.hidden ? edge : null}>
      {props.children}
    </PageEdgeContext>
  );
}
