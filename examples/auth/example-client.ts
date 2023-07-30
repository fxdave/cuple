import { createClient } from "../../src/client";
import type { routes } from "./example";

const client = createClient<typeof routes>({
  path: "http://localhost:8080/rpc",
});

async function test() {
  console.log("getProfile(): ", await getProfile());
  console.log("changePassword(): ", await changePassword());
}

async function getProfile() {
  return await client.getProfile.get({
    headers: {
      authorization: "sometoken",
    },
  });
}
async function changePassword() {
  return await client.setUserPassword.post({
    headers: {
      authorization: "sometoken",
    },
    body: {
      oldPassword: "something",
      password1: "newPass",
      password2: "newPass",
    },
  });
}

test();
