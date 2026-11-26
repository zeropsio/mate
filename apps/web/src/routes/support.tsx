import { supportEntry, type SupportEntry } from "@t3tools/client-runtime/data";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { Text } from "../components/ui/text";
import { useOfficialHq } from "../zerops/accountHq";
import { resolveDoor } from "./-door";
import { loadDoorEnvironmentCount } from "./-doorEnvironments";

export const Route = createFileRoute("/support")({
  beforeLoad: async ({ context, location }) => {
    const door = resolveDoor(context.authGateState, {
      pathname: location.pathname,
      environmentCount: await loadDoorEnvironmentCount(),
    });
    if (door.redirect !== null) {
      throw redirect({ to: door.redirect, replace: true });
    }
  },
  component: SupportPage,
});

type OfficialHq = NonNullable<ReturnType<typeof useOfficialHq>>;
type SupportStatus = "opening" | Exclude<SupportEntry["kind"], "go">;

function SupportPage() {
  const hq = useOfficialHq();
  const requested = useRef(false);
  const request = useRef<{
    readonly hq: OfficialHq;
    readonly answer: Promise<SupportEntry>;
  } | null>(null);
  const [status, setStatus] = useState<SupportStatus>("opening");

  useEffect(() => {
    if (hq === null || hq.address.length === 0) return;
    if (!requested.current) {
      requested.current = true;
      request.current = { hq, answer: supportEntry(hq.api) };
    }
    const pending = request.current;
    if (pending === null) return;
    if (pending.hq.api !== hq.api || pending.hq.address !== hq.address) {
      request.current = null;
      setStatus("unavailable");
      return;
    }

    let active = true;
    void pending.answer.then((entry) => {
      if (!active) return;
      request.current = null;
      if (entry.kind !== "go") {
        setStatus(entry.kind);
        return;
      }

      const form = document.createElement("form");
      form.method = "post";
      form.action = `${pending.hq.address.replace(/\/+$/u, "")}/operator/sign-in`;
      const input = document.createElement("input");
      input.type = "hidden";
      input.name = "exchange";
      input.value = entry.exchange;
      form.append(input);
      document.body.append(form);
      try {
        form.submit();
      } catch {
        setStatus("unavailable");
      } finally {
        form.remove();
      }
    });
    return () => {
      active = false;
    };
  }, [hq]);

  const line =
    hq === null || hq.address.length === 0 || status === "unavailable"
      ? "HQ did not answer. Reload to try again."
      : status === "denied"
        ? "This account has no support access."
        : status === "signed-out"
          ? "Sign in again to open the operator console."
          : "Opening the operator console…";

  return (
    <main className="flex min-h-0 min-w-0 flex-1 items-center justify-center p-6 text-center">
      <Text render={<p />} variant="description">
        {line}
      </Text>
    </main>
  );
}
