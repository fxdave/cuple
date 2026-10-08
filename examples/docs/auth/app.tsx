import { fetchCuple } from "@cuple/client";
import { Boundary, CupleProvider, useAction, useGet } from "@cuple/react";
import { type ReactNode, useEffect, useState } from "react";
import { authedClient, client, session, store } from "./client";

export function App() {
  const [signedIn, setSignedIn] = useState(false);
  const signOut = () => {
    session.set(null);
    setSignedIn(false);
  };
  return (
    <CupleProvider store={store}>
      {signedIn ? (
        <SignedInArea onSignedOut={signOut}>
          <Greeting />
        </SignedInArea>
      ) : (
        <SignIn onSignedIn={() => setSignedIn(true)} />
      )}
    </CupleProvider>
  );
}

// #region signed-in-area
/**
 * Everything behind sign-in. A 401 from anything inside, a read or an action,
 * ends here and signs the user out. With React Router, render
 * `<Navigate to="/login" />` instead of `<SignedOut />`.
 */
function SignedInArea(props: { onSignedOut: () => void; children: ReactNode }) {
  return (
    <Boundary
      fallback={<p>Loading…</p>}
      error={(error, retry) =>
        error.statusCode === 401 ? (
          <SignedOut onSignedOut={props.onSignedOut} />
        ) : (
          <p>
            {error.message}{" "}
            <button type="button" onClick={retry}>
              Retry
            </button>
          </p>
        )
      }
    >
      {props.children}
    </Boundary>
  );
}

function SignedOut(props: { onSignedOut: () => void }) {
  useEffect(props.onSignedOut, []);
  return null;
}
// #endregion

function Greeting() {
  const { greeting } = useGet(authedClient.getGreeting);
  const expire = useAction(
    () => fetchCuple(authedClient.expireSession.post).thenKeepSuccess(),
    {
      refresh: [authedClient.getGreeting],
    },
  );
  return (
    <p>
      {greeting}{" "}
      <button type="button" onClick={() => expire.run()}>
        Expire my session
      </button>
    </p>
  );
}

function SignIn(props: { onSignedIn: () => void }) {
  const [name, setName] = useState("");
  const signIn = useAction(async () => {
    const res = await fetchCuple(client.signIn.post, { body: { name } }).thenKeep([
      "success",
      "invalid-body",
    ]);
    if (res.result === "success") {
      session.set(res.token);
      props.onSignedIn();
    }
    return res;
  });
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        signIn.run();
      }}
    >
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" />
      <button type="submit">Sign in</button>
      {signIn.value?.result === "invalid-body" && (
        <p>{signIn.value.issues[0]?.message}</p>
      )}
    </form>
  );
}
