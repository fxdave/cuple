import express from "express";
import { z } from "zod";
import { createBuilder, initRpc } from "@cuple/server";
import { apiResponse, success, zodValidationError } from "@cuple/server";

const app = express();
app.use(express.json());
const builder = createBuilder(app);

const users = [
  { id: 1, name: "David", email: "some@thing.com", passwordHash: "something" },
];

const auth = builder
  .headersSchema(
    z.looseObject({
      authorization: z.string(),
    }),
  )
  .middleware(async ({ data }) => {
    if (data.headers["authorization"] == "sometoken")
      return {
        next: true,
        auth: {
          userId: 1,
        },
      };

    return {
      statusCode: 403 as const,
      next: false,
      message: "Access denied",
    };
  })
  .buildLink();

export const routes = {
  getProfile: builder.chain(auth).get(async ({ data }) => {
    const user = users.find((user) => user.id === data.auth.userId);
    if (!user)
      return apiResponse("notFound", 404, {
        message: "Your user has been deleted",
      });
    return success({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
      },
    });
  }),
  setUserPassword: builder
    .chain(auth)
    .bodySchema(
      z.strictObject({
        oldPassword: z.string(),
        password1: z.string().min(6),
        password2: z.string().min(6),
      }),
    )
    .post(async ({ data }) => {
      if (data.body.password1 !== data.body.password2) {
        return zodValidationError([
          {
            code: "custom",
            path: ["password2"],
            message: "Passwords do not match.",
          },
        ]);
      }

      const userIdx = users.findIndex((user) => user.id === data.auth.userId);
      if (userIdx === -1)
        return apiResponse("notFound", 404, {
          message: "Your user has been deleted",
        });

      users[userIdx].passwordHash = "NEW PASSWORD HASH";

      return success({
        message: "The password has been updated successfully!",
      });
    }),
};

initRpc(app, {
  path: "/rpc",
  routes,
});

app.listen(8080, () => {
  console.log(`Example app listening on port 8080`);
});
