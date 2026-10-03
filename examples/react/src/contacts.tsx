import { fetchCuple } from "@cuple/client";
import { Boundary, useAction, useGet } from "@cuple/react";
import { useId, useState } from "react";
import {
  type FieldPath,
  type FieldValues,
  type UseFormReturn,
  useForm,
} from "react-hook-form";
import { client, refreshes } from "./client";
import { BusyButton, RowsSkeleton, Skeleton } from "./loading";

type ContactValues = {
  name: string;
  email: string;
  address: { street: string; city: string; zip: string };
};

const emptyContact: ContactValues = {
  name: "",
  email: "",
  address: { street: "", city: "", zip: "" },
};

type ServerIssue = { path: (string | number)[]; message: string };

/**
 * What a save returns: the outcomes the form handles itself. Anything else
 * (a 500, a bug) is unhandled: shown with `errors.notify`, and the form stays.
 */
type SaveResult =
  | { result: "success" }
  | { result: "validation-error"; issues: ServerIssue[] }
  | { result: "transport-error"; message: string };

// #region contacts
export function Contacts() {
  // null: nothing open. "new": the create form. A number: that contact's edit form.
  const [editing, setEditing] = useState<number | "new" | null>(null);

  return (
    <>
      <section>
        <div className="row">
          <h2 className="grow">Contacts</h2>
          <ImportSamples />
          <button type="button" onClick={() => setEditing("new")}>
            New contact
          </button>
        </div>
        <Boundary fallback={<RowsSkeleton rows={3} />}>
          <ContactList
            onEdit={setEditing}
            onDeleted={(id) => setEditing((open) => (open === id ? null : open))}
          />
        </Boundary>
      </section>

      {editing === "new" && <NewContact onDone={() => setEditing(null)} />}
      {typeof editing === "number" && (
        // `key`: another contact is a different form, with fresh state.
        <Boundary key={editing} fallback={<FormSkeleton />}>
          <EditContact id={editing} onDone={() => setEditing(null)} />
        </Boundary>
      )}
    </>
  );
}
// #endregion

// #region import-samples
/** A bulk step the user must wait for: blocks the page while it runs. */
function ImportSamples() {
  const importSamples = useAction(() => fetchCuple(client.importContacts.post), {
    refresh: refreshes.contacts,
    config: { loading: { blocking: true }, errors: { onError: "notify" } },
  });
  return (
    <button type="button" onClick={() => importSamples.run()}>
      Import sample contacts
    </button>
  );
}
// #endregion

function ContactList(props: {
  onEdit: (id: number) => void;
  onDeleted: (id: number) => void;
}) {
  const { contacts } = useGet(client.listContacts);
  if (contacts.length === 0)
    return <p className="muted">No contacts yet. Add the first one.</p>;
  return (
    <ul>
      {contacts.map((contact) => (
        <ContactRow key={contact.id} contact={contact} {...props} />
      ))}
    </ul>
  );
}

// #region contact-row
function ContactRow(props: {
  contact: { id: number; name: string; email: string };
  onEdit: (id: number) => void;
  onDeleted: (id: number) => void;
}) {
  const remove = useAction(
    async () => {
      await fetchCuple(client.deleteContact.delete, {
        params: { id: props.contact.id },
      });
      props.onDeleted(props.contact.id); // close its form if it's open
    },
    { refresh: refreshes.contacts, config: { errors: { onError: "notify" } } },
  );

  return (
    <li className={remove.isPending ? "row pending" : "row"} aria-busy={remove.isPending}>
      <span className="grow">
        {props.contact.name} <span className="muted">{props.contact.email}</span>
      </span>
      <button type="button" onClick={() => props.onEdit(props.contact.id)}>
        Edit
      </button>
      <BusyButton
        busy={remove.isPending}
        busyLabel="Deleting"
        onClick={() => remove.run()}
      >
        Delete
      </BusyButton>
    </li>
  );
}
// #endregion

// #region new-and-edit
function NewContact({ onDone }: { onDone: () => void }) {
  return (
    <ContactForm
      title="New contact"
      defaultValues={emptyContact}
      submitLabel="Add contact"
      busyLabel="Adding"
      save={(values) =>
        fetchCuple(client.createContact.post, { body: values }).thenResolveAlso([
          "validation-error",
          "transport-error",
        ])
      }
      onSaved={onDone}
      onCancel={onDone}
    />
  );
}

