// The day model, and pure functions over it. No DOM, no network.
//
// Shape (unchanged from the vanilla build — the API and existing saved data depend on it):
//   { day: 0..6, blocks: {morning, afternoon, evening, notes}, todos: [{checked, text, rid?}] }
// `rid` marks a to-do that came from a recurring item, so it can't be added twice.

// The page has 17 ruled lines. You can write past the bottom of the page — Enter on the
// last line adds another and the checklist scrolls — but not forever: a held-down Enter
// key would otherwise spawn rows until something gave.
export const TODO_ROWS = 17;
export const MAX_TODO_ROWS = 60;
export const BLOCKS = ["morning", "afternoon", "evening", "notes"];
export const DAY_LABELS = ["M", "T", "W", "T", "F", "S", "S"];
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function emptyDay(weekday = 0) {
  return {
    day: weekday,
    blocks: { morning: "", afternoon: "", evening: "", notes: "" },
    todos: Array.from({ length: TODO_ROWS }, () => ({ checked: false, text: "" })),
    // ids of block-targeted recurring items already put on this day. A to-do carries
    // its own `rid`; block text is just prose and can't, so the day remembers instead.
    // It also means deleting the line on a given day sticks, rather than coming back.
    applied: []
  };
}

// Pad to at least TODO_ROWS so the sheet always shows a full checklist.
export function normalize(data, weekday = 0) {
  const base = emptyDay(weekday);
  if (!data) return base;
  const todos = (data.todos || []).map(t => ({
    checked: !!t.checked,
    text: t.text || "",
    ...(t.rid ? { rid: t.rid } : {})
  }));
  while (todos.length < TODO_ROWS) todos.push({ checked: false, text: "" });
  return {
    day: weekday,
    blocks: { ...base.blocks, ...(data.blocks || {}) },
    todos,
    applied: Array.isArray(data.applied) ? [...data.applied] : []
  };
}

export function weekdayOf(ds) {                 // Mon=0 .. Sun=6
  const [y, m, d] = ds.split("-").map(Number);
  return (new Date(y, m - 1, d).getDay() + 6) % 7;
}

export function shiftDate(ds, days) {
  const [y, m, d] = ds.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

export function todayStr() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`;
}

// Two days are "the same" if their content matches. Trailing blank rows are padding,
// not content. Used to tell a real conflict from a lost confirmation.
export function normalizeDay(d) {
  if (!d) return "null";
  const blocks = {};
  for (const [k, v] of Object.entries(d.blocks || {})) if (v) blocks[k] = v;
  const todos = (d.todos || []).map(t => ({
    checked: !!t.checked,
    text: (t.text || "").trim(),
    rid: t.rid || ""
  }));
  while (todos.length) {
    const last = todos[todos.length - 1];
    if (last.text || last.checked || last.rid) break;
    todos.pop();
  }
  return JSON.stringify({ day: d.day, blocks, todos });
}
export const sameDay = (a, b) => normalizeDay(a) === normalizeDay(b);

// Put recurring items for this weekday back where they came from — a to-do returns to
// the checklist, a line from Morning returns to Morning. Pure: returns new data.
// Never saves — merely opening a day must not create a row in the database.
export function mergeRecurring(data, recurring, weekday) {
  const todos = data.todos.map(t => ({ ...t }));
  const blocks = { ...data.blocks };
  const applied = [...(data.applied || [])];
  const present = new Set(todos.filter(t => t.rid).map(t => t.rid));
  const isEmpty = t => !t.rid && !t.text.trim() && !t.checked;

  for (const item of recurring) {
    if (!item.weekdays.includes(weekday)) continue;
    const target = item.target || "todo";

    if (target === "todo") {
      if (present.has(item.id)) continue;           // the rid keeps it from duplicating
      let slot = todos.findIndex(isEmpty);
      if (slot === -1) { todos.push({ checked: false, text: "" }); slot = todos.length - 1; }
      todos[slot] = { checked: false, text: item.text, rid: item.id };
      present.add(item.id);
      continue;
    }

    if (!BLOCKS.includes(target)) continue;
    if (applied.includes(item.id)) continue;        // already placed on this day
    const current = blocks[target] || "";
    const already = current.split("\n").some(line => line.trim() === item.text.trim());
    if (!already) blocks[target] = current ? `${current}\n${item.text}` : item.text;
    applied.push(item.id);
  }
  return { ...data, blocks, todos, applied };
}

// Drop checklist rows whose recurring item no longer applies (unless you've ticked it).
// Block text is prose and is left alone — deleting a recurring item stops it appearing
// on future days rather than rewriting what's already written.
export function pruneRecurring(data, recurring, weekday) {
  const live = new Set(
    recurring
      .filter(i => (i.target || "todo") === "todo" && i.weekdays.includes(weekday))
      .map(i => i.id)
  );
  return {
    ...data,
    todos: data.todos.map(t =>
      t.rid && !live.has(t.rid) && !t.checked ? { checked: false, text: "" } : t
    )
  };
}

// Carry-over is only offered while today's list is untouched. Recurring rows don't
// count as "touched" — the app put them there, you didn't.
export const isUntouched = data => !data.todos.some(t => !t.rid && t.text.trim());

// Unfinished items worth carrying: not ticked, has text, and not something recurring
// will re-add on the new day anyway.
export const carryOverItems = prev =>
  !prev ? [] : (prev.todos || [])
    .filter(t => t && !t.checked && t.text && t.text.trim() && !t.rid)
    .map(t => t.text.trim());

export function addCarried(data, items) {
  const todos = data.todos.map(t => ({ ...t }));
  const isEmpty = t => !t.rid && !t.text.trim() && !t.checked;
  for (const text of items) {
    let slot = todos.findIndex(isEmpty);
    if (slot === -1) { todos.push({ checked: false, text: "" }); slot = todos.length - 1; }
    todos[slot] = { checked: false, text };
  }
  return { ...data, todos };
}
