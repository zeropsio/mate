import { useRef } from "react";

import { RenderErrorBoundary } from "~/components/RenderErrorBoundary";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Badge } from "~/components/ui/badge";
import { InlineButton } from "~/components/ui/button";
import { Separator } from "~/components/ui/separator";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "~/components/ui/sidebar";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { AnchoredToastProvider, ToastProvider } from "~/components/ui/toast";
import { Toggle, ToggleGroup } from "~/components/ui/toggle-group";
import { useTheme } from "~/hooks/useTheme";

import { type KitView, useKitAppearance } from "./kitAppearance";
import type { KitFlow } from "./kitFlows";
import { KIT_GROUPS, KIT_KINDS, type KitSection } from "./kitSection";
import { KIT_OMISSIONS } from "./omissions";
import { KIT_SECTIONS } from "./registry";

const OMISSIONS_ID = "not-shown";
const VIEWS: readonly KitView[] = ["light", "dark", "both"];

/**
 * Every component the app is built from, on one page: the shared kit beside the home-made versions
 * features built instead, and, where the build carries the design harness, its flows: whole
 * surfaces in their states. Static fixtures only; it reads no account, project or Mate.
 */
export function KitPage({
  view,
  pane,
  onViewChange,
  sections = KIT_SECTIONS,
  flows = [],
  flow,
  onFlowChange,
}: {
  /** Unset shows the person's own appearance. */
  readonly view: KitView | undefined;
  readonly pane: boolean;
  readonly onViewChange: (view: KitView) => void;
  readonly sections?: readonly KitSection[];
  readonly flows?: readonly KitFlow[];
  /** The flow shown instead of the components, by its id. */
  readonly flow?: string | undefined;
  readonly onFlowChange?: (flow: string | undefined) => void;
}) {
  const { resolvedTheme } = useTheme();
  const shown = view ?? resolvedTheme;
  useKitAppearance(shown === "both" ? null : shown);

  if (pane) {
    return (
      <ToastProvider>
        <AnchoredToastProvider>
          <div className="min-h-svh bg-background text-foreground">
            <KitSections sections={sections} />
          </div>
        </AnchoredToastProvider>
      </ToastProvider>
    );
  }

  return (
    <ToastProvider>
      <AnchoredToastProvider>
        <KitFrame
          flow={flows.find((candidate) => candidate.id === flow)}
          flows={flows}
          sections={sections}
          view={shown}
          onFlowChange={onFlowChange ?? (() => {})}
          onViewChange={onViewChange}
        />
      </AnchoredToastProvider>
    </ToastProvider>
  );
}

function KitFrame({
  sections,
  flows,
  flow,
  view,
  onFlowChange,
  onViewChange,
}: {
  readonly sections: readonly KitSection[];
  readonly flows: readonly KitFlow[];
  readonly flow: KitFlow | undefined;
  readonly view: KitView;
  readonly onFlowChange: (flow: string | undefined) => void;
  readonly onViewChange: (view: KitView) => void;
}) {
  const panes = useRef<Array<HTMLIFrameElement | null>>([]);
  // Side by side, each appearance is its own document, so its overlays portal into it too.
  const jump = (id: string) => {
    for (const frame of panes.current) {
      frame?.contentDocument?.getElementById(id)?.scrollIntoView({ block: "start" });
    }
  };

  return (
    <SidebarProvider className="h-svh min-h-0">
      <Sidebar collapsible="none">
        <SidebarHeader>
          <div className="flex items-center justify-between gap-2 px-2 pt-1">
            <h1 className="m-0 font-semibold text-body">Kit</h1>
            <Badge tone="neutral">
              {sections.length} sections{flows.length > 0 ? ` · ${flows.length} flows` : ""}
            </Badge>
          </div>
        </SidebarHeader>
        <SidebarContent>
          <KitIndex
            sections={sections}
            onJump={view === "both" && flow === undefined ? jump : null}
            onLeaveFlow={flow === undefined ? null : () => onFlowChange(undefined)}
          />
          {flows.length > 0 ? (
            <KitFlowIndex flows={flows} shown={flow?.id} onPick={onFlowChange} />
          ) : null}
        </SidebarContent>
      </Sidebar>
      <SidebarInset className="min-h-0">
        <header className="flex shrink-0 items-center justify-between gap-4 border-b px-6 py-3">
          {flow === undefined ? (
            <p className="m-0 text-muted-foreground text-body">
              Every component, every variant and size, with the props it renders with.
            </p>
          ) : (
            <p className="m-0 flex items-center gap-2 text-body">
              <span className="font-medium">{flow.title}</span>
              <InlineButton
                render={<a href={flow.href} rel="noreferrer" target="_blank" />}
                tone="muted"
              >
                Open the page
              </InlineButton>
            </p>
          )}
          <ToggleGroup
            aria-label="Appearance"
            value={[view]}
            onValueChange={(next) => {
              const chosen = VIEWS.find((candidate) => next.includes(candidate));
              if (chosen !== undefined) onViewChange(chosen);
            }}
          >
            <Toggle value="light">Light</Toggle>
            <Toggle value="dark">Dark</Toggle>
            <Toggle value="both">Both</Toggle>
          </ToggleGroup>
        </header>
        {flow !== undefined ? (
          // A flow is a whole surface, laid out for a window's width: both appearances stack.
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            {(view === "both" ? (["light", "dark"] as const) : [view]).map((appearance) => (
              // oxlint-disable-next-line react/iframe-missing-sandbox -- the flow is this build's own page
              <iframe
                className={
                  view === "both" ? "min-h-svh w-full shrink-0 border-0" : "w-full flex-1 border-0"
                }
                key={`${flow.id}-${appearance}`}
                src={`${flow.href}?theme=${appearance}`}
                title={`${flow.title}, ${appearance}`}
              />
            ))}
          </div>
        ) : view === "both" ? (
          <div className="flex min-h-0 flex-1">
            {(["light", "dark"] as const).map((appearance, index) => (
              // oxlint-disable-next-line react/iframe-missing-sandbox -- the frame is this page itself
              <iframe
                className="h-full min-w-0 flex-1 border-0"
                key={appearance}
                ref={(frame) => {
                  panes.current[index] = frame;
                }}
                src={`${location.pathname}?appearance=${appearance}&pane=true`}
                title={`Kit, ${appearance}`}
              />
            ))}
          </div>
        ) : (
          <div className="relative min-h-0 flex-1 overflow-y-auto">
            <KitSections sections={sections} />
          </div>
        )}
      </SidebarInset>
    </SidebarProvider>
  );
}

