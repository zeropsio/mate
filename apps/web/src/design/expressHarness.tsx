/**
 * The Adobe Express tab in the right panel at the owner's size: 1786 wide, the menu at 435, the
 * panel at its default 540. The real `ExpressPanel` against Adobe's real SDK; the conversation
 * column shows what "Add to message" handed the composer. `?theme=dark` for dark.
 *
 * Served by the dev server at `/design-express.html`; needs `VITE_ADOBE_EXPRESS_CLIENT_ID` and the
 * page's origin among the key's allowed domains.
 */
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";

import { ExpressPanel } from "~/components/express/ExpressPanel";
import { RightPanelPage } from "~/components/RightPanelPage";
import { RightPanelTabs } from "~/components/RightPanelTabs";
import { resolveRightPanelAvailability } from "~/rightPanelKinds";
import { applyThemePalette, ZEROPS_THEME_ID } from "~/themePalette";
import "../index.css";

const params = new URLSearchParams(location.search);
const appearance = params.get("theme") === "dark" ? "dark" : "light";
const noop = () => {};

function Harness() {
  const [attached, setAttached] = useState<ReadonlyArray<{ name: string; url: string }>>([]);
  return (
    <div className="flex h-screen bg-background text-foreground">
      <div className="shrink-0 border-e border-border bg-sidebar" style={{ width: 435 }} />
      <div className="flex min-w-0 flex-1 flex-col gap-3 p-6" data-harness-composer>
        <p className="text-muted-foreground text-sm">In the message ({attached.length}):</p>
        {attached.map((file) => (
          <figure className="flex flex-col gap-1" key={file.url}>
            <img alt={file.name} className="max-h-60 self-start rounded-lg border" src={file.url} />
            <figcaption className="text-muted-foreground text-xs">{file.name}</figcaption>
          </figure>
        ))}
      </div>
      <RightPanelTabs
        activeSurfaceId="express"
        availability={resolveRightPanelAvailability({
          projectOpen: true,
          gitRepo: true,
          serverThread: true,
          zeropsPanel: "available",
          crewStatus: "applied",
          matePersona: true,
          express: true,
        })}
        defaultWidth={540}
        liveAgentCount={0}
        maximized={false}
        mode="inline"
        onActivate={noop}
        onAdd={noop}
        onAddTerminal={noop}
        onCloseAllSurfaces={noop}
        onCloseOtherSurfaces={noop}
        onCloseSurface={noop}
        onCloseSurfacesToRight={noop}
        onCopyFilePath={noop}
        pendingSurfaceIds={new Set()}
        surfaces={[
          { id: "files", kind: "files" },
          { id: "express", kind: "express" },
        ]}
        terminalLabelsById={new Map()}
        widthStorageKey="mate:design-express:panel-width"
      >
        <RightPanelPage kind="express" mate="Juno">
          <ExpressPanel
            environmentId={null}
            history={[]}
            mate="Juno"
            onAnswer={(files) =>
              setAttached((current) => [
                ...current,
                ...files.map((file) => ({ name: file.name, url: URL.createObjectURL(file) })),
              ])
            }
            threadId={null}
            onAttach={(files) =>
              setAttached((current) => [
                ...current,
                ...files.map((file) => ({ name: file.name, url: URL.createObjectURL(file) })),
              ])
            }
          />
        </RightPanelPage>
      </RightPanelTabs>
    </div>
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
