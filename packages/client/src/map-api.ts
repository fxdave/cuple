/** Exclude data set with `.with()` for the whole API  */
export type MapApi<TApi, TPreloadedData> = {
  [Key in keyof TApi]: TApi[Key] extends (arg: infer IArg) => infer IReturn
    ? (arg: IncludeClientParams<ExcludePreloadedParams<IArg, TPreloadedData>>) => IReturn
    : MapApi<TApi[Key], TPreloadedData>;
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
  [K in keyof T]?: T[K] extends object ? RecursivePartial<T[K]> : T[K];
};
type NonEmptyKeys<T> = {
  [Key in keyof T]-?: [T[Key]] extends [undefined | never] ? never : Key;
}[keyof T];
type WithoutEmptyProperties<T> = Pick<T, NonEmptyKeys<T>>;