function EditContact({ id, onDone }: { id: number; onDone: () => void }) {
  const found = useGet(
    client.getContact,
    { params: { id } },
    { resolveAlso: ["notFound"] },
  );
  if (found.result === "notFound")
    return <p className="muted">This contact was deleted.</p>;

  const { name, email, address } = found.contact;
  return (
    <ContactForm
      title={`Edit ${name}`}
      // Loaded before the form mounts, so react-hook-form starts with the real values.
      defaultValues={{ name, email, address }}
      submitLabel="Save changes"
      busyLabel="Saving"
      save={(values) =>
        fetchCuple(client.updateContact.put, {
          params: { id },
          body: values,
        }).thenResolveAlso(["validation-error", "transport-error"])
      }
      onSaved={onDone}
      onCancel={onDone}
    />
  );
}
// #endregion

// #region contact-form
function ContactForm(props: {
  title: string;
  defaultValues: ContactValues;
  submitLabel: string;
  busyLabel: string;
  save: (values: ContactValues) => Promise<SaveResult>;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const form = useForm<ContactValues>({ defaultValues: props.defaultValues });
  const save = useAction(
    async (values: ContactValues) => {
      const response = await props.save(values);
      if (response.result === "validation-error") showServerIssues(form, response.issues);
      else if (response.result === "transport-error")
        form.setError("root.server", {
          message: "Not saved: the connection dropped. Try again.",
        });
      else props.onSaved();
      return response;
    },
    {
      // Only a successful save changed anything worth refetching.
      refresh: { success: refreshes.contacts },
      // Anything the form doesn't handle is shown with notify; the form keeps what the user typed.
      config: { errors: { onError: "notify" } },
    },
  );
  const { errors } = form.formState;

  return (
    <section aria-label={props.title}>
      <h2>{props.title}</h2>
      {/* `run` resolves when the save is done, so react-hook-form's
          `isSubmitting` covers it, and it never rejects. */}
      <form onSubmit={form.handleSubmit(save.run)} noValidate>
        <Field
          label="Name"
          error={errors.name?.message}
          {...form.register("name")}
          autoComplete="name"
        />
        <Field
          label="Email"
          error={errors.email?.message}
          {...form.register("email")}
          type="email"
          autoComplete="email"
        />
        <fieldset>
          <legend>Address</legend>
          <Field
            label="Street"
            error={errors.address?.street?.message}
            {...form.register("address.street")}
            autoComplete="street-address"
          />
          <div className="row">
            <Field
              label="City"
              error={errors.address?.city?.message}
              {...form.register("address.city")}
              autoComplete="address-level2"
            />
            <Field
              label="Zip"
              error={errors.address?.zip?.message}
              {...form.register("address.zip")}
              autoComplete="postal-code"
            />
          </div>
        </fieldset>
        {errors.root?.server && <p className="error">{errors.root.server.message}</p>}
        <div className="row">
          <BusyButton type="submit" busy={save.isPending} busyLabel={props.busyLabel}>
            {props.submitLabel}
          </BusyButton>
          <button type="button" onClick={props.onCancel} disabled={save.isPending}>
            Cancel
          </button>
        </div>
      </form>
    </section>
  );
}
// #endregion

// #region server-issues
/**
 * Puts the server's validation errors on the form's fields. Here the request
 * body has the form's shape, so an issue's path is the field's name
 * (`["address", "zip"]` → `address.zip`). When the shapes differ, translate the
 * path here. An issue without a path goes to the form as a whole.
 */
function showServerIssues<T extends FieldValues>(
  form: UseFormReturn<T>,
  issues: ServerIssue[],
) {
  issues.forEach((issue, i) => {
    const error = { type: "server", message: issue.message };
    if (issue.path.length === 0) form.setError("root.server", error);
    else
      form.setError(issue.path.join(".") as FieldPath<T>, error, {
        shouldFocus: i === 0,
      });
  });
}
// #endregion

/** A labelled input with its error, wired for screen readers. */
function Field({
  label,
  error,
  ...input
}: { label: string; error?: string } & React.ComponentProps<"input">) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        aria-invalid={error !== undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        {...input}
      />
      {error && (
        <span id={`${id}-error`} className="error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

function FormSkeleton() {
  return (
    <section role="status" aria-busy="true" aria-label="Loading contact">
      <h2>
        <Skeleton width="10rem" />
      </h2>
      {["60%", "70%", "80%", "50%"].map((width) => (
        <p key={width}>
          <Skeleton width={width} />
        </p>
      ))}
    </section>
  );
}
