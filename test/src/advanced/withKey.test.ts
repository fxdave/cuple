import {
  createClient,
  cupleEndpointKey,
  cupleRequestKey,
  fetchCuple,
} from "@cuple/client";
import { success } from "@cuple/server";
import { assert, describe, it } from "vitest";
import { z } from "zod";
import createClientAndServer from "../utils/createClientAndServer";

const routes = {} as never;

function plainClient() {
  return createClient<typeof routes>({ path: "/rpc" });
}

describe("client.with({ middleware, key })", () => {
  it("should accept the options form for request data", async () => {
    const cs = await createClientAndServer((builder) => ({
      exampleRoute: builder
        .querySchema(z.strictObject({ name: z.string() }))
        .get(async ({ data }) => success({ message: `Hi ${data.query.name}!` })),
    }));
    await cs.run(async (client) => {
      const newClient = client.with({
        middleware: async () => ({ query: { name: "David" } }),
      });

      const response = await fetchCuple(newClient.exampleRoute.get);
      assert.equal(response.message, "Hi David!");
    });
  });

  it("should run a synchronous middleware", async () => {
    const cs = await createClientAndServer((builder) => ({
      exampleRoute: builder
        .querySchema(z.strictObject({ name: z.string() }))
        .get(async ({ data }) => success({ message: `Hi ${data.query.name}!` })),
    }));
    await cs.run(async (client) => {
      const newClient = client.with({ middleware: () => ({ query: { name: "Sync" } }) });

      const response = await fetchCuple(newClient.exampleRoute.get);
      assert.equal(response.message, "Hi Sync!");
    });
  });

  it("should send requests with only a key set", async () => {
    const cs = await createClientAndServer((builder) => ({
      exampleRoute: builder.get(async () => success({ message: "ok" })),
    }));
    await cs.run(async (client) => {
      const keyed = client.with({ key: "user-1" });

      const response = await fetchCuple(keyed.exampleRoute.get);
      assert.equal(response.message, "ok");
      assert.equal(cupleRequestKey(keyed.exampleRoute.get, {})[1], "user-1");
    });
  });
});

describe("cupleEndpointKey", () => {
  it("should identify the route and ignore principal and options", () => {
    const base = plainClient();
    const anon = (base as any).getPosts.get;
    const keyed = (base.with({ key: "user-1" }) as any).getPosts.get;

    assert.equal(cupleEndpointKey(anon), cupleEndpointKey(keyed));
  });

  it("should differ per endpoint and per method", () => {
    const base = plainClient() as any;

    assert.notEqual(
      cupleEndpointKey(base.getPosts.get),
      cupleEndpointKey(base.getPost.get),
    );
    assert.notEqual(
      cupleEndpointKey(base.getPosts.get),
      cupleEndpointKey(base.getPosts.post),
    );
  });
});

describe("cupleRequestKey", () => {
  it("should separate two principals of the same endpoint", () => {
    const base = plainClient();
    const a = (base.with({ key: "user-1" }) as any).getPosts.get;
    const b = (base.with({ key: "user-2" }) as any).getPosts.get;

    assert.notDeepEqual(cupleRequestKey(a, {}), cupleRequestKey(b, {}));
  });

  it("should be stable for the same principal and options", () => {
    const client = plainClient().with({ key: "user-1" }) as any;

    assert.deepEqual(
      cupleRequestKey(client.getPosts.get, { params: { id: 1 } }),
      cupleRequestKey(client.getPosts.get, { params: { id: 1 } }),
    );
  });

  it("should read a key getter on every call, not once", () => {
    let uid = "user-1";
    const client = plainClient().with({ key: () => uid }) as any;

    const before = cupleRequestKey(client.getPosts.get, {});
    uid = "user-2";
    assert.notDeepEqual(before, cupleRequestKey(client.getPosts.get, {}));
  });

  it("should not change when only the injected credential changes", () => {
    let token = "token-1";
    const client = plainClient().with({
      key: "user-1",
      middleware: async () => ({ headers: { authorization: token } }),
    }) as any;

    const before = cupleRequestKey(client.getPosts.get, {});
    token = "token-2";
    assert.deepEqual(before, cupleRequestKey(client.getPosts.get, {}));
  });

  it("should be an empty principal without a key", () => {
    const client = plainClient() as any;

    assert.equal(cupleRequestKey(client.getPosts.get, {})[1], "");
  });

  it("should put the endpoint first, so one endpoint's calls match by its key", () => {
    const base = plainClient();
    const mine = (base.with({ key: "user-1" }) as any).getPosts.get;
    const theirs = (base.with({ key: "user-2" }) as any).getPosts.get;
    const other = (base as any).getPost.get;

    const endpointKey = cupleEndpointKey(mine);
    assert.equal(cupleRequestKey(theirs, { params: { id: 1 } })[0], endpointKey);
    assert.notEqual(cupleRequestKey(other, {})[0], endpointKey);
  });

  it("should keep a mutation key apart from any query key", () => {
    const client = plainClient().with({ key: "user-1" }) as any;

    assert.notDeepEqual(
      cupleRequestKey(client.createPost.post, "mutation"),
      cupleRequestKey(client.createPost.post, {}),
    );
  });
});
