import { useRef, useState } from "react";

import { ComposerPictureView } from "~/components/chat/ComposerPictureView";
import { ExpandedImageDialog } from "~/components/chat/ExpandedImageDialog";
import { Button } from "~/components/ui/button";
import { CommandDialog, CommandDialogPopup } from "~/components/ui/command";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "~/components/ui/dialog";
import { Menu, MenuTrigger } from "~/components/ui/menu";
import { SidebarProvider } from "~/components/ui/sidebar";
import { SidebarChromeHeader } from "~/components/sidebar/SidebarChrome";
import { SidebarChiefRow } from "~/components/zerops/chief/SidebarChiefRow";
import { CrewmateMenuPopup } from "~/components/zerops/crew/CrewmateMenu";
import { crewmateMenuModel } from "~/components/zerops/crew/CrewmateMenu.logic";
import { JumpBoxView, useJumpBoxModel, useJumpBoxState } from "~/components/zerops/JumpBox";
import type { SidebarJumpIndex } from "~/components/zerops/JumpBox.logic";
import { ZeropsReviewDialog } from "~/components/zerops/review/ZeropsReviewDialog";
import { MateMenu } from "~/components/zerops/SidebarMateMenu";
import { waitingItemsOf } from "~/components/zerops/SidebarWaiting.logic";
import type { ComposerPicture } from "~/lib/composerPictures";

import { CensusSpecimen, KitViewer } from "../census";
import { KIT_MENU_MATES, kitMateActions } from "../fixtures/menuTree";
import { defineKitSection } from "../kitSection";
import { Specimen, SpecimenBlock, SpecimenGrid } from "../Specimen";

const noop = () => {};

