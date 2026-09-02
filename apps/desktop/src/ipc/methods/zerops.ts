import {
  DesktopZeropsSignInInputSchema,
  DesktopZeropsSignInResultSchema,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as DesktopZeropsSignIn from "../../zerops/DesktopZeropsSignIn.ts";
import * as IpcChannels from "../channels.ts";
import * as DesktopIpc from "../DesktopIpc.ts";

export const zeropsSignIn = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.ZEROPS_SIGN_IN_CHANNEL,
  payload: DesktopZeropsSignInInputSchema,
  result: DesktopZeropsSignInResultSchema,
  handler: Effect.fn("desktop.ipc.zerops.signIn")(function* (input) {
    const signIn = yield* DesktopZeropsSignIn.DesktopZeropsSignIn;
    return yield* signIn.signIn(input);
  }),
});
