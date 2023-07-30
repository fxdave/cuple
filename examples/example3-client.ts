import { createClient } from "../src/client";
import type { routes } from "./example3";

const client = createClient<typeof routes>({
  path: "http://localhost:8080/rpc",
});

async function test() {
  console.log("getPosts(): ", await getPosts());
  console.log("getPost(1): ", await getPost(1));
  console.log("deletePost(1): ", await deletePost(1));
  console.log("getPost(1): ", await getPost(1));
  const newPost = await addPost("Some Thing", "There's something.");
  console.log("newPost: ", newPost);
  console.log("getPost(newPost.post.id): ", await getPost(newPost.post.id));
}

async function getPosts() {
  return await client.getPosts.get({});
}

async function getPost(id: number) {
  return await client.getPost.get({
    params: {
      id,
    },
  });
}

async function deletePost(id: number) {
  return await client.deletePost.delete({
    params: {
      id,
    },
  });
}

async function addPost(title: string, content: string) {
  return await client.addPost.post({
    body: {
      content,
      title,
    },
  });
}

test();
