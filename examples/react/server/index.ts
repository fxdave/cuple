import { EventEmitter, on } from "node:events";
import {
  apiResponse,
  createBuilder,
  initRpc,
  success,
  zodValidationError,
} from "@cuple/server";
import express from "express";
import { z } from "zod";

const app = express();
app.use(express.json());
const builder = createBuilder(app);

type Note = { id: number; author: string; text: string; createdAt: string };
type Activity = {
  id: number;
  action: "created" | "deleted";
  by: string;
  note: string;
};

const accounts: Record<string, { id: string; name: string }> = {
  "token-ada": { id: "ada", name: "Ada" },
  "token-linus": { id: "linus", name: "Linus" },
};

const notes: Note[] = Array.from({ length: 23 }, (_, i) => ({
  id: i + 1,
  author: i % 2 === 0 ? "ada" : "linus",
  text: `Seeded note #${i + 1}`,
  createdAt: new Date(Date.now() - i * 60_000).toISOString(),
}));

let nextId = notes.length + 1;

export type Contact = {
  id: number;
  owner: string;
  name: string;
  email: string;
  address: { street: string; city: string; zip: string };
};

const contacts: Contact[] = [
  {
    id: 1,
    owner: "ada",
    name: "Charles Babbage",
    email: "charles@engine.org",
    address: { street: "1 Dorset Street", city: "London", zip: "10001" },
  },
];
let nextContactId = 2;

/** The body of a create and an update. The server is the one that validates. */
const contactBody = z.strictObject({
  name: z.string().trim().min(1, "Enter a name."),
  email: z.email("Enter an email address like name@example.com."),
  address: z.strictObject({
    street: z.string().trim().min(1, "Enter a street."),
    city: z.string().trim().min(1, "Enter a city."),
    zip: z.string().regex(/^\d{4,5}$/, "A zip code is 4 or 5 digits."),
  }),
});

/** A rule only the server can check, reported like any other validation error. */
function emailTaken(owner: string, email: string, except?: number) {
  const taken = contacts.some(
    (c) => c.owner === owner && c.email === email && c.id !== except,
  );
  return taken
    ? zodValidationError([
        {
          code: "custom",
          path: ["email"],
          message: "You already have a contact with this email.",
        },
      ])
    : null;
}

/** Fan-out of activity events to every open SSE stream. */
class ActivityFeed {
  // One listener per connected client. The default cap of 10 is a leak
  // heuristic meant for emitters with a fixed set of listeners; here the count
  // legitimately tracks open connections, so raise it to the most this demo is
  // expected to serve rather than disabling the check.
  private readonly bus = new EventEmitter().setMaxListeners(MAX_SSE_CLIENTS);
  private nextEventId = 1;

  broadcast(event: Omit<Activity, "id">) {
    this.bus.emit("activity", { ...event, id: this.nextEventId++ } satisfies Activity);
  }

  /**
   * `on()` buffers events, and unsubscribes when `signal` aborts.
   *
   * The signal is what ends this stream: it is awaiting the next event, not
   * sitting on a `yield`, so nothing else can interrupt it.
   */
  async *stream(signal: AbortSignal): AsyncGenerator<Activity> {
    try {
      for await (const [event] of on(this.bus, "activity", { signal }))
        yield event as Activity;
    } catch (err) {
      if ((err as { name?: string }).name !== "AbortError") throw err;
    }
  }
}

/** Listeners above this are a bug, not a busy demo. */
const MAX_SSE_CLIENTS = 100;

const activityFeed = new ActivityFeed();

/** Artificial latency, so optimistic updates are visible. */
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const authed = builder
  .headersSchema(z.looseObject({ authorization: z.string() }))
  .middleware(async ({ data }) => {
    const account = accounts[data.headers.authorization];
    if (!account)
      return {
        next: false as const,
        ...apiResponse("unauthorized", 401, { message: "Sign in first" }),
      };
    return { next: true as const, account };
  })
  .buildLink();

