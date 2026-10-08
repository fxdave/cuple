import { fetchCuple } from "@cuple/client";
import {
  Boundary,
  type CupleConfig,
  CupleProvider,
  combine,
  type StreamEvent,
  useAction,
  useGet,
  useStream,
} from "@cuple/react";
import { useMemo, useState, useTransition } from "react";
import {
  ACCOUNTS,
  type AccountId,
  client,
  refreshes,
  signIn,
  signOut,
  store,
} from "./client";
import { Contacts } from "./contacts";
import { BusyButton, PageOverlay, ProgressBar, RowsSkeleton, Skeleton } from "./loading";

export default function App() {
  const [accountId, setAccountId] = useState<AccountId | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [view, setView] = useState<"notes" | "contacts">("notes");

  // #region config
  const config = useMemo<CupleConfig>(
    () => ({
      errors: {
        // How the app shows an error without replacing the page.
        notify: (error) => setNotice(error.message),
        // An error no code handled: a dropped connection is shown and the page
        // stays; anything else goes to the nearest <Boundary>.
        onError: (error) => (error.kind === "transport" ? "notify" : "boundary"),
        // The message when there's nothing more specific, like a dropped connection.
        fallbackMessage: "Something went wrong. Check your connection and try again.",
      },
    }),
    [],
  );
  // #endregion

  return (
    <CupleProvider store={store} config={config}>
      <ProgressBar />
      <PageOverlay />
      <main>
        <h1>Notes</h1>
        {/* If the header can't load, say so and leave it out: the page still works. */}
        <Boundary fallback={<Skeleton width="10rem" />} error="notify">
          <Header />
        </Boundary>
        {notice && (
          <p className="error">
            {notice}{" "}
            <button type="button" onClick={() => setNotice(null)}>
              Dismiss
            </button>
          </p>
        )}

        <div className="row">
          {(Object.keys(ACCOUNTS) as AccountId[]).map((id) => (
            <button
              type="button"
              key={id}
              aria-pressed={accountId === id}
              onClick={() => {
                signIn(id);
                setAccountId(id);
                setOpenId(null);
              }}
            >
              Sign in as {ACCOUNTS[id].name}
            </button>
          ))}
          <button
            type="button"
            disabled={accountId === null}
            onClick={() => {
              signOut();
              setAccountId(null);
              setOpenId(null);
            }}
          >
            Sign out
          </button>
        </div>

        {accountId === null ? (
          <p className="muted">Sign in to see your notes.</p>
        ) : (
          <Boundary
            error={(error, retry) => (
              <p className="error">
                {error.message}{" "}
                <button type="button" onClick={retry}>
                  Retry
                </button>
              </p>
            )}
          >
            <nav className="row" aria-label="Sections">
              <button
                type="button"
                aria-pressed={view === "notes"}
                onClick={() => setView("notes")}
              >
                Notes
              </button>
              <button
                type="button"
                aria-pressed={view === "contacts"}
                onClick={() => setView("contacts")}
              >
                Contacts
              </button>
            </nav>
            {view === "contacts" ? (
              <Contacts />
            ) : (
              <>
                <NewNote />
                <Boundary fallback={<NotesSkeleton />}>
                  <Notes onOpen={setOpenId} />
                </Boundary>
                <section aria-label="Selected note">
                  {openId === null ? (
                    <p className="muted">Open a note to read it here.</p>
                  ) : (
                    // `key`: a different note is a different subject, with fresh state.
                    <Boundary key={openId} fallback={<NoteSkeleton />}>
                      <NoteDetail id={openId} onClose={() => setOpenId(null)} />
                    </Boundary>
                  )}
                </section>
              </>
            )}
            <Activity />
          </Boundary>
        )}
      </main>
    </CupleProvider>
  );
}

// #region header
function Header() {
  const me = useGet(client.me, undefined, { resolveAlso: ["not-signed-in"] });
  if (me.result === "not-signed-in") return <p className="muted">Signed out</p>;
  return <p className="muted">Signed in as {me.account.name}</p>;
}
// #endregion

function NewNote() {
  const [text, setText] = useState("");
  const create = useAction(
    async (text: string) => {
      const res = await fetchCuple(client.createNote.post, {
        body: { text },
      }).thenKeep(["success", "invalid-body"]);
      if (res.result === "success") setText("");
      return res;
    },
    { refresh: { success: refreshes.notes } },
  );

  return (
    <section>
      <form
        className="row"
        onSubmit={(event) => {
          event.preventDefault();
          create.run(text);
        }}
      >
        <input
          className="grow"
          aria-label="New note"
          value={text}
          onChange={(e) => setText(e.target.value)}
          readOnly={create.isPending}
          placeholder="Write a note"
        />
        <BusyButton type="submit" busy={create.isPending} busyLabel="Adding">
          Add note
        </BusyButton>
      </form>
      {create.value?.result === "invalid-body" && (
        <p className="error">{create.value.issues[0]?.message}</p>
      )}
      {create.status === "failed" && (
        <p className="error">The note wasn't added. Try again.</p>
      )}
    </section>
  );
}

