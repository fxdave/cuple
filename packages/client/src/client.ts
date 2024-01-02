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

type NonEmptyKeys<T> = {
  [Key in keyof T]-?: [T[Key]] extends [undefined | never] ? never : Key;
}[keyof T];

type WithoutEmptyProperties<T> = Pick<T, NonEmptyKeys<T>>;

type OmitSameProps<TA, TB> = WithoutEmptyProperties<{
  [K in keyof TA]: [K] extends [keyof TB]
    ? [TB[K]] extends [TA[K]]
      ? undefined
      : WithoutEmptyProperties<OmitSameProps<TA[K], TB[K]>>
    : TA[K];
}>;

type RecursivePartial<T> = {
  [K in keyof T]?: T[K] extends object ? RecursivePartial<T[K]> : T[K];
};

type ExcludePreloadedParams<TFrom, TPreloadedData> = OmitSameProps<
  TFrom,
  TPreloadedData
> &
  RecursivePartial<TPreloadedData>;

type WithPreloadedData<TApi, TPreloadedData> = {
  [Key in keyof TApi]: TApi[Key] extends (arg: infer IArg) => infer IReturn
    ? (arg: ExcludePreloadedParams<IArg, TPreloadedData>) => IReturn
    : WithPreloadedData<TApi[Key], TPreloadedData>;
};

export type Client<
  TApi extends RecursiveApi,
  TPreloadedData = NonNullable<unknown>,
> = WithPreloadedData<TApi, TPreloadedData> &
  (NonNullable<unknown> extends TPreloadedData
    ? {
        with: <TParamsNext>(middleware: () => TParamsNext) => Client<TApi, TParamsNext>;
      }
    : NonNullable<unknown>);

function createPathBuilder<TApi extends RecursiveApi, TParams = NonNullable<unknown>>(
  path: string,
  segments: string[],
  preloader?: () => TParams,
): Client<TApi, TParams> {
  const target = (() => false) as unknown as Client<TApi, TParams>;

  target.with = <TParamsNext>(preloader: () => TParamsNext) => {
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
      const data = JSON.stringify({
        segments,
        argument: {
          ...(preloader !== undefined ? preloader() : {}),
          ...argumentsList[0],
        },
      });

      return methodAwareFetch(method, data, path).then(async (response) => {
        const res = await response.json();
        // TODO: differentiate data from response
        (res as any).statusCode = response.status;
        return res;
      });
    },
  });
}

async function methodAwareFetch(method: string, data: string, path: string) {
  if (method === "get" || method === "delete") {
    const argument = new URLSearchParams({ data });
    return await fetch(`${path}?${argument.toString()}`, {
      method: method.toUpperCase(),
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
    });
  }
  return await fetch(path, {
    body: data,
    method: method.toUpperCase(),
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
  });
}
