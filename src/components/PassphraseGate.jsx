import { useState } from "preact/hooks";

export function PassphraseGate({ onOpen }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState("");

  const submit = e => {
    e.preventDefault();
    const v = value.trim();
    if (v.length < 4) { setError("Use at least 4 characters."); return; }
    onOpen(v);
  };

  return (
    <div class="overlay fixed inset-0 z-10 flex items-center justify-center bg-black/35 p-5">
      <form class="w-full max-w-[380px] rounded-[10px] bg-white p-[22px]" onSubmit={submit}>
        <h3 class="m-0 mb-2 text-lg font-normal">Your planner passphrase</h3>
        <p class="m-0 mb-3.5 text-sm leading-relaxed text-neutral-600">
          Enter a private passphrase. Use the same one on every device to see the same
          planner. Anyone with this passphrase can read your entries, so pick something
          only you know.
        </p>
        <input
          id="keyInput"
          type="password"
          autocomplete="off"
          placeholder="Passphrase"
          value={value}
          onInput={e => { setValue(e.currentTarget.value); setError(""); }}
          class="mb-3 w-full rounded-md border border-muted p-2.5 text-base"
        />
        {error && <p class="m-0 mb-3 text-sm text-alarm">{error}</p>}
        <button id="keySave" type="submit" class="w-full rounded-md border-0 bg-ink p-2.5 text-base text-white">
          Open my planner
        </button>
      </form>
    </div>
  );
}
