# Testing as several Zerops accounts

For agents driving a browser test against a **dev build** of the web client (`vite dev`). A person
signs in through the Zerops app's hand-over; an agent skips that and injects a session it minted
itself.

## How a person signs in

- The client sends the tab to `{VITE_ZEROPS_APP_URL}/authorize-app` (default
  `https://app.zerops.io`) with `app=zerops-code`, its own `origin`, its base `path` and a per-tab
  nonce as `state`. Code:
  `packages/client-runtime/src/zerops/handover.ts`.
- The Zerops app checks the origin, mints a personal access token named
  `Zerops Code · <device> · <origin>`, and redirects to
  `<origin><path>/zerops/authorized#token=…&state=…`. The token has no refresh token and no expiry:
  it ends only when revoked in Settings › Token management.
- A 401 sends the tab back for a fresh hand-over and then returns it to the route it was on. A fresh
  token refused before a load verified it leaves the tab signed out (`apps/web/src/zerops/reauth.ts`).
- Sign-out only forgets the token locally. It never calls `/auth/logout`, which answers a personal
  token 200 and revokes nothing; the token stays in Settings › Token management.

## Signing a test page in

1. Run the web client with `vite dev`. The hook exists only there: a production bundle carries none
   of it (`apps/web/src/zerops/devHooks.test.ts`).
2. Export the accounts. Never commit them, never print them:

   ```sh
   export MATE_TEST_ACCOUNTS='[{"email":"…","password":"…"},{"email":"…","password":"…"}]'
   ```

   An entry says who, never what they may do. What an account may do is decided by its Zerops
   permissions alone, and what the agent should do with it is said in the task. The helper refuses
   an account with a second factor: use accounts without 2FA.

3. In the test (Playwright or Puppeteer: any page with `evaluate(fn, arg)`):

   ```ts
   import { signInAs } from "<repo>/apps/web/test/signInAs";

   const account = await signInAs(page, "someone@example.com");
   try {
     // … drive the page as that account …
   } finally {
     await account.logout(); // ends the session the helper minted
   }
   ```

   `signInAs` picks the entry by email (an email the list does not hold is a readable error), calls
   `POST /auth/login` and hands `{accessToken, refreshToken}` to
   `window.__mateDev.adoptSession`. The page then holds a full session that renews itself.

## Several accounts at once

- One page holds one account. To act as two people, open two browser contexts, each with its own
  storage, and call `signInAs` once in each.
- Calling `signInAs` again on the same page switches the account: the old account's view closes, as
  when a hand-over brings a different person.
- Each `signInAs` mints its own session (logins do not share one), so `logout()` on one leaves the
  others signed in.
