import { MapApi } from "./map-api";

export function createClient<T extends RecursiveApi>(config: { path: string }) {
  return createPathBuilder<T>(config.path, []);
}

export type RecursiveApi = {
  [Key in string]:
    | {
        get?: (props: any) => any;
        post?: (props: any) => any;
        put?: (props: any) => any;
        patch?: (props: any) => any;
        delete?: (props: any) => any;
      }
    | RecursiveApi;
};

export type Client<
  TApi extends RecursiveApi,
  TPreloadedData = NonNullable<unknown>,
> = MapApi<TApi, TPreloadedData> &
  (NonNullable<unknown> extends TPreloadedData
    ? {
        with: <TParamsNext>(
          middleware: () => Promise<TParamsNext> | TParamsNext,
        ) => Client<TApi, TParamsNext>;
      }
    : NonNullable<unknown>);

function createPathBuilder<TApi extends RecursiveApi, TParams = NonNullable<unknown>>(
  path: string,
  segments: string[],
  preloader?: () => Promise<TParams> | TParams,
): Client<TApi, TParams> {
  const target = (() => false) as unknown as Client<TApi, TParams>;

  target.with = <TParamsNext>(preloader: () => Promise<TParamsNext> | TParamsNext) => {
    return createPathBuilder<TApi, TParamsNext>(path, [], preloader);
  };

  return new Proxy<Client<TApi, TParams>>(target, {
    get(_target, name, _receiver) {
      return createPathBuilder(path, [...segments, name as string], preloader);
    },
    apply(target, thisArg, argumentsList: any[]) {
      if (segments[0] === "with" && preloader === undefined) {
        return (target as any).with(argumentsList[0]);
      }

      const method = segments.pop();
      if (!method) throw new Error("Couldn't parse RPC request, method is required");
      const getData = async () => {
        return {
          segments,
          argument: {
            ...(preloader !== undefined ? await preloader() : {}),
            ...argumentsList[0],
          },
        };
      };

      return methodAwareFetch(method, getData, path, argumentsList[0]?.options).then(
        async (response) => {
          const res = await response.json();
          // TODO: differentiate data from response
          (res as any).statusCode = response.status;
          return res;
        },
      );
    },
  });
}

async function methodAwareFetch(
  method: string,
  getData: () => Promise<{ segments: string[]; argument: Record<string, unknown> }>,
  path: string,
  options?: RequestInit,
) {
  const {
    segments,
    argument: { headers, ...argument },
  } = await getData();
  const data = JSON.stringify({ segments, argument });
  if (method === "get" || method === "delete") {
    const argument = new URLSearchParams({ data });
    return await fetch(`${path}?${argument.toString()}`, {
      method: method.toUpperCase(),
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(typeof headers === "object" ? headers : {}),
      },
      ...options,
    });
  }
  return await fetch(path, {
    body: data,
    method: method.toUpperCase(),
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(typeof headers === "object" ? headers : {}),
    },
    ...options,
  });
}
