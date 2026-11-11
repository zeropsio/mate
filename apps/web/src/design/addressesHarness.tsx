/**
 * The addresses sheet over the window at the owner's size, from the board's sample world
 * (`addressesFixture.ts`): `?task=` opens it on a flow — `add` (Put it on your domain), `others`
 * (someone else's change waits), `own` (the project has its own IPv4). Writes are taken after
 * 600 ms and shown under way for 3 s; `?fail=1` refuses each. `?theme=dark` for dark.
 *
 * Served by the dev server at `/design-addresses.html`. Fixtures only: nothing here ships, and no
 * route imports this module.
 */
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";

import {
  addressTrouble,
  othersWaiting,
  withOwnWrites,
  writeKey,
  type AddressWrite,
} from "~/components/zerops/addresses/addresses.logic";
import { AddressesSheetBody } from "~/components/zerops/addresses/AddressesSheet";
import { ADDRESSES_FIXTURE } from "~/components/zerops/addresses/addressesFixture";
import { Dialog, DialogPopup } from "~/components/ui/dialog";
import { applyThemePalette, ZEROPS_THEME_ID } from "~/themePalette";
import "../index.css";

const params = new URLSearchParams(location.search);
const appearance = params.get("theme") === "dark" ? "dark" : "light";
const TASK = params.get("task") ?? "";
const FAIL = params.get("fail") === "1";

const WAITING =
  TASK === "others" ? [{ id: "rt-api", label: "api.shop.com → api · port 8080" }] : [];
const PLACE = {
  ...ADDRESSES_FIXTURE,
  ips: TASK === "own" ? { ...ADDRESSES_FIXTURE.ips, ownV4: "203.0.113.24" } : ADDRESSES_FIXTURE.ips,
  waitingDomains: WAITING,
  // `?task=empty`: production set up with nothing deployed there.
  nothingDeployed: TASK === "empty",
};

function Harness() {
  const [own, setOwn] = useState<ReadonlyArray<AddressWrite>>([]);
  const [trouble, setTrouble] = useState<ReadonlyMap<string, string>>(new Map());
  const onWrite = async (write: AddressWrite) => {
    await new Promise((resolve) => setTimeout(resolve, 600));
    if (FAIL) {
      setTrouble(
        new Map([
          [
            writeKey(write),
            addressTrouble("publicHttpRoutingDuplicateDomainNameInAnotherRouting", write)!,
          ],
        ]),
      );
      return false;
    }
    setOwn((was) => [...was, write]);
    setTimeout(() => setOwn((was) => was.filter((each) => each !== write)), 3_000);
    return true;
  };
  return (
    <Dialog onOpenChange={() => {}} open>
      <DialogPopup className="h-[min(55.5rem,100%)] max-w-[48.75rem]" showCloseButton={false}>
        <AddressesSheetBody
          busy={new Set(own.map(writeKey))}
          ipv4={{ state: "known", price: 3, enabled: false }}
          nowMs={Date.parse("2026-10-14T12:00:00Z")}
          onClose={() => {}}
          onPlace={() => {}}
          onWrite={onWrite}
          othersWaiting={{ domains: othersWaiting(WAITING, own), ports: [] }}
          place={withOwnWrites(PLACE, own)}
          placeName="Production"
          places={[
            { projectId: "p1", kind: "production", label: "Production", name: "Production" },
            { projectId: "p2", kind: "stage", label: "Stage", name: "Stage" },
            { projectId: "p3", kind: "mate", label: "Fen", name: "Fen", owner: "Karlos" },
          ]}
          projectId="p1"
          projectName="Shop"
          startAdding={TASK === "add"}
          trouble={trouble}
          unsure={new Set()}
          zeropsUrl="https://app.zerops.io/project/p1"
        />
      </DialogPopup>
    </Dialog>
  );
}

document.documentElement.classList.toggle("dark", appearance === "dark");
applyThemePalette(ZEROPS_THEME_ID, appearance);
createRoot(document.getElementById("design")!).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
);
