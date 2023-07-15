import { z } from "zod";
import { builder } from "./react-express-typesharing";

const endpoint = builder
  .path("/user")
  .chain(
    // auth middleware
    builder
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
      .build()
  )
  .middleware(({ req, data }) => {
    // Get user
    return {
      next: true,
      user: {
        id: 1,
        email: data.user.email,
        name: "David",
        password: "j2394i23huw",
      },
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
      userEmail: data.user.email,
    };
  })
  .build();
