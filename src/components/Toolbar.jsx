import { useState, useEffect, useRef } from "preact/hooks";

// The buttons live in the cream band, top-right — not on the sheet itself.
//
// MOBILE IS NOT A REFLOW. On a phone this used to be six chrome buttons in a
// horizontally scrolling strip, which is what you get when you let a desktop toolbar
// wrap rather than deciding what a phone actually needs. Two of those six were actively
// wrong there: Print is near-useless on a phone, and Sign out sat one thumb-slip from a
// screen demanding the passphrase back.
//
// So: on a phone you get Search, Recurring, and the status line. Everything else goes
// behind an overflow. Retry deliberately stays out of the overflow — when a save has
// failed, the recovery must be in reach, not two taps deep.
//
// At md and up nothing has changed: `contents` makes the overflow group transparent to
// the flex layout, so all the buttons sit in the cream band exactly as before.
export function Toolbar({ carry, status, undo, onUndo, onSearch, onRecurring, onClear, onPrint, onRetry, onSignOut, onCarry }) {
  const s = statusText(status);
  const [open, setOpen] = useState(false);
  const moreRef = useRef(null);

  // Tapping anywhere else closes the overflow.
  useEffect(() => {
    if (!open) return;
    const close = e => { if (!moreRef.current?.contains(e.target)) setOpen(false); };
    addEventListener("pointerdown", close);
    return () => removeEventListener("pointerdown", close);
  }, [open]);

  const act = fn => () => { setOpen(false); fn(); };

  const secondary = open
    ? "contents max-md:absolute max-md:right-3 max-md:top-[calc(100%+6px)] max-md:z-20 max-md:flex " +
      "max-md:w-max max-md:flex-col max-md:items-stretch max-md:gap-1 max-md:rounded-lg max-md:border " +
      "max-md:border-muted max-md:bg-white max-md:p-2 max-md:shadow-lg"
    : "contents max-md:hidden";

  return (
    <div class="toolbar fixed inset-x-0 top-0 z-5 flex h-[var(--border)] items-center justify-end gap-2 overflow-x-auto px-[var(--border)] max-md:sticky max-md:h-auto max-md:justify-start max-md:overflow-visible max-md:bg-backdrop max-md:px-4 max-md:py-2.5">
      <span
        id="status"
        class={`mr-auto flex-none whitespace-nowrap pr-3 text-[13px] max-md:order-last max-md:mr-0 max-md:ml-auto max-md:pr-0 max-md:pl-3 ${
          s.warn ? "font-bold text-alarm" : "text-status"
        }`}
      >
        {s.text}
      </span>

      {carry && (
        <button id="carryBtn" class="chrome-btn border-dashed" onClick={onCarry}>
          Carry over {carry.count} unfinished from {carry.from}
        </button>
      )}

      {/* Stays in the primary row, never in the overflow: like Retry, a recovery the
          moment demands must not be two taps deep. Dashed, because it's a passing offer,
          not standing chrome — it withdraws the instant you leave the day or write on it. */}
      {undo && (
        <button id="undoClearBtn" class="chrome-btn border-dashed" onClick={onUndo}>
          Undo clear
        </button>
      )}

      <button id="searchBtn" class="chrome-btn" onClick={onSearch}>Search</button>
      <button id="recurBtn" class="chrome-btn" onClick={onRecurring}>Recurring</button>

      {/* A failed save must never be two taps deep. */}
      {s.retry && <button id="retryBtn" class="chrome-btn" onClick={onRetry}>Retry</button>}

      <div ref={moreRef} class="contents">
        <button
          id="moreBtn"
          class="chrome-btn md:hidden"
          aria-expanded={open}
          aria-label="More actions"
          onClick={() => setOpen(v => !v)}
        >
          ⋯
        </button>

        <div class={secondary}>
          <button id="clearBtn" class="chrome-btn" onClick={act(onClear)}>Clear day</button>
          <button id="printBtn" class="chrome-btn" onClick={act(onPrint)}>Print</button>
          <button id="signOutBtn" class="chrome-btn" onClick={act(onSignOut)}>
            {import.meta.env.VITE_DEMO ? "Reset demo" : "Sign out"}
          </button>
        </div>
      </div>
    </div>
  );
}

// Say what is actually true. "Save failed" with no reason and no recourse is not a status.
function statusText({ pending, conflicts, online, lastError, lastSavedAt }) {
  if (conflicts) {
    return { text: `${conflicts} day${conflicts > 1 ? "s" : ""} needs your decision`, warn: true };
  }
  if (!online && pending) {
    return { text: `Offline — ${pending} unsaved, will sync` };
  }
  if (lastError) {
    return { text: `Save failed: ${lastError} — kept on this device`, warn: true, retry: true };
  }
  if (pending) return { text: `Saving… (${pending})` };
  if (!online) return { text: "Offline — everything saved" };
  return {
    text: lastSavedAt
      ? "Saved " + lastSavedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      : "Synced"
  };
}
