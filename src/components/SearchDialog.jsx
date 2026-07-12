import { useState, useEffect, useRef } from "preact/hooks";

export function SearchDialog({ sync, onPick, onClose }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState(null);
  const [error, setError] = useState("");
  const inputRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) { setResults(null); setError(""); return; }
    const t = setTimeout(async () => {
      try {
        setResults(await sync.search(query));
        setError("");
      } catch (err) {
        setResults(null);
        setError(navigator.onLine
          ? String(err.message || err)
          : "Search needs a connection — past days live on the server.");
      }
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <div class="overlay fixed inset-0 z-10 flex items-center justify-center bg-black/35 p-5" onClick={onClose}>
      <div class="max-h-[85vh] w-full max-w-[560px] overflow-auto rounded-[10px] bg-white p-[22px]" onClick={e => e.stopPropagation()}>
        <h3 class="m-0 mb-2 text-lg font-normal">Search past days</h3>
        <input
          id="searchInput"
          ref={inputRef}
          type="search"
          autocomplete="off"
          placeholder="Find a note or a to-do…"
          value={q}
          onInput={e => setQ(e.currentTarget.value)}
          class="mb-3 w-full rounded-md border border-muted p-2.5 text-base"
        />
        <ul id="searchResults" class="m-0 mb-3 list-none p-0">
          {error && <li class="text-sm text-neutral-600">{error}</li>}
          {!error && results && results.length === 0 && (
            <li class="text-sm text-neutral-600">Nothing found.</li>
          )}
          {!error && results?.map(r => (
            <li
              key={r.date}
              data-date={r.date}
              onClick={() => onPick(r.date)}
              class="mb-2 cursor-pointer rounded-md border border-line p-2.5 hover:bg-stripe"
            >
              <div class="text-[13px] text-muted">{r.date}</div>
              {r.snippets.slice(0, 3).map((s, i) => (
                <div key={i} class="hand mt-0.5 text-ink">{highlight(s.text, q.trim())}</div>
              ))}
            </li>
          ))}
        </ul>
        <button id="searchClose" class="w-full rounded-md border border-muted bg-white p-2.5 text-base text-ink" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}

// Built as nodes, not innerHTML — the query is user text and must never be markup.
function highlight(text, needle) {
  if (!needle) return text;
  const out = [];
  const hay = text.toLowerCase();
  const find = needle.toLowerCase();
  let i = 0;
  while (true) {
    const at = hay.indexOf(find, i);
    if (at === -1) { out.push(text.slice(i)); break; }
    if (at > i) out.push(text.slice(i, at));
    out.push(<mark class="bg-yellow-200 text-inherit">{text.slice(at, at + needle.length)}</mark>);
    i = at + needle.length;
  }
  return out;
}