// #region notes
/** The first `count` pages of notes, fetched in parallel: page numbers don't depend on each other. */
const notePages = combine(async (ctx, args: { count: number }) => {
  const pages = await Promise.all(
    Array.from({ length: args.count }, (_, page) =>
      ctx.get(client.getNotes, { query: { page } }),
    ),
  );
  const last = pages[pages.length - 1]!;
  return {
    notes: pages.flatMap((page) => page.notes),
    total: last.total,
    hasMore: last.hasMore,
  };
});

function Notes({ onOpen }: { onOpen: (id: number) => void }) {
  const [count, setCount] = useState(1);
  const [isPending, startTransition] = useTransition();
  const list = useGet(notePages, { count });

  return (
    <section aria-busy={isPending}>
      <h2>Your notes ({list.total})</h2>
      <ul>
        {list.notes.map((note) => (
          <NoteRow key={note.id} note={note} onOpen={onOpen} />
        ))}
      </ul>
      {/* The next page shows up where it will land, not as a changed label. */}
      {isPending && <RowsSkeleton rows={2} />}
      {list.hasMore && (
        <button
          type="button"
          onClick={() => startTransition(() => setCount(count + 1))}
          disabled={isPending}
        >
          Show more
        </button>
      )}
    </section>
  );
}
// #endregion

// #region note-row
/** One action per row, so each row has its own pending state. */
function NoteRow(props: {
  note: { id: number; text: string };
  onOpen: (id: number) => void;
}) {
  const remove = useAction(
    () =>
      fetchCuple(client.deleteNote.delete, {
        params: { id: props.note.id },
      }).thenKeepSuccess(),
    // A failed row action shouldn't take the page with it.
    { refresh: refreshes.notes, config: { errors: { onError: "notify" } } },
  );

  return (
    <li className={remove.isPending ? "row pending" : "row"} aria-busy={remove.isPending}>
      <button type="button" className="grow" onClick={() => props.onOpen(props.note.id)}>
        {props.note.text}
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

function NotesSkeleton() {
  return (
    <section role="status" aria-busy="true" aria-label="Loading notes">
      <h2>
        <Skeleton width="8rem" />
      </h2>
      <RowsSkeleton rows={5} />
    </section>
  );
}

// #region note-detail
function NoteDetail({ id, onClose }: { id: number; onClose: () => void }) {
  const note = useGet(
    client.getNote,
    { params: { id } },
    { resolveAlso: ["note-not-found", "not-your-note"] },
  );

  switch (note.result) {
    case "note-not-found":
      return (
        <p className="muted">
          This note was deleted.{" "}
          <button type="button" onClick={onClose}>
            Close
          </button>
        </p>
      );
    case "not-your-note":
      return <p className="muted">This note belongs to another account.</p>;
    case "success":
      return (
        <article>
          <p>{note.note.text}</p>
          <p className="muted">
            <time dateTime={note.note.createdAt}>
              {new Date(note.note.createdAt).toLocaleString()}
            </time>
          </p>
        </article>
      );
  }
}
// #endregion

function NoteSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading note">
      <p>
        <Skeleton width="85%" />
      </p>
      <p>
        <Skeleton width="9rem" />
      </p>
    </div>
  );
}

// #region activity
function Activity() {
  type Event = StreamEvent<typeof client.activity.get>;
  const [events, setEvents] = useState<Event[]>([]);

  const feed = useStream(client.activity.get, {}, (event) => {
    setEvents((previous) => [event, ...previous].slice(0, 6));
    // Someone changed notes, possibly in another tab: refetch what's on screen.
    store.refresh(refreshes.notes);
  });

  return (
    <section aria-label="Activity">
      <h2>Activity</h2>
      {feed.error ? (
        <p className="error">
          Live updates stopped.{" "}
          <button type="button" onClick={feed.reconnect}>
            Reconnect
          </button>
        </p>
      ) : (
        !feed.isStreaming && <p className="muted">Live updates ended.</p>
      )}
      {events.length === 0 ? (
        <p className="muted">Changes to notes show up here as they happen.</p>
      ) : (
        <ul>
          {events.map((event) => (
            <li key={event.id}>
              {event.by} {event.action} “{event.note}”
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
// #endregion
