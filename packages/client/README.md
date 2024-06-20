# @cuple/client

Client side for @cuple RPC.

## Installation

```bash
npm i @cuple/client
```

NOTE: **@cuple/client** and **@cuple/server** versions have to match

## Example

```ts
import { createClient } from "@cuple/client";
import type { routes } from "../backend/src/app";

const client = createClient<typeof routes>({
  path: "http://localhost:8080/rpc",
});

async function changePassword() {
  const response = await authedClient.setUserPassword.post({
    body: {
      oldPassword: "something",
      password1: "newPass",
      password2: "newPass",
    },
  });

  console.log(response);
}

changePassword();
```

# API

## Feature 1: Calling procedures

```ts
// Server:
const routes = {
  foo: builder.get(/**/),
  bar: builder.post(/**/),
  baz: builder.put(/**/),
  patch: builder.patch(/**/),
  delete: builder.delete(/**/),
};

// Client:
await client.foo.get({});
await client.bar.post({});
await client.baz.put({});
await client.patch.patch({});
await client.delete.delete({});
```

### Parameters:

**body**: The request body  
**headers**: HTTP headers  
**params**: URL parameters (e.g.: in case of `/post/:id`, it can be `{ id: "1" }`)  
**query**: query parameters (e.g.: in case of `?id=2`, it can be `{ id: "2" }`)

Every parameter's type is defined based on the built request handler.

## Feature 2: Client chaining

```ts
const client = createClient<typeof routes>({
  path: "http://localhost:8080/rpc",
});

const authedClient = client.with(() => ({
  headers: {
    authorization: localStorage.getItem("token") || "nothing",
  },
}));

// GOOD:
await authedClient.getProfile.get({});

// THIS IS ALSO GOOD:
await client.getProfile.get({
  headers: {
    authorization: localStorage.getItem("token") || "nothing",
  },
});

// BAD EXAMPLE:
// Calling the handler which requires auth headers without auth headers cause type error:
await client.getProfile.get({}); // TYPE ERROR
```

`with` can handle async callbacks, which will be evaluated every time you make a request.
