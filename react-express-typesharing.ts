import { z, ZodType } from "zod";
type ExpressRequest = any; // TODO
type ExpressResponse = any; // TODO
type MiddlewareProps<TData> = {
  data: TData;
  req: ExpressRequest;
  res: ExpressResponse;
};
type Middleware<TData, TResult> = (props: MiddlewareProps<TData>) => TResult;
type Endpoint<TResult> = (
  req: ExpressRequest,
  res: ExpressResponse
) => Promise<{
  statusCode: number;
  data: TResult;
}>;

/** Middlewares should include next, which tells the handler to continue */
type Next = { next: true | false };

const getBuilder = <A = unknown, Response = never>() => ({
  body_schema<TParser extends ZodType<any, any, any>>(body_parser: TParser) {
    const a = body_parser.parse({});
    return getBuilder<A & { body: z.infer<TParser> }, Response>();
  },
  middleware<B extends A, C extends Next>(mw: Middleware<B, C>) {
    return getBuilder<C & { next: true }, (C & { next: false }) | Response>();
  },
  get<B extends A, C>(mw: Middleware<B & { next: true }, C>) {
    return getBuilder<C, Response | C>();
  },

  // TODO infer possible responses
  build(): Endpoint<Response> {
    return async (req, res) => {
      return {
        statusCode: 200,
        data: {
          message: "Hi",
        } as unknown as Response, // TODO
      };
    };
  },
});
const builder = getBuilder();

const endpoint = builder
  .middleware(({ req }) => {
    if (req.headers["Authorization"] == "asd")
      return {
        next: true,
        user: {
          email: "asd@asd.hu",
        },
      };

    return {
      statusCode: 403 as const,
      next: false,
      message: "Access denied",
    };
  })
  .body_schema(
    z.object({
      name: z.string(),
    })
  )
  .get(({ data }) => {
    console.log(data.body.name);
    console.log(data.user.email);
    return {
      statusCode: 200 as const,
      message: "The use has been queried",
      userEmail: data.user.email
    };
  })
  .build();

const response = await endpoint(1, 1);

response.data.userEmail // o.O Oh nooo, userEmail is not in the type

if(response.data.statusCode === 200) {
  response.data.userEmail // Problem solved :)
}
