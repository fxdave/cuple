# REST-first RPC client for typescript client server

## Example Server

```ts
const builder = createBuilder(expressApp);

export const routes = {
  getPost: builder
    .path("/post/:id") // optional for REST compatibility
    .paramsSchema(
      z.object({
        id: z.string(),
      })
    )
    .get(async ({ data }) => {
      const post = await getPost(data.params.id);

      if (!post)
        return notFoundError({
          message: "Post is not found",
        });

      return success({
        post,
      });
    }),
};

initRpc(expressApp, {
  path: "/rpc",
  routes,
});
```

## Example Client

```ts
const client = createClient<typeof routes>({
  path: "http://localhost:8080/rpc",
});

async function getPost() {
  const response = await client.getPosts.get({});

  console.log(postsResponse.post); // type error

  if (response.result === "success") {
    console.log(postsResponse.post); // no type error
  }
}
```

## Other Examples

Check the ./examples for more.
