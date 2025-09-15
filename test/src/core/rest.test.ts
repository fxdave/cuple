import { describe, it, assert } from "vitest";
import { z } from "zod";
import { success } from "@cuple/server";
import createClientAndServer from "../utils/createClientAndServer";

describe("REST", () => {
  it("should bind the specified path", async () => {
    const cs = await createClientAndServer((builder) => ({
      getPost: builder
        .path("/api/posts/:id")
        .paramsSchema(
          z.strictObject({
            id: z.coerce.number(),
          }),
        )
        .get(async ({ data }) => {
          return success({
            post: { id: data.params.id },
          });
        }),
    }));
    await cs.run(async (_client, url) => {
      const response = await fetch(`${url}/api/posts/12`);
      const result = await response.json();
      assert.equal(result.post.id, 12);
    });
  });
});
