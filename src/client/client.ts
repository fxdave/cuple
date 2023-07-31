export function createClient<T extends RecursiveApi>(config: { path: string }) {
  return createPathBuilder<T>(config.path, []);
}

type RecursiveApi = {
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

type UndefinedProperties<T extends object> = {
  [Key in keyof T]-?: undefined extends T[Key] ? Key : never;
}[keyof T];

type WithoutUndefinedProperties<T extends object> = Pick<
  T,
  Exclude<keyof T, UndefinedProperties<T>>
>;

type OmitSameProps<TA, TB> = WithoutUndefinedProperties<{
  [K in keyof TA]: K extends keyof TB
    ? TB[K] extends TA[K]
      ? undefined
      : WithoutUndefinedProperties<OmitSameProps<TA[K], TB[K]>>
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

type Client<TApi extends RecursiveApi, TPreloadedData = {}> = WithPreloadedData<
  TApi,
  TPreloadedData
> &
  ({} extends TPreloadedData
    ? {
        with: <TParamsNext>(
          middleware: () => TParamsNext
        ) => Client<TApi, TParamsNext>;
      }
    : {});

function createPathBuilder<TApi extends RecursiveApi, TParams = {}>(
  path: string,
  segments: string[],
  preloader?: () => TParams
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
      const data = JSON.stringify({
        segments,
        argument: {
          ...(preloader !== undefined ? preloader() : {}),
          ...argumentsList[0],
        },
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