function KitIndex({
  sections,
  onJump,
  onLeaveFlow,
}: {
  readonly sections: readonly KitSection[];
  /** In the side-by-side view the sections live in the two frames; a jump scrolls both. */
  readonly onJump: ((id: string) => void) | null;
  /** While a flow is shown, a section's link first brings the components back. */
  readonly onLeaveFlow: (() => void) | null;
}) {
  const link = (id: string, title: string) => (
    <SidebarMenuItem key={id}>
      <SidebarMenuButton
        render={
          <a
            href={`#${id}`}
            onClick={(event) => {
              if (onLeaveFlow !== null) {
                // The sections draw once the flow leaves; the jump waits for them.
                event.preventDefault();
                onLeaveFlow();
                requestAnimationFrame(() => {
                  document.getElementById(id)?.scrollIntoView({ block: "start" });
                });
                return;
              }
              if (onJump === null) return;
              event.preventDefault();
              onJump(id);
            }}
          />
        }
      >
        <span>{title}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );

  return (
    <>
      {KIT_GROUPS.flatMap((group) => {
        const inGroup = sections.filter((section) => section.group === group);
        if (inGroup.length === 0) return [];
        return [
          <SidebarGroup key={group}>
            <h2 className="m-0 px-2 pb-1 font-semibold text-caption">{group}</h2>
            {KIT_KINDS.flatMap((kind) => {
              const inKind = inGroup.filter((section) => section.kind === kind);
              if (inKind.length === 0) return [];
              return [
                <div className="flex flex-col gap-0.5 pb-2" key={kind}>
                  <h3 className="m-0 px-2 py-1 font-medium text-muted-foreground text-caption">
                    {kind}
                  </h3>
                  <SidebarMenu>
                    {inKind.map((section) => link(section.id, section.title))}
                  </SidebarMenu>
                </div>,
              ];
            })}
          </SidebarGroup>,
        ];
      })}
      <SidebarGroup>
        <SidebarMenu>{link(OMISSIONS_ID, "Not shown")}</SidebarMenu>
      </SidebarGroup>
    </>
  );
}

/** The design harness's pages, each a surface in its states; picking one shows it in place. */
function KitFlowIndex({
  flows,
  shown,
  onPick,
}: {
  readonly flows: readonly KitFlow[];
  readonly shown: string | undefined;
  readonly onPick: (flow: string) => void;
}) {
  return (
    <SidebarGroup>
      <h2 className="m-0 px-2 pb-1 font-semibold text-caption">Flows</h2>
      <SidebarMenu>
        {flows.map((flow) => (
          <SidebarMenuItem key={flow.id}>
            <SidebarMenuButton isActive={flow.id === shown} onClick={() => onPick(flow.id)}>
              <span>{flow.title}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    </SidebarGroup>
  );
}

function KitSections({ sections }: { readonly sections: readonly KitSection[] }) {
  return (
    <div className="flex flex-col gap-10 px-8 py-8">
      {sections.map((section) => (
        <KitSectionView key={section.id} section={section} />
      ))}
      <section className="flex scroll-mt-6 flex-col gap-4" id={OMISSIONS_ID}>
        <Separator />
        <div className="flex flex-col gap-1">
          <h2 className="m-0 font-semibold text-lg">Not shown</h2>
          <p className="m-0 text-muted-foreground text-body">
            Components the page leaves out, and why.
          </p>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Export</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Why</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {KIT_OMISSIONS.map((omission) => (
              <TableRow key={omission.name}>
                <TableCell>
                  <code className="font-mono text-caption">{omission.name}</code>
                </TableCell>
                <TableCell>
                  <code className="font-mono text-muted-foreground text-caption">
                    {omission.source}
                  </code>
                </TableCell>
                <TableCell>{omission.reason}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>
    </div>
  );
}

function KitSectionView({ section }: { readonly section: KitSection }) {
  return (
    <section
      aria-labelledby={`${section.id}-title`}
      className="flex scroll-mt-6 flex-col gap-6"
      data-kit-section={section.id}
      id={section.id}
    >
      <Separator />
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <h2 className="m-0 font-semibold text-lg" id={`${section.id}-title`}>
            {section.title}
          </h2>
          <Badge tone="neutral">{section.group}</Badge>
          <Badge tone="neutral">{section.kind}</Badge>
        </div>
        <p className="m-0 text-muted-foreground text-body">{section.purpose}</p>
        <code className="font-mono text-muted-foreground/70 text-caption">{section.source}</code>
      </div>
      <RenderErrorBoundary
        fallback={
          <Alert variant="error">
            <AlertTitle>{section.title} failed to render</AlertTitle>
            <AlertDescription>The browser console has the error.</AlertDescription>
          </Alert>
        }
      >
        {section.render()}
      </RenderErrorBoundary>
    </section>
  );
}
