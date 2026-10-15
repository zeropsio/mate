import { useRef } from "react";

import { Button } from "~/components/ui/button";
import { anchoredToastManager, toastManager } from "~/components/ui/toast";

import { defineKitSection } from "../kitSection";
import { Specimen, SpecimenBlock, SpecimenGrid } from "../Specimen";
import { specimenLabel } from "../specimenLabel";

const TYPES = ["success", "error", "info", "warning", "loading"] as const;

const COPY: Record<(typeof TYPES)[number], { title: string; description: string }> = {
  success: { title: "storefront deployed", description: "The build from 18:02 is live." },
  error: { title: "The deploy failed", description: "npm could not resolve a peer dependency." },
  info: { title: "A new version is out", description: "Reload to use it." },
  warning: { title: "The disk is 90% full", description: "db keeps 1.8 GB free." },
  loading: { title: "Deploying storefront", description: "Building, step 3 of 5." },
};

const SLOW_REQUESTS = (
  <ul className="m-0 ps-4 text-xs">
    <li>project.list</li>
    <li>service.logs</li>
    <li>deploy.status</li>
  </ul>
);

function AnchoredOpener() {
  const anchor = useRef<HTMLButtonElement>(null);
  return (
    <Button
      onClick={() =>
        anchoredToastManager.add({
          data: { tooltipStyle: true },
          positionerProps: { anchor: anchor.current },
          timeout: 1500,
          title: "Copied",
        })
      }
      ref={anchor}
      variant="outline"
    >
      Copy
    </Button>
  );
}

function ToastSpecimens() {
  return (
    <div className="flex flex-col gap-8">
      <SpecimenBlock title="Openers: each adds a real toast, top right">
        <SpecimenGrid>
          {TYPES.map((type) => (
            <Specimen key={type} label={`toastManager.add({ ${specimenLabel({ type })} })`}>
              <Button onClick={() => toastManager.add({ type, ...COPY[type] })} variant="outline">
                {type}
              </Button>
            </Specimen>
          ))}
          <Specimen label="with actionProps">
            <Button
              onClick={() =>
                toastManager.add({
                  type: "success",
                  title: "Project archived",
                  actionProps: { children: "Undo" },
                })
              }
              variant="outline"
            >
              with action
            </Button>
          </Specimen>
          <Specimen label="with expandableContent">
            <Button
              onClick={() =>
                toastManager.add({
                  type: "error",
                  title: "Three requests are slow",
                  description: "The server has not answered for 20 seconds.",
                  data: { expandableContent: SLOW_REQUESTS },
                })
              }
              variant="outline"
            >
              with details
            </Button>
          </Specimen>
          <Specimen label="anchoredToastManager.add({ data: { tooltipStyle: true } })">
            <AnchoredOpener />
          </Specimen>
        </SpecimenGrid>
      </SpecimenBlock>
    </div>
  );
}

export default defineKitSection({
  id: "toast",
  title: "Toast",
  purpose: "A passing word about something that just happened; it leaves by itself.",
  group: "Kit",
  kind: "Feedback",
  source: "apps/web/src/components/ui/toast.tsx",
  render: () => <ToastSpecimens />,
});
