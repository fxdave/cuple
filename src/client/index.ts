export function createClient<T extends RecursiveApi>(config: { path: string }) {
  return createPathBuilder<T>(config.path, []);
}

type RecursiveApi = {
  [Key in string]: ((...props: any[]) => any) | RecursiveApi;
};

function createPathBuilder<TApi extends RecursiveApi>(
  path: string,
  segments: string[]
): TApi {
  return new Proxy<TApi>((() => false) as unknown as TApi, {
    get(_target, name, _receiver) {
      console.log(name);

      return createPathBuilder(path, [...segments, name as string]);
    },
    apply(target, thisArg, argumentsList) {
      return fetch(path, {
        body: JSON.stringify({
          segments,
          params: argumentsList[0],
        }),
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
      }).then((response) => response.json());
    },
  });
}
