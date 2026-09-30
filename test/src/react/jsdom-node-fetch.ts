import { builtinEnvironments, type Environment } from "vitest/environments";

/**
 * jsdom, with Node's `AbortController` kept: Node's `fetch` rejects jsdom's
 * signals, and the hooks pass signals to `fetch`.
 */
export default (<Environment>{
  name: "jsdom-node-fetch",
  transformMode: "web",
  async setup(global, options) {
    const { AbortController, AbortSignal } = global;
    const env = await builtinEnvironments.jsdom.setup(global, options);
    Object.assign(global, { AbortController, AbortSignal });
    return env;
  },
});
