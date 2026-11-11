import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

import { SidebarChiefTop } from "./SidebarChiefTop";

// Keep the rail's tooltip content in the server-rendered tree.
vi.mock("../../ui/tooltip", () => ({
  Tooltip: ({ children }: { readonly children: ReactNode }) => children,
  TooltipPopup: ({ children }: { readonly children: ReactNode }) => children,
  TooltipTrigger: ({ children }: { readonly children: ReactNode }) => children,
}));

vi.mock("../SidebarZeropsTree", () => ({
  MenuMateLine: ({
    children,
  }: {
    readonly children: (read: {
      readonly face: "sleep";
      readonly unseen: boolean;
      readonly state: "idle";
      readonly second: { readonly kind: "coming" };
      readonly line: ReactNode;
    }) => ReactNode;
  }) =>
    children({
      face: "sleep",
      unseen: false,
      state: "idle",
      second: { kind: "coming" },
      line: <span>Setup awaiting evidence</span>,
    }),
}));

describe("the listed Chief's shared setup verdict", () => {
  it.each([false, true])(
    "The Chief renders its Mate row's setup verdict on the menu and rail: tile=%s",
    (tile) => {
      const html = renderToStaticMarkup(
        <SidebarChiefTop
          chief={{
            key: "chief",
            project: { id: "p-chief", name: "Chief", status: "ACTIVE", tagList: [] },
            group: "unavailable",
            missingContainer: true,
          }}
          coming={{ kind: "coming", line: "Setup awaiting evidence" }}
          conversationsRead={false}
          currentMate={false}
          currentPage={false}
          onOpenMate={() => {}}
          onOpenPage={() => {}}
          setup={null}
          tile={tile}
          timestampFormat="24-hour"
          waiting={undefined}
        />,
      );
      expect(html).toContain("Setup awaiting evidence");
      expect(html).not.toContain("Setting up stopped");
    },
  );
});
