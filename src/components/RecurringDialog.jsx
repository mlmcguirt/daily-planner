import { useState, useEffect, useRef } from "preact/hooks";
import { DAY_LABELS } from "../lib/day.js";

const newId = () => `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// Where a recurring item comes back — the checklist, or the box it was written in.
const TARGETS = [
  ["todo", "the to-do list"],
  ["morning", "Morning"],
  ["afternoon", "Afternoon"],
  ["evening", "Evening"],
  ["notes", "Notes"]
];

export function RecurringDialog({ items, sync, onSaved, onClose, prefill, focusId }) {
  // Always keep one blank row at the bottom: typing in it grows another. Hunting for
  // an "Add item" button to enter a second to-do is a trap people fall into.
  const withBlank = list => {
    const last = list[list.length - 1];
    return last && !last.text.trim()
      ? list
      : [...list, { id: newId(), text: "", weekdays: [], target: "todo" }];
  };

  // A phrase highlighted on the sheet arrives here as a new row, ready to adjust —
  // already pointed at the box it came from.
  const [rows, setRows] = useState(() =>
    withBlank([
      ...items.map(i => ({ target: "todo", ...i })),
      // prefill.id is minted by the caller: the row you highlighted needs to know which
      // recurring item it just became.
      ...(prefill
        ? [{
            id: prefill.id || newId(),
            text: prefill.text,
            weekdays: prefill.weekdays,
            target: prefill.target || "todo"
          }]
        : [])
    ])
  );
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const listRef = useRef(null);

  // Opened from the pill's Edit: put the cursor in that item, and scroll it into view
  // if the list is long.
  useEffect(() => {
    if (!focusId) return;
    const row = listRef.current?.querySelector(`[data-id="${focusId}"]`);
    const input = row?.querySelector("input[type=text]");
    if (!input) return;
    row.scrollIntoView({ block: "nearest" });
    input.focus();
    input.select();
  }, [focusId]);

  const patch = (i, next) =>
    setRows(withBlank(rows.map((r, j) => (j === i ? { ...r, ...next } : r))));
  const toggleDay = (i, wd) => {
    const set = new Set(rows[i].weekdays);
    set.has(wd) ? set.delete(wd) : set.add(wd);
    patch(i, { weekdays: [...set].sort((a, b) => a - b) });
  };

  const save = async () => {
    setSaving(true);
    setError("");
    const clean = rows
      .filter(r => r.text.trim() && r.weekdays.length)
      .map(r => ({ ...r, target: r.target || "todo" }));
    try {
      onSaved(await sync.putRecurring(clean));
    } catch (err) {
      setError(navigator.onLine
        ? `Couldn't save: ${err.message}`
        : "You appear to be offline. Your day's entries are still saved — recurring to-dos need a connection.");
      setSaving(false);
    }
  };

  return (
    <div class="overlay fixed inset-0 z-10 flex items-center justify-center bg-black/35 p-5" onClick={onClose}>
      <div class="max-h-[85vh] w-full max-w-[560px] overflow-auto rounded-[10px] bg-white p-[22px]" onClick={e => e.stopPropagation()}>
        <h3 class="m-0 mb-2 text-lg font-normal">Recurring to-dos</h3>
        <p class="m-0 mb-3.5 text-sm leading-relaxed text-neutral-600">
          These are added to the checklist automatically on the weekdays you pick.
          Checking one off only affects that day. Add as many as you like — a new blank
          row appears as you fill the last one.
        </p>

        <div id="recurList" ref={listRef}>
          {rows.map((row, i) => (
            <div
              key={row.id}
              class={`recur-row mb-2 rounded-md border p-2.5 ${
                row.id === focusId ? "border-ink ring-1 ring-ink/20" : "border-line"
              }`}
              data-id={row.id}
            >
              <input
                type="text"
                placeholder="e.g. Vitamins"
                value={row.text}
                onInput={e => patch(i, { text: e.currentTarget.value })}
                class="mb-2 w-full rounded-md border border-muted p-2.5 text-base"
              />
              <label class="mb-2 flex items-center gap-2 text-[13px] text-neutral-600">
                Comes back in
                <select
                  class="recur-target rounded-md border border-muted bg-white px-2 py-1 text-[13px] text-ink"
                  value={row.target || "todo"}
                  onChange={e => patch(i, { target: e.currentTarget.value })}
                >
                  {TARGETS.map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </label>
              <div class="flex items-center gap-2">
                <div class="flex gap-1">
                  {DAY_LABELS.map((label, wd) => (
                    <button
                      key={wd}
                      type="button"
                      data-wd={wd}
                      onClick={() => toggleDay(i, wd)}
                      class={`h-8 w-8 rounded-md border text-[13px] ${
                        row.weekdays.includes(wd)
                          ? "border-ink bg-ink text-white"
                          : "border-muted bg-white text-ink"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => setRows(withBlank(rows.filter((_, j) => j !== i)))}
                  class="ml-auto rounded-md border border-line bg-white px-2.5 py-1.5 text-[13px] text-alarm"
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>

        {error && <p class="mb-3 text-sm text-alarm">{error}</p>}

        <div class="mb-3 flex gap-2">
          <button id="recurAdd" class="chrome-btn" onClick={() => setRows([...rows, { id: newId(), text: "", weekdays: [] }])}>
            Add item
          </button>
        </div>
        <div class="flex gap-2">
          <button id="recurSave" disabled={saving} class="rounded-md border-0 bg-ink px-4 py-2.5 text-base text-white disabled:opacity-60" onClick={save}>
            {saving ? "Saving…" : "Save"}
          </button>
          <button id="recurClose" class="rounded-md border border-muted bg-white px-4 py-2.5 text-base text-ink" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
