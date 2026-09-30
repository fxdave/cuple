import { createClient } from "@cuple/client";
import { createCupleStore } from "@cuple/react";
import type { routes } from "../server/index";

export const ACCOUNTS = {
  ada: { name: "Ada", token: "token-ada" },
  linus: { name: "Linus", token: "token-linus" },
} as const;

export type AccountId = keyof typeof ACCOUNTS;

// #region client
let signedInAs: AccountId | null = null;

export const client = createClient<typeof routes>({ path: "/rpc" }).with({
  // Whose data a call is: each account's calls are cached under its own key.
  key: () => signedInAs ?? "signed-out",
  middleware: () => ({
    headers: { authorization: signedInAs ? ACCOUNTS[signedInAs].token : "" },
  }),
});

// #endregion

// #region store
/** The cache. One per app; plain code (sign-in, SSE handlers) uses it directly. */
export const store = createCupleStore();

/** What each write changes, in one place. Actions name these in `refresh`. */
export const refreshes = {
  notes: [client.getNotes, client.getNote],
  contacts: [client.listContacts, client.getContact],
};

// Switching accounts re-reads only what depends on the account: every call's
// key changed, so each reader reads again under the new one. The previous
// account's data is dropped at once (the default `onKeyChange: "drop"`): the
// next person at this screen may not be the same person.
export function signIn(accountId: AccountId) {
  signedInAs = accountId;
  store.refreshKeys();
}

// Signing out drops everything: nothing of the account stays in memory.
export function signOut() {
  signedInAs = null;
  store.clear();
}
// #endregion
