import { createClient } from "@cuple/client";
import type { routes } from "./example";

// Fake localstorage for testing
const storage: Record<string, string> = {};
const localStorage = {
  setItem: (k: string, v: string) => (storage[k] = v),
  getItem: (k: string) => storage[k],
};

const client = createClient<typeof routes>({
  path: "http://localhost:8080/rpc",
});

const authedClient = client.with(() => ({
  headers: {
    authorization: localStorage.getItem("token") || "nothing",
  },
}));

async function test() {
  console.log("BEFORE login getProfile(): ", await getProfile());
  console.log("BEFORE login changePassword(): ", await changePassword());
  localStorage.setItem("token", "sometoken");
  console.log("AFTER login getProfile(): ", await getProfile());
  console.log("AFTER login changePassword(): ", await changePassword());
}

async function getProfile() {
  return await authedClient.getProfile.get({});
}
async function changePassword() {
  return await authedClient.setUserPassword.post({
    body: {
      oldPassword: "something",
      password1: "newPass",
      password2: "newPass",
    },
  });
}

test();
