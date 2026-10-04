import { CupleTransportError, CupleUnexpectedResponseError } from "@cuple/client";
import {
  Boundary,
  type CupleError,
  combine,
  type ReadOptions,
  useGet,
} from "@cuple/react";
import { apiResponse, success } from "@cuple/server";
import { act, screen } from "@testing-library/react";
import { StrictMode, startTransition, useState } from "react";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { counter, renderAsync, serve, setup } from "./serve";

const calls = counter();
const { client, offline, close } = await serve((builder) => ({
  getProducts: builder.get(async () => {
    calls.hit("getProducts");
    return success({ products: ["apple", "pear"] });
  }),
  getOrder: builder.paramsSchema(z.object({ id: z.number() })).get(async ({ data }) => {
    calls.hit("getOrder");
    return data.params.id === 404
      ? apiResponse("not-found-error", 404, { message: "no such order" })
      : success({ order: { id: data.params.id, customerId: 7 } });
  }),
  getCustomer: builder
    .paramsSchema(z.object({ id: z.number() }))
    .get(async ({ data }) => {
      calls.hit("getCustomer");
      return success({ customer: { id: data.params.id, name: "Ada" } });
    }),
}));
afterAll(close);
beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {}); // React logs caught errors
});

function ShowError({ error }: { error: CupleError }) {
  return <p>{`caught ${error.kind}: ${error.message}`}</p>;
}

describe("useGet", () => {
  it("suspends on first load, then renders the success data", async () => {
    const { wrapper } = setup();
    function Products() {
      const { products } = useGet(client.getProducts.get);
      return <p>{products.join(", ")}</p>;
    }
    await renderAsync(
      <Boundary fallback={<p>loading</p>}>
        <Products />
      </Boundary>,
      { wrapper },
    );
    expect(screen.getByText("loading")).toBeDefined();
    expect(await screen.findByText("apple, pear")).toBeDefined();
  });

  it("fetches once for every reader of the same call", async () => {
    const { wrapper } = setup();
    const before = calls.of("getOrder");
    function Order({ label }: { label: string }) {
      const { order } = useGet(client.getOrder.get, { params: { id: 1 } });
      return <p>{`${label} ${order.id}`}</p>;
    }
    await renderAsync(
      <Boundary fallback={<p>loading</p>}>
        <Order label="a" />
        <Order label="b" />
      </Boundary>,
      { wrapper },
    );
    expect(await screen.findByText("a 1")).toBeDefined();
    expect(screen.getByText("b 1")).toBeDefined();
    expect(calls.of("getOrder") - before).toBe(1);
  });

  it("throws a non-success result to the boundary", async () => {
    const { wrapper } = setup();
    function Order() {
      useGet(client.getOrder.get, { params: { id: 404 } });
      return <p>rendered</p>;
    }
    await renderAsync(
      <Boundary fallback={<p>loading</p>} error={(error) => <ShowError error={error} />}>
        <Order />
      </Boundary>,
      { wrapper },
    );
    expect(await screen.findByText("caught response: no such order")).toBeDefined();
  });

  it("resolveAlso keeps the listed failures as typed values", async () => {
    const { wrapper } = setup();
    function Order() {
      const res = useGet(
        client.getOrder.get,
        { params: { id: 404 } },
        { resolveAlso: ["not-found-error"] },
      );
      if (res.result === "not-found-error") return <p>{`deleted: ${res.message}`}</p>;
      return <p>{`order ${res.order.id}`}</p>;
    }
    await renderAsync(
      <Boundary fallback={<p>loading</p>}>
        <Order />
      </Boundary>,
      { wrapper },
    );
    expect(await screen.findByText("deleted: no such order")).toBeDefined();
  });

  it("resolveOn is the complete list: success is not implied", async () => {
    const { wrapper } = setup();
    function Order() {
      useGet(
        client.getOrder.get,
        { params: { id: 1 } },
        { resolveOn: ["not-found-error"] },
      );
      return <p>rendered</p>;
    }
    await renderAsync(
      <Boundary fallback={<p>loading</p>} error={(error) => <ShowError error={error} />}>
        <Order />
      </Boundary>,
      { wrapper },
    );
    expect(await screen.findByText(/caught response/)).toBeDefined();
  });

  it("throws a transport failure on first load as CupleTransportError", async () => {
    const { wrapper } = setup();
    function Products() {
      useGet(offline.getProducts.get);
      return <p>rendered</p>;
    }
    await renderAsync(
      <Boundary fallback={<p>loading</p>} error={(error) => <ShowError error={error} />}>
        <Products />
      </Boundary>,
      { wrapper },
    );
    expect(await screen.findByText(/caught transport/)).toBeDefined();
  });

  it("resolveAlso can list transport-error: a network failure is a value to render", async () => {
    const { wrapper } = setup();
    function Products() {
      const res = useGet(offline.getProducts, undefined, {
        resolveAlso: ["transport-error"],
      });
      return (
        <p>{res.result === "transport-error" ? "offline" : res.products.join(", ")}</p>
      );
    }
    await renderAsync(
      <Boundary fallback={<p>loading</p>} error={(error) => <ShowError error={error} />}>
        <Products />
      </Boundary>,
      { wrapper },
    );
    expect(await screen.findByText("offline")).toBeDefined();
  });

  it("suspends again when the args change, and shows the new call's data", async () => {
    const { wrapper } = setup();
    let open!: (id: number) => void;
    function Pane() {
      const [id, setId] = useState(1);
      open = setId;
      return (
        <Boundary fallback={<p>loading</p>}>
          <Order id={id} />
        </Boundary>
      );
    }
    function Order({ id }: { id: number }) {
      const { order } = useGet(client.getOrder.get, { params: { id } });
      return <p>{`order ${order.id}`}</p>;
    }
    await renderAsync(<Pane />, { wrapper });
    expect(await screen.findByText("order 1")).toBeDefined();
    // Outside `act` on purpose: an awaited `act` would wait for the data,
    // and the fallback in between could not be observed.
    open(2);
    expect(await screen.findByText("loading")).toBeDefined();
    expect(await screen.findByText("order 2")).toBeDefined();
  });
});

