import { useAccountVoice } from "~/zerops/useAccountVoice";

import { SidebarAccountLine } from "./SidebarZeropsTree";

/** The account's one line (`useAccountVoice`) where it is placed: the menu's foot. */
export function AccountVoiceLine() {
  const voice = useAccountVoice();
  return (
    <div className="h-12 shrink-0">
      {voice === null ? null : (
        <SidebarAccountLine actions={voice.actions} sentence={voice.sentence} title={voice.title} />
      )}
    </div>
  );
}
