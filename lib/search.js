// What counts as a search hit, and how a snippet is trimmed.
//
// Lives here, outside functions/, because BOTH sides of the app need it and they
// must never disagree:
//
//   functions/api/search.js  — the real API, searching D1
//   src/lib/demo-api.js      — the demo's fake server, searching localStorage
//
// The demo build deletes functions/ and wrangler.toml, but keeps lib/ — so this
// module survives into the demo bundle. If these two definitions ever drift, the
// demo's search behaves differently from the app it is advertising, and nothing
// would catch it.

const SNIPPET_PAD = 40;

// Every user-entered string in a day, labelled. Block prose first, then to-dos.
// A day's JSON also contains keys, punctuation and rids — none of which are things
// the user typed, and none of which should ever produce a hit.
export function* fields(day) {
  for (const [key, text] of Object.entries((day && day.blocks) || {})) {
    if (text) yield [key, text];
  }
  for (const todo of (day && day.todos) || []) {
    if (todo && todo.text) yield ["todo", todo.text];
  }
}

// 40 characters either side of the hit, with ellipses only where text was actually cut.
export function snippet(text, at, len) {
  const start = Math.max(0, at - SNIPPET_PAD);
  const end = Math.min(text.length, at + len + SNIPPET_PAD);
  return (start > 0 ? "…" : "") + text.slice(start, end).trim() + (end < text.length ? "…" : "");
}

// The whole hit test for one day: returns [{field, text}], empty if the day
// doesn't genuinely contain the query in a field the user typed.
//
// The API pre-filters with a LIKE over the stored JSON blob, which can match on
// JSON syntax ({, "todos", "checked"). This is the re-check that throws those out.
// The demo has no pre-filter and simply runs this over every stored day.
export function snippetsFor(day, q) {
  const needle = q.toLowerCase();
  const out = [];
  for (const [name, text] of fields(day)) {
    const at = String(text).toLowerCase().indexOf(needle);
    if (at === -1) continue;
    out.push({ field: name, text: snippet(String(text), at, q.length) });
  }
  return out;
}
