# @cuple/server

Server side for @cuple RPC.

## Installation

```
npm i @cuple/server express zod
```

## Examlpe

```ts
import express from "express";
import { z } from "zod";
import { createBuilder, initRpc } from "@cuple/server";
import { apiResponse, success } from "@cuple/server";

const app = express();
const builder = createBuilder(app); // STEP 1: Create builder with the express instance

let lastId = 2;
const posts = [
  { id: 1, title: "Hi again", content: "This is my second post" },
  { id: 2, title: "Hi", content: "This is my first post" },
];

// STEP 2: Define some request handlers
export const routes = {
  getPosts: builder.get(async () => {
    return success({ posts });
  }),
  addPost: builder
    .bodySchema(
      z.object({
        title: z.string(),
        content: z.string(),
      })
    )
    .post(async ({ data }) => {
      lastId += 1;
      const newPost = { id: lastId, ...data.body };
      posts.push(newPost);
      return success({
        message: "The post has been created successfully",
        post: newPost,
      });
    }),
};

// STEP 3: Create the RPC handler (Required to use with @cuple/client)
initRpc(app, { path: "/rpc", routes });

app.listen(8080, () => {
  console.log(`Example app listening on port 8080`);
});

```

# API

## Feature 1: Basic handlers

```ts
builder.get(({ req, res, data }) => { /*...*/ });
builder.post(({ req, res, data }) => { /*...*/ });
builder.put(({ req, res, data }) => { /*...*/ });
builder.patch(({ req, res, data }) => { /*...*/ });
builder.delete(({ req, res, data }) => { /*...*/ });
```

## Feature 2: Schema parsers

It requires [zod](https://zod.dev/)

Example:

```ts
// server
builder
  .headersSchema(z.object({ authorization: z.string() }))
  .get(({ data }) => {
    console.log(data.headers.authorization);
  });
```

Variants:

```ts
// For HTTP headers
// NOTE: It has to use the same naming as req.headers
.headersSchema(z.object({ authorization: z.string() }))

// For HTTP request body parsing
.bodySchema(z.object({
    user: z.object({
        name: z.string().min(3),
        age: z.number()
    })
}))

// For URL query parsing (e.g.: ?somevar=12)
.querySchema(z.object({ "somevar": z.coerce.number() }))

// For URL params parsing
.path("/post/:id")
    .paramsSchema(z.object({ "id": z.coerce.number() }))
```

## Feature 3: Middlewares
NOTE: Check out Feature 4 as well.

```ts
builder
  .middleware(async () => {
    const randomValue = Math.random();
    if (randomValue > 0.5) return { next: true, randomValue };
    return { next: false, statusCode: 500, message: "Unlucky" };
  })
  .get(async ({ data }) => {
    return success({
      message: `You won visiting this page with ${data.randomValue}`,
    });
  });
```

## Feature 4: Chaining

```ts
const authLink = builder
  .headersSchema(
    z.object({
      authorization: z.string(),
    })
  )
  .middleware(async ({ data }) => {
    if (data.headers.authorization === "foo")
      return {
        next: true,
      };
    return {
      next: false,
      statusCode: 401 as const,
    };
  })
  .buildLink();
const routes = {
  getAuthedWelcomeMessage: builder.chain(authLink).get(async () => {
    return success({
      message: "hi",
    });
  }),
};
```

# Feature 5: Groups
```ts

const authModule = {
    login: /*...*/,
    register: /*...*/,
}

const postsModule = {
    getPost: /*...*/,
    getPosts: /*...*/,
    createPost: /*...*/,
    deletePost: /*...*/,
}

const app = {
    auth: authModule,
    posts: postsModule
}

export type Routes = typeof app;
```