export const routes = {
  me: builder.chain(authed).get(async ({ data }) => success({ account: data.account })),

  getNotes: builder
    .chain(authed)
    .querySchema(z.strictObject({ page: z.coerce.number().min(0) }))
    .get(async ({ data }) => {
      const perPage = 5;
      const mine = notes.filter((note) => note.author === data.account.id);
      const start = data.query.page * perPage;
      return success({
        page: data.query.page,
        notes: mine.slice(start, start + perPage),
        hasMore: start + perPage < mine.length,
        total: mine.length,
      });
    }),

  getNote: builder
    .chain(authed)
    .paramsSchema(z.strictObject({ id: z.coerce.number() }))
    .get(async ({ data }) => {
      const note = notes.find((n) => n.id === data.params.id);
      if (!note) return apiResponse("notFound", 404, { message: "No such note" });
      if (note.author !== data.account.id)
        return apiResponse("forbidden", 403, { message: "Not your note" });
      return success({ note });
    }),

  createNote: builder
    .chain(authed)
    .bodySchema(z.strictObject({ text: z.string().min(1).max(140) }))
    .post(async ({ data }) => {
      await delay(400);
      const note: Note = {
        id: nextId++,
        author: data.account.id,
        text: data.body.text,
        createdAt: new Date().toISOString(),
      };
      notes.unshift(note);
      activityFeed.broadcast({
        action: "created",
        by: data.account.name,
        note: note.text,
      });
      return success({ note });
    }),

  deleteNote: builder
    .chain(authed)
    .paramsSchema(z.strictObject({ id: z.coerce.number() }))
    .delete(async ({ data }) => {
      await delay(400);
      const index = notes.findIndex(
        (n) => n.id === data.params.id && n.author === data.account.id,
      );
      if (index === -1) return apiResponse("notFound", 404, { message: "No such note" });
      const [note] = notes.splice(index, 1);
      activityFeed.broadcast({
        action: "deleted",
        by: data.account.name,
        note: note.text,
      });
      return success({ id: note.id });
    }),

  listContacts: builder.chain(authed).get(async ({ data }) =>
    success({
      contacts: contacts
        .filter((c) => c.owner === data.account.id)
        .map(({ id, name, email }) => ({ id, name, email })),
    }),
  ),

  getContact: builder
    .chain(authed)
    .paramsSchema(z.strictObject({ id: z.coerce.number() }))
    .get(async ({ data }) => {
      const contact = contacts.find(
        (c) => c.id === data.params.id && c.owner === data.account.id,
      );
      if (!contact) return apiResponse("notFound", 404, { message: "No such contact" });
      return success({ contact });
    }),

  createContact: builder
    .chain(authed)
    .bodySchema(contactBody)
    .post(async ({ data }) => {
      await delay(400);
      const taken = emailTaken(data.account.id, data.body.email);
      if (taken) return taken;
      const contact: Contact = {
        id: nextContactId++,
        owner: data.account.id,
        ...data.body,
      };
      contacts.push(contact);
      return success({ contact });
    }),

  updateContact: builder
    .chain(authed)
    .paramsSchema(z.strictObject({ id: z.coerce.number() }))
    .bodySchema(contactBody)
    .put(async ({ data }) => {
      await delay(400);
      const contact = contacts.find(
        (c) => c.id === data.params.id && c.owner === data.account.id,
      );
      if (!contact) return apiResponse("notFound", 404, { message: "No such contact" });
      const taken = emailTaken(data.account.id, data.body.email, contact.id);
      if (taken) return taken;
      Object.assign(contact, data.body);
      return success({ contact });
    }),

  importContacts: builder.chain(authed).post(async ({ data }) => {
    // Slow on purpose: a bulk step the user has to wait for.
    await delay(1500);
    const samples = [
      { name: "Grace Hopper", email: "grace@navy.mil" },
      { name: "Alan Turing", email: "alan@bletchley.uk" },
    ].filter(
      (s) => !contacts.some((c) => c.owner === data.account.id && c.email === s.email),
    );
    for (const sample of samples) {
      contacts.push({
        id: nextContactId++,
        owner: data.account.id,
        ...sample,
        address: { street: "1 Main Street", city: "London", zip: "10001" },
      });
    }
    return success({ imported: samples.length });
  }),

  deleteContact: builder
    .chain(authed)
    .paramsSchema(z.strictObject({ id: z.coerce.number() }))
    .delete(async ({ data }) => {
      await delay(400);
      const index = contacts.findIndex(
        (c) => c.id === data.params.id && c.owner === data.account.id,
      );
      if (index === -1)
        return apiResponse("notFound", 404, { message: "No such contact" });
      contacts.splice(index, 1);
      return success({});
    }),

  activity: builder.getSSE(({ disconnectSignal }) =>
    activityFeed.stream(disconnectSignal),
  ),
};

initRpc(app, { path: "/rpc", routes });

const PORT = process.env.PORT ? Number(process.env.PORT) : 3001;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
