export function createClient<T extends RecursiveApi>(config: { path: string }) {
  return createPathBuilder<T>(config.path, []);
}

type RecursiveApi = {
  [Key in string]:
    | {
        get?: (...props: any[]) => any;
        post?: (...props: any[]) => any;
        put?: (...props: any[]) => any;
        patch?: (...props: any[]) => any;
        delete?: (...props: any[]) => any;
      }
    | RecursiveApi;
};

function createPathBuilder<TApi extends RecursiveApi>(
  path: string,
  segments: string[]
): TApi {
  return new Proxy<TApi>((() => false) as unknown as TApi, {
    get(_target, name, _receiver) {
      return createPathBuilder(path, [...segments, name as string]);
    },
    apply(target, thisArg, argumentsList: any[]) {
      const method = segments.pop();
      const data = JSON.stringify({
        segments,
        argument: argumentsList[0],
      });
      if (method === "get" || method === "delete") {
        const argument = new URLSearchParams({ data });
        return fetch(`${path}?${argument.toString()}`, {
          method: method,
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
        }).then((response) => response.json());
      }
      return fetch(path, {
        body: data,
        method: method,
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
      }).then((response) => response.json());
    },
  });
}
