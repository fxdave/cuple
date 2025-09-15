import { success } from "@cuple/server";
import assert from "assert";
import { describe, it } from "mocha";
import { z } from "zod";
import createClientAndServer from "../utils/createClientAndServer";
import { AbortError } from "node-fetch";

describe("Fetch options", () => {
  it("should work with AbortController", async () => {
    const cs = await createClientAndServer((builder) => ({
      exampleRoute: builder
        .querySchema(
          z.strictObject({
            name: z.string(),
          }),
        )
        .get(async ({ data }) => {
          return success({
            message: `Hi ${data.query.name}!`,
          });
        }),
    }));
    await cs.run(async (client) => {
      const controller = new AbortController();
      const newClient = client.with(() => ({
        query: {
          name: "David",
        },
      }));

      const responsePromise = newClient.exampleRoute.get({
        options: {
          signal: controller.signal,
        },
      });
      controller.abort();
      try {
        await responsePromise;
      } catch (e) {
        assert.ok(e instanceof DOMException && e.name == "AbortError");
      }
      assert.ok(false, "AbortError is expected");
    });
  });
});
