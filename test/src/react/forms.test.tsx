import { fetchCuple } from "@cuple/client";
import { Boundary, useAction, useGet } from "@cuple/react";
import { invalidInput, success } from "@cuple/server";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { type FieldPath, useForm } from "react-hook-form";
import { afterAll, beforeEach, expect, it, vi } from "vitest";
import { z } from "zod";
import { counter, renderAsync, serve, setup } from "./serve";

/** react-hook-form with a nested form, validated by the server. */
const calls = counter();
let contacts: { name: string; address: { zip: string } }[] = [];
const { client, close } = await serve((builder) => ({
  listContacts: builder.get(async () => {
    calls.hit("listContacts");
    return success({ names: contacts.map((c) => c.name) });
  }),
  createContact: builder
    .bodySchema(
      z.strictObject({
        name: z.string().min(1, "Enter a name."),
        address: z.strictObject({
          zip: z.string().regex(/^\d{4,5}$/, "A zip code is 4 or 5 digits."),
        }),
      }),
    )
    .post(async ({ data }) => {
      if (contacts.some((c) => c.name === data.body.name))
        return invalidInput("body", [
          { code: "custom", path: ["name"], message: "That name is taken." },
        ]);
      contacts.push(data.body);
      return success({});
    }),
}));
afterAll(close);
beforeEach(() => {
  contacts = [{ name: "Ada", address: { zip: "1234" } }];
  vi.spyOn(console, "error").mockImplementation(() => {});
});

type Values = { name: string; address: { zip: string } };
/** List fetches that had reached the server when `run` resolved, per submit. */
let fetchesWhenRunResolved: number[] = [];
/** Per render: react-hook-form's `isSubmitting`, and the action's status. */
let renders: { submitting: boolean; status: string }[] = [];

function ContactForm() {
  const form = useForm<Values>({ defaultValues: { name: "", address: { zip: "" } } });
  const save = useAction(
    async (values: Values) => {
      const response = await fetchCuple(client.createContact.post, {
        body: values,
      }).thenResolveAlso(["invalid-body"]);
      if (response.result === "invalid-body")
        for (const issue of response.issues)
          form.setError(issue.path.join(".") as FieldPath<Values>, {
            type: "server",
            message: issue.message,
          });
      return response;
    },
    { refresh: { success: [client.listContacts.get] } },
  );
  renders.push({ submitting: form.formState.isSubmitting, status: save.status });
  const { errors } = form.formState;
  return (
    <form
      aria-label="contact"
      onSubmit={form.handleSubmit(async (values) => {
        // After `run`, not inside the action: `reset` also clears
        // `isSubmitting`, which would end the submission before the refresh.
        const state = await save.run(values);
        fetchesWhenRunResolved.push(calls.of("listContacts"));
        if (state.value?.result === "success") form.reset();
      })}
    >
      <input aria-label="name" {...form.register("name")} />
      {errors.name && <p>{`name: ${errors.name.message}`}</p>}
      <input aria-label="zip" {...form.register("address.zip")} />
      {errors.address?.zip && <p>{`zip: ${errors.address.zip.message}`}</p>}
    </form>
  );
}

function Names() {
  const { names } = useGet(client.listContacts.get);
  return <p>{`names: ${names.join(", ")}`}</p>;
}

async function renderPage() {
  const { wrapper } = setup();
  renders = [];
  fetchesWhenRunResolved = [];
  await renderAsync(
    <Boundary fallback={<p>loading</p>}>
      <Names />
      <ContactForm />
    </Boundary>,
    { wrapper },
  );
  expect(await screen.findByText("names: Ada")).toBeDefined();
}

async function submit(values: { name: string; zip: string }) {
  fireEvent.change(screen.getByLabelText("name"), { target: { value: values.name } });
  fireEvent.change(screen.getByLabelText("zip"), { target: { value: values.zip } });
  await act(async () => {
    fireEvent.submit(screen.getByRole("form", { name: "contact" }));
  });
  // The whole submission is over: react-hook-form stopped submitting after
  // having started.
  await waitFor(() => {
    expect(renders.some((r) => r.submitting)).toBe(true);
    expect(renders.at(-1)?.submitting).toBe(false);
  });
}

it("puts the server's validation errors on the fields, nested ones included", async () => {
  await renderPage();
  const before = calls.of("listContacts");
  await submit({ name: "", zip: "12" });
  expect(await screen.findByText("name: Enter a name.")).toBeDefined();
  expect(screen.getByText("zip: A zip code is 4 or 5 digits.")).toBeDefined();
  // A failed save changed nothing, so nothing was refetched.
  expect(calls.of("listContacts")).toBe(before);
});

it("shows a rule only the server knows, the same way", async () => {
  await renderPage();
  await submit({ name: "Ada", zip: "4321" });
  expect(await screen.findByText("name: That name is taken.")).toBeDefined();
});

it("a successful save refreshes the list and resets the form", async () => {
  await renderPage();
  await submit({ name: "Grace", zip: "12345" });
  expect(await screen.findByText("names: Ada, Grace")).toBeDefined();
  expect((screen.getByLabelText("name") as HTMLInputElement).value).toBe("");
});

it("isSubmitting covers the whole save: run resolves only when it is done", async () => {
  await renderPage();
  const before = calls.of("listContacts");
  await submit({ name: "Grace", zip: "12345" });
  // The refresh it asked for was done by the time `run` resolved.
  expect(fetchesWhenRunResolved).toEqual([before + 1]);
  const started = renders.findIndex((r) => r.submitting);
  const afterwards = renders.slice(started).filter((r) => !r.submitting);
  expect(afterwards.length).toBeGreaterThan(0);
  // Never "not submitting" while the action is still running.
  expect(afterwards.every((r) => r.status !== "pending")).toBe(true);
});
