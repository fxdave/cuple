import { fetchCuple } from "@cuple/client";
import { buffer, success } from "@cuple/server";
import { assert, describe, it } from "vitest";
import createClientAndServer from "../utils/createClientAndServer";

describe("Upload", () => {
  it("should upload a file", async () => {
    const cs = await createClientAndServer((builder) => ({
      foo: builder.rawBody(buffer()).post(async ({ data }) => {
        return success({
          size: data.body.length,
        });
      }),
    }));
    await cs.run(async (client) => {
      const response = await fetchCuple(client.foo.post, {
        body: Buffer.from([0x62, 0x75, 0x66, 0x66, 0x65, 0x72]),
      }).thenResolveOn(["success"]);
      if (response.result !== "success") assert.ok(false);
      assert.equal(response.size, 6);
    });
  });
});