/** A made-up screenshot: a page with a header, a card and a button, drawn as SVG. */
const PICTURE_SRC = `data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800">
    <rect width="1200" height="800" fill="#f4f6f8"/>
    <rect width="1200" height="72" fill="#1f2937"/>
    <rect x="40" y="24" width="160" height="24" rx="6" fill="#3cbdb2"/>
    <rect x="80" y="140" width="640" height="420" rx="20" fill="#ffffff" stroke="#d6dbe1"/>
    <rect x="120" y="190" width="420" height="28" rx="6" fill="#1f2937"/>
    <rect x="120" y="240" width="520" height="16" rx="5" fill="#9aa4b1"/>
    <rect x="120" y="270" width="480" height="16" rx="5" fill="#9aa4b1"/>
    <rect x="120" y="470" width="180" height="48" rx="10" fill="#0a84ff"/>
    <rect x="780" y="140" width="340" height="420" rx="20" fill="#e3f4f2"/>
  </svg>`,
)}`;

function ExpandedImageOpener() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)} variant="secondary">
        Open the picture
      </Button>
      {open ? (
        <ExpandedImageDialog
          onClose={() => setOpen(false)}
          preview={{ images: [{ src: PICTURE_SRC, name: "Checkout page" }], index: 0 }}
        />
      ) : null}
    </>
  );
}

const PICTURE: ComposerPicture = {
  source: null,
  sourceWidth: 1200,
  sourceHeight: 800,
  crop: { x: 0, y: 0, w: 1200, h: 800 },
  marks: [],
  keepOriginal: false,
  width: 1200,
  height: 800,
  asPasted: true,
  preparing: false,
};

function PictureViewOpener() {
  const [open, setOpen] = useState(false);
  const [picture, setPicture] = useState(PICTURE);
  return (
    <>
      <Button onClick={() => setOpen(true)} variant="secondary">
        Open a pasted picture
      </Button>
      {open ? (
        <ComposerPictureView
          bitmap={null}
          canKeepOriginal
          image={{
            type: "image",
            id: "kit-picture",
            name: "checkout.png",
            mimeType: "image/png",
            sizeBytes: 182_000,
            previewUrl: PICTURE_SRC,
            file: new File([], "checkout.png", { type: "image/png" }),
            picture,
          }}
          mateName="Fen"
          onChange={setPicture}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

function ReviewDialogOpener() {
  const [open, setOpen] = useState(false);
  const from = useRef<HTMLButtonElement | null>(null);
  return (
    <>
      <Button onClick={() => setOpen(true)} ref={from} variant="secondary">
        Review a change
      </Button>
      <ZeropsReviewDialog
        from={from.current}
        labelledBy="kit-review-title"
        onClosed={noop}
        onOpenChange={setOpen}
        open={open}
      >
        <div className="flex flex-col gap-2 p-8">
          <h2 className="m-0 font-semibold text-lg" id="kit-review-title">
            Add the changelog page
          </h2>
          <p className="m-0 text-muted-foreground text-sm">
            The review's own pages fill this shell: the change, its comments, its release steps.
          </p>
        </div>
      </ZeropsReviewDialog>
    </>
  );
}

const JUMP_INDEX: SidebarJumpIndex = {
  mates: KIT_MENU_MATES.map((candidate, index) => ({
    projectId: candidate.project.id,
    name: candidate.project.name,
    tint: (["olive", "sky", "violet"] as const)[index] ?? "olive",
    shape: "squircle",
    face: "idle",
    projectName: "Acme Docs",
    subject: undefined,
    snippet: undefined,
    environmentId: undefined,
    connected: true,
    conversation: undefined,
    owner: undefined,
    pausedUntil: undefined,
    mine: true,
  })),
  projects: [{ groupId: "kit-docs", name: "Acme Docs", mates: 3 }],
  changes: [],
  stops: [],
};

const NO_READ_ONLY = new Set<string>();

function JumpBox({ onClose }: { readonly onClose: () => void }) {
  const state = useJumpBoxState();
  const model = useJumpBoxModel(state, JUMP_INDEX, [], NO_READ_ONLY);
  return (
    <JumpBoxView
      model={model}
      onChoose={onClose}
      onCommands={undefined}
      onSend={noop}
      searching={false}
      write={undefined}
    />
  );
}

function JumpBoxOpener() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)} variant="secondary">
        Jump to…
      </Button>
      <CommandDialog onOpenChange={setOpen} open={open}>
        <CommandDialogPopup aria-label="Jump to" data-command-palette="true">
          <JumpBox onClose={() => setOpen(false)} />
        </CommandDialogPopup>
      </CommandDialog>
    </>
  );
}

const FEN = KIT_MENU_MATES[0]!;

function MateMenuOpener() {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex w-64 items-center justify-between rounded-md border border-border bg-sidebar px-3 py-2 text-sidebar-foreground text-sm">
      <span>Fen</span>
      <MateMenu
        actions={kitMateActions(FEN)}
        apps={[]}
        at={undefined}
        name="Fen"
        onOpenChange={setOpen}
        onOpenMate={noop}
        onRename={noop}
        open={open}
        shortcuts
        unread={false}
      />
    </div>
  );
}

function CrewmateMenuOpener() {
  return (
    <Menu>
      <MenuTrigger render={<Button variant="secondary" />}>Ada ⌄</MenuTrigger>
      <CrewmateMenuPopup
        model={crewmateMenuModel({
          crewmate: { kind: "writer", jobFirstLine: "Builds the API", displayName: "Ada" },
          mateName: "Fen",
          tries: { where: "own", enabled: true, stops: false },
          busy: false,
        })}
        onSelect={noop}
      />
    </Menu>
  );
}

const WAITING = waitingItemsOf({
  mates: [
    {
      projectId: "kit-docs-quinn",
      name: "Quinn",
      tint: "sky",
      shape: "squircle",
      face: "needs",
      kind: "question",
      environmentId: "env-kit-docs-quinn",
      threadId: "thread-kit-docs-quinn",
      text: "Index the API pages too, or only the guides?",
    },
  ],
  releases: [{ groupId: "kit-docs", name: "Acme Docs", ahead: 2 }],
});

function WaitingOpener() {
  return (
    <SidebarProvider className="block min-h-0">
      <aside
        className="w-[435px] border border-border bg-sidebar text-sidebar-foreground"
        data-sidebar="sidebar"
      >
        <SidebarChromeHeader
          brand={
            <SidebarChiefRow
              current={false}
              onOpen={noop}
              waiting={{ items: WAITING, verbs: { onOpenMate: noop, onAskToFix: noop } }}
            />
          }
          isElectron={false}
        />
      </aside>
    </SidebarProvider>
  );
}

/**
 * A dialog whose step says less than the one before: it stays the height it was and where it was
 * (top-anchored, never re-centred), its button where the person saw it.
 */
function SteppingDialogOpener() {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);
  return (
    <Dialog
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setDone(false);
      }}
      open={open}
    >
      <Button onClick={() => setOpen(true)} variant="outline">
        Sign in a coding agent
      </Button>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>{done ? "Claude is signed in" : "Sign in Claude"}</DialogTitle>
          <DialogDescription>
            {done
              ? "Fen can work now."
              : "Open the sign-in page, approve Mate there, and paste the code it shows you back here. The code is good for ten minutes."}
          </DialogDescription>
        </DialogHeader>
        {done ? null : (
          <DialogPanel>
            <p className="m-0 text-muted-foreground text-sm">
              The sign-in page opens in a new tab; this dialog waits for its code.
            </p>
          </DialogPanel>
        )}
        <DialogFooter>
          {done ? (
            <Button onClick={() => setOpen(false)}>Done</Button>
          ) : (
            <Button onClick={() => setDone(true)}>Paste the code</Button>
          )}
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

function Chosen() {
  return (
    <SpecimenBlock title="Chosen · Dialog: top-anchored, never shrinks or re-centres while open; DialogMediaPopup for a picture">
      <SpecimenGrid>
        <Specimen label="<DialogPopup> whose step says less">
          <SteppingDialogOpener />
        </Specimen>
        <Specimen label="<DialogMediaPopup> (ExpandedImageDialog)">
          <ExpandedImageOpener />
        </Specimen>
      </SpecimenGrid>
    </SpecimenBlock>
  );
}

function Overlays() {
  return (
    <SpecimenGrid>
      <CensusSpecimen
        entry={{
          source: "apps/web/src/components/chat/ComposerPictureView.tsx",
          uses: 4,
          files: 3,
        }}
        label='<ComposerPictureView> · a hand-rolled role="dialog"'
      >
        <PictureViewOpener />
      </CensusSpecimen>
      <CensusSpecimen
        entry={{
          source: "apps/web/src/components/zerops/SidebarMateMenu.tsx",
          uses: 4,
          files: 1,
        }}
        label="<MateMenu> (and <ProjectMenu>): the menu's ··· on a row, on the kit's Menu"
      >
        <MateMenuOpener />
      </CensusSpecimen>
      <CensusSpecimen
        entry={{
          source: "apps/web/src/components/zerops/SidebarWaiting.tsx",
          uses: 3,
          files: 2,
        }}
        label="<SidebarWaitingPopover> · a raw Popover primitive, opened from the Chief's row"
      >
        <WaitingOpener />
      </CensusSpecimen>
      <CensusSpecimen
        entry={{
          source: "apps/web/src/components/zerops/crew/CrewmateMenu.tsx",
          uses: 2,
          files: 2,
        }}
        label="<CrewmateMenuPopup model> · a heading over the kit's Menu items"
      >
        <CrewmateMenuOpener />
      </CensusSpecimen>
      <CensusSpecimen
        entry={{ source: "apps/web/src/components/zerops/JumpBox.tsx", uses: 1, files: 1 }}
        label="<JumpBoxView> in the kit's <CommandDialogPopup>"
      >
        <JumpBoxOpener />
      </CensusSpecimen>
      <CensusSpecimen
        entry={{
          source: "apps/web/src/components/zerops/review/ZeropsReviewDialog.tsx",
          uses: 1,
          files: 1,
        }}
        label="<ZeropsReviewDialog> · a raw Dialog primitive (the review and release shell)"
      >
        <ReviewDialogOpener />
      </CensusSpecimen>
    </SpecimenGrid>
  );
}

export default defineKitSection({
  id: "home-made-overlays",
  title: "Overlays",
  purpose:
    "The kit's Dialog first; then the menus, popovers and dialogs still home-made, most used first.",
  group: "Home-made",
  kind: "Overlays",
  source: "apps/web/src/components",
  render: () => (
    <KitViewer>
      <div className="flex flex-col gap-10">
        <Chosen />
        <SpecimenBlock title="Still home-made">
          <Overlays />
        </SpecimenBlock>
      </div>
    </KitViewer>
  ),
});
