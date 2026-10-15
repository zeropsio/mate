import { useRef } from "react";

import { RenderErrorBoundary } from "~/components/RenderErrorBoundary";
import { Alert, AlertDescription, AlertTitle } from "~/components/ui/alert";
import { Badge } from "~/components/ui/badge";
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
import { appBasePathHref } from "~/basePath";

import { type KitView, useKitAppearance } from "./kitAppearance";
import { KIT_GROUPS, KIT_KINDS, type KitSection } from "./kitSection";
import { KIT_OMISSIONS } from "./omissions";
import { KIT_SECTIONS } from "./registry";

const OMISSIONS_ID = "not-shown";
const VIEWS: readonly KitView[] = ["light", "dark", "both"];

/**
 * Every component the app is built from, on one page: the shared kit beside the home-made versions
 * features built instead. Static fixtures only; it reads no account, project or Mate.
 */
export function KitPage({
  view,
  pane,
  onViewChange,
  sections = KIT_SECTIONS,
}: {
  /** Unset shows the person's own appearance. */
  readonly view: KitView | undefined;
  readonly pane: boolean;
  readonly onViewChange: (view: KitView) => void;
  readonly sections?: readonly KitSection[];
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
        <KitFrame sections={sections} view={shown} onViewChange={onViewChange} />
      </AnchoredToastProvider>
    </ToastProvider>
  );
}

function KitFrame({
  sections,
  view,
  onViewChange,
}: {
  readonly sections: readonly KitSection[];
  readonly view: KitView;
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
            <h1 className="m-0 font-semibold text-sm">Kit</h1>
            <Badge tone="neutral">{sections.length} sections</Badge>
          </div>
        </SidebarHeader>
        <SidebarContent>
          <KitIndex sections={sections} onJump={view === "both" ? jump : null} />
        </SidebarContent>
      </Sidebar>
      <SidebarInset className="min-h-0">
        <header className="flex shrink-0 items-center justify-between gap-4 border-b px-6 py-3">
          <p className="m-0 text-muted-foreground text-sm">
            Every component, every variant and size, with the props it renders with.
          </p>
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
        {view === "both" ? (
          <div className="flex min-h-0 flex-1">
            {(["light", "dark"] as const).map((appearance, index) => (
              // oxlint-disable-next-line react/iframe-missing-sandbox -- the frame is this page itself
              <iframe
                className="h-full min-w-0 flex-1 border-0"
                key={appearance}
                ref={(frame) => {
                  panes.current[index] = frame;
                }}
                src={`${appBasePathHref()}kit?appearance=${appearance}&pane=true`}
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
}: {
  readonly sections: readonly KitSection[];
  /** In the side-by-side view the sections live in the two frames; a jump scrolls both. */
  readonly onJump: ((id: string) => void) | null;
}) {
  const link = (id: string, title: string) => (
    <SidebarMenuItem key={id}>
      <SidebarMenuButton
        render={
          <a
            href={`#${id}`}
            onClick={(event) => {
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
            <h2 className="m-0 px-2 pb-1 font-semibold text-xs">{group}</h2>
            {KIT_KINDS.flatMap((kind) => {
              const inKind = inGroup.filter((section) => section.kind === kind);
              if (inKind.length === 0) return [];
              return [
                <div className="flex flex-col gap-0.5 pb-2" key={kind}>
                  <h3 className="m-0 px-2 py-1 font-medium text-muted-foreground text-xs">
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
          <p className="m-0 text-muted-foreground text-sm">
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
                  <code className="font-mono text-xs">{omission.name}</code>
                </TableCell>
                <TableCell>
                  <code className="font-mono text-muted-foreground text-xs">{omission.source}</code>
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
        <p className="m-0 text-muted-foreground text-sm">{section.purpose}</p>
        <code className="font-mono text-muted-foreground/70 text-xs">{section.source}</code>
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
