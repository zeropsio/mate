# Testing as several Zerops accounts

For agents driving a browser test against a **dev build** of the web client (`vite dev`). A person
signs in through the Zerops app's hand-over; an agent skips that and injects a session it minted
itself.

## How a person signs in

- The client sends the tab to `{VITE_ZEROPS_APP_URL}/authorize-app` (default
  `https://app.zerops.io`) with `app=zerops-code`, its own `origin`, its base `path`, a per-tab
  `nonce` and, for a dev instance, `project` (`VITE_MATE_SIGNIN_PROJECT`). Code:
  `packages/client-runtime/src/zerops/handover.ts`.
- The Zerops app checks the origin and redirects to `<origin><path>/zerops/authorized#token=…&nonce=…`.
  The token is the access token of that app's own session: no refresh token, valid up to five days,
  dead when app.zerops.io logs out or refreshes.
- A 401 sends the tab back for a fresh hand-over and then returns it to the route it was on. A fresh
  token refused before a load verified it leaves the tab signed out (`apps/web/src/zerops/reauth.ts`).
- Sign-out only forgets the token locally. It never calls `/auth/logout`, because that would sign
  the person out of the Zerops app too.
- **Transition, until the new Zerops app is live on app.zerops.io:** the request also carries the
  old `state` (the same nonce) and, on `localhost`, `port`. The client also accepts the old
  `#token=…&state=…` return, which carries a personal token. Every such line is marked
  `TRANSITION` in code and goes once the new app is live.

## Signing a test page in

1. Run the web client with `vite dev`. The hook exists only there: a production bundle carries none
   of it (`apps/web/src/zerops/devHooks.test.ts`).
2. Export the accounts. Never commit them, never print them:

   ```sh
   export MATE_TEST_ACCOUNTS='[{"name":"owner","email":"…","password":"…","writes":true},
                               {"name":"guest","email":"…","password":"…","writes":false}]'
   ```

   `writes: false` marks an account a test may only read as. The helper refuses an account with a
   second factor: use accounts without 2FA.

3. In the test (Playwright or Puppeteer: any page with `evaluate(fn, arg)`):

   ```ts
   import { signInAs } from "<repo>/apps/web/test/signInAs";

   const owner = await signInAs(page, "owner");
   try {
     // … drive the page as owner …
   } finally {
     await owner.logout(); // ends the session the helper minted
   }
   ```

   `signInAs` calls `POST /auth/login` and hands `{accessToken, refreshToken}` to
   `window.__mateDev.adoptSession`. The page then holds a full session that renews itself.

## Several accounts at once

- One page holds one account. To act as two people, open two browser contexts, each with its own
  storage, and call `signInAs` once in each.
- Calling `signInAs` again on the same page switches the account: the old account's view closes, as
  when a hand-over brings a different person.
- Each `signInAs` mints its own session (logins do not share one), so `logout()` on one leaves the
  others signed in.
