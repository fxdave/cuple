import express from "express";
import { z } from "zod";
import { createBuilder } from "./express-typesharing";
import { success, zodValidationError } from "./express-typesharing-responses";

const app = express();
const builder = createBuilder(app);

const auth = builder
  .middleware(({ req }) => {
    if (req.headers["Authorization"] == "sometoken")
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
  .build();

const endpoints = {
  getUserEmail: builder
    .path("/user")
    .chain(auth)
    .body_schema(
      z.object({
        id: z.number(),
      })
    )
    .get(({ data }) => {
      return success({
        message: "The use has been queried",
        userEmail: data.user.email,
      });
    })
    .build(),
  setUserPassword: builder
    .chain(auth)
    .body_schema(
      z.object({
        oldPassword: z.string(),
        password1: z.string().min(6),
        password2: z.string().min(6),
      })
    )
    .post(({ data }) => {
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
    })
    .build(),
};
