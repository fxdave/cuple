/** Exclude data set with `.with()` for the whole API  */
export type MapApi<TApi, TPreloadedData> = {
  [Key in keyof TApi]: TApi[Key] extends {
    tInput: infer TInput;
    tMethod: infer TMethod extends string;
  }
    ? AlterEndpoint<TApi[Key], TInput, TMethod, TPreloadedData>
    : MapApi<TApi[Key], TPreloadedData>;
};

type AlterEndpoint<TEndpoint, TInput, TMethod extends string, TPreloadedData> = {
  [K in TMethod]: Prettify<
    Omit<TEndpoint, "tInput" | "_handler" | "_method"> & {
      tInput: Prettify<
        IncludeClientParams<ExcludePreloadedParams<TInput, TPreloadedData>>
      >;
      clientProps: ClientProps;
    }
  >;
};

type Prettify<T> = {
  [K in keyof T]: T[K];
} & {};

export type ClientProps = {
  method: any;
  segments: any;
  path: any;
  /**
   * Runs before every request, set by `client.with({ middleware })`. What it
   * returns is merged into the request data.
   */
  middleware?: () => any;
  /**
   * Identifies the principal this client acts as, set by `client.with({ key })`.
   * Cache integrations put it in the cache key so one user's responses are never
   * served to another. Either a string or a *synchronous* getter — the key has to
   * be buildable during render, before any request runs.
   */
  key?: string | (() => string);
};

/** Include client-only params */
type IncludeClientParams<T> = T & {
  /** Overwite default fetch options */
  options?: RequestInit;
};

/** Exclude data set with `.with()` for an object  */
type ExcludePreloadedParams<TFrom, TPreloadedData> = OmitSameProps<
  TFrom,
  TPreloadedData
> &
  RecursivePartial<TPreloadedData>;
type OmitSameProps<TA, TB> = WithoutEmptyProperties<{
  [K in keyof TA]: [K] extends [keyof TB]
    ? [TB[K]] extends [TA[K]]
      ? undefined
      : WithoutEmptyProperties<OmitSameProps<TA[K], TB[K]>>
    : TA[K];
}>;
type RecursivePartial<T> = {
  [K in keyof T]?: T[K] extends object ? Prettify<RecursivePartial<T[K]>> : T[K];
};
type NonEmptyKeys<T> = {
  [Key in keyof T]-?: [T[Key]] extends [undefined | never] ? never : Key;
}[keyof T];
type WithoutEmptyProperties<T> = Pick<T, NonEmptyKeys<T>>;
