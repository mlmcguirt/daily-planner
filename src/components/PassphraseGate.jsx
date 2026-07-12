import { useState } from "preact/hooks";

// The first screen of the product, and the highest-stakes one.
//
// It used to be a white box under a `bg-black/35` scrim — but App() renders this gate
// INSTEAD of the planner, so there is nothing behind it to dim. The scrim was darkening
// an empty cream page for no reason, and cream under 35% black comes out a muddy mauve.
// The first thing anyone saw of a planner that looks like paper was a grey-brown void.
// So: no scrim. The card is a small sheet of paper, sitting on the same cream band the
// planner does, with the same radius and the same shadow. The first screen now looks
// like the product.
//
// And the copy tells the truth. `spaceFromKey()` is SHA-256(passphrase) and that hash IS
// the planner_days primary key — so a mistyped passphrase does not fail, it silently
// opens a DIFFERENT, EMPTY planner. On a new phone that is indistinguishable from "all my
// data is gone". The old copy explained that the passphrase was a shared secret and never
// mentioned the part that can actually hurt you.
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
    <div class="fixed inset-0 flex items-center justify-center bg-backdrop p-5">
      <form
        class="w-full max-w-[400px] rounded-[10px] bg-paper p-7 shadow-[0_2px_14px_rgba(0,0,0,.10)]"
        onSubmit={submit}
      >
        <h1 class="m-0 mb-1 text-xl font-normal text-ink">Your planner</h1>
        <p class="m-0 mb-5 text-sm leading-relaxed text-status">
          Use the same passphrase on every device to open the same planner. Anyone who has
          it can read your entries.
        </p>

        {/* A visible label, not a placeholder pretending to be one — a placeholder
            disappears the moment you start typing, exactly when you might want to check
            what the field is. */}
        <label for="keyInput" class="mb-1.5 block text-sm text-ink">Passphrase</label>
        <input
          id="keyInput"
          type="password"
          autocomplete="off"
          value={value}
          onInput={e => { setValue(e.currentTarget.value); setError(""); }}
          class="mb-3 w-full rounded-md border border-muted bg-transparent p-2.5 text-base text-ink"
        />
        {error && <p class="m-0 mb-3 text-sm text-alarm">{error}</p>}

        <button
          id="keySave"
          type="submit"
          class="w-full rounded-md border-0 bg-ink p-2.5 text-base text-white"
        >
          Open my planner
        </button>

        {/* The thing that can actually hurt you. Below the button, because it matters most
            to someone coming back on a new device — and that person has already decided to
            sign in, so it must not be buried above the fold of their attention. */}
        <p class="m-0 mt-5 border-t border-line pt-4 text-[13px] leading-relaxed text-status">
          <strong class="font-normal text-ink">There is no password reset.</strong>{" "}
          Your passphrase <em>is</em> the key to your data, so a typo won't show an error —
          it will quietly open a different, empty planner. Write it down somewhere safe.
        </p>
      </form>
    </div>
  );
}