describe("combine", () => {
  const loadOrderWithCustomer = combine({
    load: async ({ get }, id: number) => {
      const { order } = await get(client.getOrder.get, { params: { id } });
      const { customer } = await get(client.getCustomer.get, {
        params: { id: order.customerId },
      });
      return { order, customer };
    },
  });

  it("composes dependent fetches with await", async () => {
    const { wrapper } = setup();
    function Pane() {
      const { order, customer } = useGet(loadOrderWithCustomer, 3);
      return <p>{`#${order.id} for ${customer.name}`}</p>;
    }
    await renderAsync(
      <Boundary fallback={<p>loading</p>}>
        <Pane />
      </Boundary>,
      { wrapper },
    );
    expect(await screen.findByText("#3 for Ada")).toBeDefined();
  });

  it("shares its fetches with direct readers of the same call", async () => {
    const { wrapper } = setup();
    const before = calls.of("getOrder");
    function Pane() {
      const { customer } = useGet(loadOrderWithCustomer, 4);
      const { order } = useGet(client.getOrder.get, { params: { id: 4 } });
      return <p>{`#${order.id} for ${customer.name}`}</p>;
    }
    await renderAsync(
      <Boundary fallback={<p>loading</p>}>
        <Pane />
      </Boundary>,
      { wrapper },
    );
    expect(await screen.findByText("#4 for Ada")).toBeDefined();
    expect(calls.of("getOrder") - before).toBe(1);
  });

  it("get throws non-success results, so the combined read rejects to the boundary", async () => {
    const { wrapper } = setup();
    function Pane() {
      useGet(loadOrderWithCustomer, 404);
      return <p>rendered</p>;
    }
    await renderAsync(
      <Boundary fallback={<p>loading</p>} error={(error) => <ShowError error={error} />}>
        <Pane />
      </Boundary>,
      { wrapper },
    );
    expect(await screen.findByText("caught response: no such order")).toBeDefined();
  });
});

describe("types", () => {
  it("narrows reads to what the options allow", () => {
    type Read<T> = T extends (...args: never[]) => infer R ? R : never;
    const read = () => useGet(client.getOrder.get, { params: { id: 1 } });
    const readAlso = () =>
      useGet(
        client.getOrder.get,
        { params: { id: 1 } },
        { resolveAlso: ["not-found-error"] },
      );
    expect<Read<typeof read>["result"]>("success");
    expect<Read<typeof readAlso>["result"]>("not-found-error");
    // @ts-expect-error success-only reads never see a failure
    expect<Read<typeof read>["result"]>("not-found-error");
    // @ts-expect-error resolveAlso only accepts results the endpoint can return
    const unknownResult = { resolveAlso: ["nope"] } satisfies ReadOptions<
      typeof client.getOrder.get
    >;
    // @ts-expect-error resolveOn and resolveAlso are exclusive
    const both = { resolveOn: [], resolveAlso: [] } satisfies ReadOptions<
      typeof client.getOrder.get
    >;
    void [unknownResult, both];
    expect(CupleTransportError).toBeDefined();
    expect(CupleUnexpectedResponseError).toBeDefined();
  });
});

describe("React's rules for use()", () => {
  const misuse = /did not call use\(\) when it finished/;
  const logged = () =>
    vi.mocked(console.error).mock.calls.some((args) => misuse.test(String(args[0])));

  function Order({ id }: { id: number }) {
    const { order } = useGet(client.getOrder.get, { params: { id } });
    return <p>{`order ${order.id}`}</p>;
  }

  it("calls use() on every render, also once the data landed", async () => {
    const { wrapper } = setup();
    let show!: (id: number) => void;
    function Orders() {
      const [id, setId] = useState(1);
      show = (next) => startTransition(() => setId(next));
      return <Order id={id} />;
    }
    await renderAsync(
      <StrictMode>
        <Boundary fallback={<p>loading</p>}>
          <Orders />
        </Boundary>
      </StrictMode>,
      { wrapper },
    );
    expect(await screen.findByText("order 1")).toBeDefined();
    for (const id of [2, 3, 4, 5]) {
      await act(async () => show(id));
      expect(await screen.findByText(`order ${id}`)).toBeDefined();
    }
    expect(logged()).toBe(false);
  });
});
