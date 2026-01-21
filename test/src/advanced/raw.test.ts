import assert from "assert";
import { describe, it } from "vitest";
import { success } from "@cuple/server";
import { fetchCuple } from "@cuple/client";
import createClientAndServer from "../utils/createClientAndServer";

describe("raw handlers", () => {
  it("should work along with normal handlers", async () => {
    const cs = await createClientAndServer((builder) => ({
      testRaw: builder.path("/test").getRaw(async ({ req, res }) => {
        res.status(200).send("text-response");
      }),
      testNormal: builder.get(async () => {
        return success({});
      }),
    }));
    await cs.run(async (client, url) => {
      const response = await fetch(`${url}/test`);
      assert.equal(response.status, 200);
      const text = await response.text();
      assert.equal(text, "text-response");

      const normalRequest = await fetchCuple(client.testNormal.get, {});
      assert.equal(normalRequest.result, "success");
    });
  });

  it("should get middleware data", async () => {
    const cs = await createClientAndServer((builder) => ({
      testRaw: builder
        .path("/test")
        .middleware(async () => {
          return {
            next: true,
            foo: "hello",
          };
        })
        .getRaw(async ({ req, res, data }) => {
          res.status(200).send(data.foo);
        }),
    }));
    await cs.run(async (client, url) => {
      const response = await fetch(`${url}/test`);
      assert.equal(response.status, 200);
      const text = await response.text();
      assert.equal(text, "hello");
    });
  });

  it("should get middleware responses", async () => {
    const cs = await createClientAndServer((builder) => ({
      testRaw: builder
        .path("/test")
        .middleware(async () => {
          // eslint-disable-next-line no-constant-condition
          if (1 < 0.5)
            return {
              next: true,
              bar: "hey",
            };
          return {
            next: false,
            statusCode: 400,
            foo: "hello",
          };
        })
        .getRaw(async ({ req, res, data }) => {
          if (data.next === false) {
            res.status(data.statusCode).send(data.foo);
          } else {
            res.status(200).send(data.foo);
          }
        }),
    }));
    await cs.run(async (client, url) => {
      const response = await fetch(`${url}/test`);
      assert.equal(response.status, 400);
      const text = await response.text();
      assert.equal(text, "hello");
    });
  });

  /**
   * Technically this works with normal handlers,
   * but we need to use fetch so I keep it here
   */
  it("should handle binary file upload", async () => {
    const cs = await createClientAndServer((builder) => ({
      uploadFile: builder.path("/upload").post(async ({ req, res }) => {
        const buffer = await new Promise<Buffer>((resolve, reject) => {
          const chunks: Uint8Array[] = [];

          req.on("data", (chunk) => chunks.push(chunk));
          req.on("end", () => resolve(Buffer.concat(chunks)));
          req.on("error", reject);
        });

        return success({
          size: buffer.length,
        });
      }),
    }));

    await cs.run(async (client, url) => {
      // simulating a small image or file
      const binaryData = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

      const response = await fetch(`${url}/upload`, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: binaryData,
      });

      assert.equal(response.status, 200);
      const result = await response.json();
      assert.equal(result.size, binaryData.length);
    });
  });

  it("should stream upload progress with SSE", async () => {
    const cs = await createClientAndServer((builder) => ({
      uploadWithProgress: builder
        .path("/upload-progress")
        .postRaw(async ({ req, res }) => {
          res.setHeader("Content-Type", "text/event-stream");
          res.setHeader("Cache-Control", "no-cache");
          res.setHeader("Connection", "keep-alive");

          let bytesReceived = 0;

          req.on("data", (chunk) => {
            bytesReceived += chunk.length;
            res.write(`data: ${JSON.stringify({ progress: bytesReceived })}\n\n`);
          });

          req.on("end", () => {
            res.write(
              `data: ${JSON.stringify({ done: true, total: bytesReceived })}\n\n`,
            );
            res.end();
          });
        }),
    }));

    await cs.run(async (client, url) => {
      const binaryData = new Uint8Array(1024); // 1KB of data

      const response = await fetch(`${url}/upload-progress`, {
        method: "POST",
        body: binaryData,
      });

      assert.equal(response.status, 200);
      const text = await response.text();
      assert(text.includes('"progress"'));
      assert(text.includes('"done":true'));
    });
  });
});
