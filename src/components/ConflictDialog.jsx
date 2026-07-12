// Shown when the same day was edited in two places. Nothing is overwritten until
// the user picks — that is the whole point of this dialog.
export function ConflictDialog({ conflict, onKeepMine, onUseTheirs }) {
  return (
    <div id="conflictOverlay" class="overlay fixed inset-0 z-10 flex items-center justify-center bg-black/35 p-5">
      <div class="max-h-[85vh] w-full max-w-[560px] overflow-auto rounded-[10px] bg-white p-[22px]">
        <h3 class="m-0 mb-2 text-lg font-normal">This day changed on another device</h3>
        <p class="m-0 mb-3.5 text-sm leading-relaxed text-neutral-600">
          <strong id="conflictDate">{conflict.date}</strong> was edited somewhere else since your
          version. Nothing has been overwritten — pick which one to keep.
        </p>

        <div class="mb-3.5 grid grid-cols-2 gap-2.5 max-[520px]:grid-cols-1">
          <Version title="Yours (on this device)" id="mineText" data={conflict.mine} />
          <Version title="Theirs (saved on the server)" id="theirsText" data={conflict.theirs} missing="(no longer on the server)" />
        </div>

        <div class="flex gap-2">
          <button id="keepMine" class="rounded-md border-0 bg-ink px-4 py-2.5 text-base text-white" onClick={onKeepMine}>
            Keep mine
          </button>
          <button id="useTheirs" class="rounded-md border border-muted bg-white px-4 py-2.5 text-base text-ink" onClick={onUseTheirs}>
            Use theirs
          </button>
        </div>
      </div>
    </div>
  );
}

function Version({ title, id, data, missing }) {
  return (
    <div class="rounded-md border border-line p-2.5">
      <h4 class="m-0 mb-1.5 text-sm font-normal">{title}</h4>
      <pre id={id} class="hand m-0 max-h-[180px] overflow-auto whitespace-pre-wrap break-words leading-[1.3] text-ink">
        {summarize(data, missing)}
      </pre>
    </div>
  );
}

function summarize(data, missing = "(empty)") {
  if (!data) return missing;
  const parts = [];
  for (const [k, v] of Object.entries(data.blocks || {})) {
    if (v && v.trim()) parts.push(`${k}: ${v.trim()}`);
  }
  for (const t of (data.todos || []).filter(t => t && t.text && t.text.trim())) {
    parts.push(`${t.checked ? "✓" : "○"} ${t.text.trim()}`);
  }
  return parts.length ? parts.join("\n") : "(empty)";
}
