import express from "express";
import { z } from "zod";
import { createBuilder } from "../src/server";
import { success, zodValidationError } from "../src/server/responses";

const app = express();
const builder = createBuilder(app);

const auth = builder
  .middleware(async ({ req }) => {
    if (req.headers["authorization"] == "sometoken")
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
  .buildLink();

const endpoints = {
  getUserEmail: builder
    .path("/user") // optional
    .chain(auth)
    .querySchema(
      z.object({
        id: z.coerce.number(),
      })
    )
    .get(async ({ data }) => {
      return success({
        message: "The user has been queried",
        userEmail: data.user.email,
      });
    }),
  setUserPassword: builder
    .path("/user") // optional
    .chain(auth)
    .bodySchema(
      z.object({
        oldPassword: z.string(),
        password1: z.string().min(6),
        password2: z.string().min(6),
      })
    )
    .post(async ({ data }) => {
      if (data.body.password1 !== data.body.password2) {
        return zodValidationError([
          {
            code: "custom",
            path: ["password2"],
            message: "Error. Passwords do not match.",
          },
        ]);
      }

      // ...  update user

      return success({
        message: "The password has been updated successfully!",
      });
    }),
};

app.listen(8080, () => {
  console.log(`Example app listening on port 8080`);
});
