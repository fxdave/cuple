import { fetchCuple } from "@cuple/client";
import { useAction } from "@cuple/react";
import { useState } from "react";
import { client } from "./cuple";

export function App() {
  const [name, setName] = useState("");
  const greet = useAction(() =>
    fetchCuple(client.sayHi.get, {}).thenUnwrap(),
  );

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        greet.run();
      }}
    >
      <h1>{greet.value?.message}</h1>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <button disabled={greet.isPending}>Welcome</button>
    </form>
  );
}
