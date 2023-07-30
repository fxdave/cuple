import { createClient } from "../src/client";
import type { routes } from "./example3";

async function test() {
  const client = createClient<typeof routes>({
    path: "http://localhost:8080/rpc",
  });

  const response = await client.getPost.get({
    params: {
      id: 1,
    },
  });

  if (response.result === "success") {
    console.log(response.post);
  } else {
    console.error(response);
  }

  await client.deletePost.delete({
    params: {
      id: 1,
    },
  });



  const response2 = await client.getPost.get({
    params: {
      id: 1,
    },
  });

  if (response2.result === "success") {
    console.log(response2.post);
  } else {
    console.error(response2);
  }
}

test();
