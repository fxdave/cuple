import { useState } from "react";
import { client } from "./client";
import { useCuple, useCupleCache, useCupleMutation } from "./use-cuple";

const LIST_OPTIONS = {};

function CreatePostForm() {
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const { trigger, isMutating } = useCupleMutation(client.createPost.post);
  const { revalidate } = useCupleCache();

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    const res = await trigger({ body: { title, content } });
    if (res.result !== "success") return;
    setTitle("");
    setContent("");
    // Refetch every cached `getPosts` call, so the new post shows up.
    await revalidate(client.getPosts.get);
  }

  return (
    <form onSubmit={onSubmit} style={{ display: "grid", gap: 8 }}>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Title"
        required
      />
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder="Content"
        rows={3}
        required
      />
      <button type="submit" disabled={isMutating} style={{ justifySelf: "start" }}>
        {isMutating ? "Creating…" : "Create post"}
      </button>
    </form>
  );
}

function PostsList({
  selectedId,
  onSelect,
}: {
  selectedId: number | null;
  onSelect: (id: number | null) => void;
}) {
  const { data, error, isLoading, isValidating } = useCuple(
    client.getPosts.get,
    LIST_OPTIONS,
  );
  const deletePost = useCupleMutation(client.deletePost.delete);
  const updatePost = useCupleMutation(client.updatePost.patch);
  const { revalidate, optimistic } = useCupleCache();

  async function onDelete(id: number) {
    // Drop the row from the list immediately, then let the refetch confirm it.
    await optimistic(
      client.getPosts.get,
      LIST_OPTIONS,
      (current) =>
        current?.result === "success"
          ? { ...current, posts: current.posts.filter((p) => p.id !== id) }
          : (current as never),
      () => deletePost.trigger({ params: { id } }),
    );
    if (selectedId === id) onSelect(null);
    // The detail query for that id is stale too.
    await revalidate(client.getPost.get, { params: { id } });
  }

  async function onRename(id: number, title: string) {
    const res = await updatePost.trigger({
      params: { id },
      body: { title: `${title} ✦` },
    });
    if (res.result !== "success") return;
    // Both the list and that post's detail now hold a stale title.
    await Promise.all([
      revalidate(client.getPosts.get),
      revalidate(client.getPost.get, { params: { id } }),
    ]);
  }

  if (isLoading) return <p>Loading posts…</p>;
  if (error) return <p style={{ color: "red" }}>Error: {error.message}</p>;

  return (
    <>
      <ul style={{ listStyle: "none", padding: 0 }}>
        {data?.result === "success" &&
          data.posts.map((post) => (
            <li key={post.id} style={{ marginBottom: 8, display: "flex", gap: 8 }}>
              <button
                type="button"
                onClick={() => onSelect(post.id)}
                style={{ flex: 1, textAlign: "left" }}
              >
                #{post.id} — {post.title}
              </button>
              <button
                type="button"
                onClick={() => onRename(post.id, post.title)}
                disabled={updatePost.isMutating}
              >
                Rename
              </button>
              <button
                type="button"
                onClick={() => onDelete(post.id)}
                disabled={deletePost.isMutating}
              >
                Delete
              </button>
            </li>
          ))}
      </ul>
      <p style={{ color: "#666", fontSize: 14, minHeight: 20 }}>
        {isValidating ? "Revalidating…" : ""}
      </p>
    </>
  );
}

// SWR key is derived from endpoint + options automatically.
// Passing null as options suspends the fetch.
function PostDetail({ id }: { id: number | null }) {
  const { data, error, isLoading } = useCuple(
    client.getPost.get,
    id ? { params: { id } } : null,
  );

  if (id === null) return <p>Select a post from the list above.</p>;
  if (isLoading) return <p>Loading post #{id}…</p>;
  if (error) return <p style={{ color: "red" }}>Error: {error.message}</p>;
  if (!data) return null;

  if (data.result === "notFound") {
    return <p style={{ color: "orange" }}>Post #{id} not found.</p>;
  }

  if (data.result !== "success") return null;

  return (
    <div style={{ border: "1px solid #ccc", padding: 16, borderRadius: 4 }}>
      <h3 style={{ margin: "0 0 8px" }}>{data.post.title}</h3>
      <p style={{ margin: 0 }}>{data.post.content}</p>
    </div>
  );
}

export default function App() {
  const [selectedId, setSelectedId] = useState<number | null>(null);

  return (
    <div
      style={{
        fontFamily: "sans-serif",
        maxWidth: 600,
        margin: "40px auto",
        padding: "0 16px",
      }}
    >
      <h1>Cuple + React SWR</h1>

      <section>
        <h2>All Posts</h2>
        <p style={{ color: "#666", fontSize: 14 }}>
          <code>useCuple(client.getPosts.get, {"{}"})</code>
          <br />
          Rename patches the post, then revalidates the list and the detail. Delete
          updates the list optimistically and rolls back on failure.
        </p>
        <PostsList selectedId={selectedId} onSelect={setSelectedId} />
      </section>

      <hr />

      <section>
        <h2>Create a Post — Mutation + Revalidation</h2>
        <p style={{ color: "#666", fontSize: 14 }}>
          <code>useCupleMutation(client.createPost.post)</code>
          <br />
          On success: <code>revalidate(client.getPosts.get)</code> refetches every cached
          call of that endpoint.
        </p>
        <CreatePostForm />
      </section>

      <hr />

      <section>
        <h2>Post Detail — Watching ID</h2>
        <p style={{ color: "#666", fontSize: 14 }}>
          <code>{"useCuple(client.getPost.get, id ? { params: { id } } : null)"}</code>
          <br />
          Key is derived automatically; null options suspends the fetch.
        </p>
        <div style={{ marginBottom: 12 }}>
          {[1, 2, 3, 99].map((id) => (
            <button
              type="button"
              key={id}
              onClick={() => setSelectedId(id)}
              style={{
                marginRight: 8,
                fontWeight: selectedId === id ? "bold" : "normal",
              }}
            >
              ID {id}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setSelectedId(null)}
            style={{ marginLeft: 16, color: "#999" }}
          >
            Clear
          </button>
        </div>
        <PostDetail id={selectedId} />
      </section>
    </div>
  );
}
