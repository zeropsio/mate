import { type ReactNode } from "react";

import { RIGHT_PANEL_SHEET_CLASS_NAME } from "../rightPanelLayout";
import { Sheet, SheetDescription, SheetHeader, SheetPopup, SheetTitle } from "./ui/sheet";

export function RightPanelSheet(props: {
  children: ReactNode;
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Sheet
      open={props.open}
      onOpenChange={(open) => {
        if (!open) {
          props.onClose();
        }
      }}
    >
      <SheetPopup
        side="right"
        showCloseButton={false}
        keepMounted
        className={RIGHT_PANEL_SHEET_CLASS_NAME}
      >
        <SheetHeader className="sr-only">
          <SheetTitle>Right panel</SheetTitle>
          <SheetDescription>Displays project tools and details.</SheetDescription>
        </SheetHeader>
        {props.children}
      </SheetPopup>
    </Sheet>
  );
}
