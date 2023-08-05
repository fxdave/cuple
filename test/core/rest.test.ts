import assert from "assert";
import { describe, it } from "mocha";
import { z } from "zod";
import { success } from "../../src/server/responses";
import createClientAndServer from "../utils/createClientAndServer";

describe("REST", () => {
  it("should bind the specified path", async () => {
    const cs = await createClientAndServer((builder) => ({
      getPost: builder
        .path("/api/posts/:id")
        .paramsSchema(
          z.object({
            id: z.coerce.number(),
          })
        )
        .get(async ({ data }) => {
          return success({
            post: { id: data.params.id },
          });
        }),
    }));
    await cs.run(async () => {
      const response = await fetch("http://localhost:8080/api/posts/12");
      const result = await response.json();
      assert.equal(result.post.id, 12);
    });
  });
});
