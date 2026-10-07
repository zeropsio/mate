/** Ordered terminal byte streams stay in bounded renderer session buffers, outside account facts. */
import { type EnvironmentId, WS_METHODS } from "@t3tools/contracts";
import * as Stream from "effect/Stream";
import { Atom } from "effect/reactivity";
import type { EnvironmentRegistry } from "../../connection/registry.ts";
import { subscribe, type EnvironmentRpcInput } from "../../rpc/client.ts";
import { followStreamInEnvironment } from "../../state/runtime.ts";
import {
  applyTerminalAttachStreamEvent,
  nextTerminalAttachSeedState,
} from "../../state/terminalSession.ts";
export function makeTerminalByteAtoms<R, E>(runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>) {
  const attach = Atom.family((key: string) => {
    const [environmentId, input] = JSON.parse(key) as [
      EnvironmentId,
      EnvironmentRpcInput<typeof WS_METHODS.terminalAttach>,
    ];
    return runtime.atom(
      followStreamInEnvironment(
        environmentId,
        Stream.suspend(() =>
          subscribe(WS_METHODS.terminalAttach, input).pipe(
            Stream.scan(nextTerminalAttachSeedState, applyTerminalAttachStreamEvent),
          ),
        ),
      ),
    );
  });
  const events = Atom.family((key: string) => {
    const [environmentId, input] = JSON.parse(key) as [
      EnvironmentId,
      EnvironmentRpcInput<typeof WS_METHODS.subscribeTerminalEvents>,
    ];
    return runtime.atom(
      followStreamInEnvironment(
        environmentId,
        subscribe(WS_METHODS.subscribeTerminalEvents, input),
      ),
    );
  });
  return {
    attach: (target: {
      readonly environmentId: EnvironmentId;
      readonly input: EnvironmentRpcInput<typeof WS_METHODS.terminalAttach>;
    }) => attach(JSON.stringify([target.environmentId, target.input])),
    events: (target: {
      readonly environmentId: EnvironmentId;
      readonly input: EnvironmentRpcInput<typeof WS_METHODS.subscribeTerminalEvents>;
    }) => events(JSON.stringify([target.environmentId, target.input])),
  };
}
