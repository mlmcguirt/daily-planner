import { useRef, useState, useEffect } from "preact/hooks";
import { BLOCKS } from "../lib/day.js";
import { DateHeader } from "./DateHeader.jsx";
import { SelectionPill } from "./SelectionPill.jsx";

const TITLES = { morning: "Morning", afternoon: "Afternoon", evening: "Evening", notes: "Notes" };
// Weights, not fixed heights — this is what lets the whole sheet fit one screen.
const WEIGHT = { morning: "1.15", afternoon: "1.35", evening: "1", notes: "0.9" };

function Block({ name, value, onChange, onSelect }) {
  return (
    <div
      id={name}
      // The weight goes in as a CSS VARIABLE, not as an inline `flex` value.
      //
      // It used to be `style={{ flex: `${WEIGHT[name]} 1 0` }}` alongside a
      // `max-md:flex-none` class — and inline styles beat classes, so the mobile rule
      // NEVER applied. On a phone the blocks stayed flex-basis:0 inside a height-capped
      // column and collapsed to 16px each (just the heading), while their textareas
      // (min-height 120px) spilled out and rendered on top of one another. The four
      // blocks were an unreadable smear on the platform this planner mostly lives on.
      //
      // A variable can be read by a media query. An inline `flex` cannot be overridden
      // by one. That is the whole fix. See .block-pane in styles.css.
      class="block-pane flex min-h-0 flex-col rounded-md border border-muted px-2.5 pt-1.5 pb-2"
      style={{ "--weight": WEIGHT[name] }}
    >
      <h2 class="m-0 mb-0.5 flex-none text-[15px] font-normal text-ink">{TITLES[name]}</h2>
      <textarea
        data-key={name}
        value={value}
        onInput={e => onChange(name, e.currentTarget.value)}
        onSelect={e => onSelect({ kind: "block", name }, e.currentTarget)}
        class="hand w-full flex-1 resize-none border-0 bg-transparent p-0 leading-[1.35] text-ink outline-none min-h-0 max-md:min-h-[120px] max-md:resize-y"
      />
      {/* A textarea prints only what's visible inside it — anything scrolled out of view
          just doesn't appear on the paper. This mirror is what actually gets printed. */}
      <div class="print-only hand whitespace-pre-wrap leading-[1.35] text-ink" data-print={name}>
        {value}
      </div>
    </div>
  );
}

// Reordering uses Pointer Events, not HTML5 drag-and-drop, because the latter does
// nothing on a touchscreen — and this planner mostly lives on a phone. The grip is a
// separate handle so dragging never fights with selecting text in the row.
function Checklist({ todos, onToggle, onText, onReorder, onSelect, onRowMenu }) {
  const listRef = useRef(null);
  const [dragging, setDragging] = useState(null);

  const rowAt = clientY => {
    const rows = [...listRef.current.children];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i].getBoundingClientRect();
      if (clientY >= r.top && clientY <= r.bottom) return i;
    }
    return clientY < rows[0].getBoundingClientRect().top ? 0 : rows.length - 1;
  };

  const move = (from, to) => {
    if (to === from || to < 0 || to >= todos.length) return from;
    const next = todos.slice();
    next.splice(to, 0, ...next.splice(from, 1));
    onReorder(next);
    return to;
  };

  const onPointerDown = (i, e) => {
    e.preventDefault();                          // don't start a text selection
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(i);
  };
  const onPointerMove = e => {
    if (dragging === null) return;
    setDragging(move(dragging, rowAt(e.clientY)));
  };
  const onPointerUp = () => setDragging(null);

  // Keyboard equivalent — the handle is focusable, so a row can be moved without a mouse.
  const onKeyDown = (i, e) => {
    const to = e.key === "ArrowUp" ? i - 1 : e.key === "ArrowDown" ? i + 1 : null;
    if (to === null) return;
    e.preventDefault();
    if (move(i, to) === to) {
      // keep the focus on the handle that just moved
      requestAnimationFrame(() => listRef.current?.children[to]?.querySelector(".grip")?.focus());
    }
  };

  // Enter goes down a line, because this is a list and that is what a list does.
  //
  // Each row is its own <input>, so Enter did nothing at all — you had to reach for the
  // mouse, or Tab past the grip and the tick to get to the next line. On paper you just
  // keep writing.
  //
  // Caret lands at the END of whatever is already on the next line, not at the start:
  // you are continuing down the list, not editing what is already there.
  const onTextKeyDown = (i, e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();                          // never submit anything, never insert a newline
    const next = listRef.current?.children[i + 1]?.querySelector("input[type=text]");
    if (!next) return;                           // last row: stay put rather than wrap
    next.focus();
    next.setSelectionRange(next.value.length, next.value.length);
  };

  return (
    <div class="min-h-0 rounded-md">
      <ul ref={listRef} id="todo-list" class="m-0 flex h-full list-none flex-col overflow-y-auto p-0 max-md:overflow-visible">
        {todos.map((t, i) => (
          <li
            key={i}
            data-rid={t.rid || undefined}
            // overflow-clip is load-bearing, and it is why this app no longer has scrollbars
            // it does not need.
            //
            // The grip, the tick and the row menu each get a 44px hit area from a pseudo-
            // element that deliberately spills outside the button. But an absolutely
            // positioned child still counts toward scrollable overflow — so those few stray
            // pixels on the LAST row gave the checklist a permanent vertical scrollbar (2px
            // of nothing), and the row menu's spill past the right edge gave it a horizontal
            // one (3px of nothing). Two scrollbars, for four pixels that were never content.
            //
            // `clip`, not `hidden`: hidden makes the row a scroll container. clip just clips.
            // The hit areas keep their full size and simply stop existing past the row edge —
            // which is exactly where you would never aim for them anyway.
            class={`flex min-h-[30px] flex-1 items-center gap-1.5 overflow-clip rounded-md py-0.5 pl-2 pr-3 max-md:flex-none max-md:py-1.5 ${
              i % 2 === 0 ? "bg-stripe" : ""
            } ${dragging === i ? "opacity-60 ring-1 ring-muted" : ""}`}
          >
            <button
              type="button"
              class="grip"
              aria-label="Reorder this item"
              title="Drag to reorder (or focus and use ↑ ↓)"
              onPointerDown={e => onPointerDown(i, e)}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onKeyDown={e => onKeyDown(i, e)}
            >
              ⠿
            </button>
            <input type="checkbox" class="tick" checked={t.checked} onChange={e => onToggle(i, e.currentTarget.checked)} />
            <input
              type="text"
              value={t.text}
              onInput={e => onText(i, e.currentTarget.value)}
              onKeyDown={e => onTextKeyDown(i, e)}
              onSelect={e => onSelect({ kind: "todo", index: i }, e.currentTarget)}
              // The text colour is EITHER ink OR faded — never both classes at once.
              // Stacking `text-ink` and `text-faded` leaves the winner to Tailwind's
              // emission order (it emits text-ink last, so ink silently won and the fix
              // did nothing). Two competing colour utilities on one element is a coin
              // toss you lose quietly.
              //
              // faded, not muted: a ticked item should recede, but 2.8:1 is not
              // "receding", it is unreadable. The strikethrough already carries the
              // "done" signal without asking the colour to do it too.
              class={`todo-text hand flex-1 border-0 border-b bg-transparent p-0 py-[3px] outline-none ${
                t.rid ? "border-dashed border-line" : "border-solid border-line"
              } ${t.checked ? "text-faded line-through" : "text-ink"}`}
            />
            {/* The recurring system used to be reachable ONLY by highlighting text — an
                affordance with no visible signal anywhere. On a phone (which is where this
                planner mostly lives) that means a long-press and two drag handles, summoning
                a pill the on-screen keyboard is probably covering. People do not discover
                gestures; they discover controls. So any row with something written on it
                gets a visible one. Selection still works, and still handles the blocks. */}
            {t.text.trim() && (
              <button
                type="button"
                class="row-menu"
                aria-label={`Options for "${t.text.trim()}"`}
                title="Make recurring, or delete"
                onPointerDown={e => e.stopPropagation()}   // don't let Sheet's outside-click drop the selection we're about to set
                onClick={e => onRowMenu(i, e.currentTarget)}
              >
                ⋯
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Sheet({ date, onDateChange, day, onChange, recurring = [], onMakeRecurring, onEditRecurring, onDeleteRecurring }) {
  const [sel, setSel] = useState(null);

  const setBlock = (name, value) =>
    onChange({ ...day, blocks: { ...day.blocks, [name]: value } });

  const setTodo = (i, patch) => {
    const todos = day.todos.map((t, j) => (j === i ? { ...t, ...patch } : t));
    onChange({ ...day, todos });
  };

  // Which recurring item, if any, the highlight belongs to.
  //
  // A to-do carries the id on the row. Block text can't — it's prose — so it's matched
  // by content against the recurring items pointed at that box. Without this, a
  // recurring line in Morning looked like ordinary text and the pill offered to make it
  // recurring all over again.
  const ridFor = (where, text) => {
    if (where.kind === "todo") return day.todos[where.index]?.rid;
    const wanted = text.trim();
    if (!wanted) return undefined;
    return recurring.find(i => (i.target || "todo") === where.name && i.text.trim() === wanted)?.id;
  };

  // Only show the pill for a real (non-empty) highlight.
  const onSelect = (where, el) => {
    const { selectionStart: start, selectionEnd: end } = el;
    if (start === end) { setSel(null); return; }
    const text = el.value.slice(start, end);
    setSel({
      ...where,
      start, end,
      text,
      rid: ridFor(where, text),
      rect: el.getBoundingClientRect()
    });
  };

  // The ⋯ on a to-do row opens the same pill the highlight does, by selecting the whole
  // row. Nothing downstream needs to know the difference: make-recurring, edit, delete
  // recurring and delete all read `sel` and work exactly as before.
  const openRowMenu = (i, el) => {
    const todo = day.todos[i];
    const text = (todo?.text || "").trim();
    if (!text) return;
    setSel({
      kind: "todo",
      index: i,
      start: 0,
      end: todo.text.length,
      text,
      rid: todo.rid,
      rect: el.getBoundingClientRect()
    });
  };

  // A highlight is only meaningful while the field it lives in is focused.
  useEffect(() => {
    const drop = e => {
      if (e.target?.closest?.("#selectionPill")) return;   // clicking the pill isn't "elsewhere"
      setSel(null);
    };
    addEventListener("pointerdown", drop);
    addEventListener("scroll", drop, true);
    return () => {
      removeEventListener("pointerdown", drop);
      removeEventListener("scroll", drop, true);
    };
  }, []);

  const deleteSelection = () => {
    if (!sel) return;
    const cut = s => s.slice(0, sel.start) + s.slice(sel.end);
    if (sel.kind === "block") setBlock(sel.name, cut(day.blocks[sel.name] || ""));
    else setTodo(sel.index, { text: cut(day.todos[sel.index].text || "") });
    setSel(null);
  };

  const makeRecurring = () => {
    if (!sel) return;
    // It comes back where it came from: a to-do to the checklist, a line from Morning
    // to Morning. The source travels with it so the row you highlighted BECOMES the
    // recurring one, rather than a copy of it appearing beside it.
    onMakeRecurring(
      sel.text.trim(),
      sel.kind === "block" ? sel.name : "todo",
      sel.kind === "todo" ? { kind: "todo", index: sel.index } : { kind: "block", name: sel.name }
    );
    setSel(null);
  };

  const deleteRecurring = () => {
    if (!sel?.rid) return;
    onDeleteRecurring(sel.rid);
    setSel(null);
  };

  const editRecurring = () => {
    if (!sel?.rid) return;
    onEditRecurring(sel.rid);
    setSel(null);
  };

  return (
    // Height lives in styles.css (.sheet), not in an inline style — same reason as
    // .block-pane above: an inline height cannot be overridden by a media query, so the
    // `max-md:h-auto` that used to sit in this class list never once applied.
    <div class="sheet mx-[var(--border)] my-[var(--border)] flex flex-col overflow-hidden rounded-[10px] bg-paper px-4 pt-3.5 pb-3 shadow-[0_2px_14px_rgba(0,0,0,.10)] max-md:mt-0 max-md:overflow-visible max-md:pb-6">
      <DateHeader date={date} onDateChange={onDateChange} />
      <div class="grid min-h-0 flex-1 grid-cols-2 gap-3.5 max-md:grid-cols-1">
        <div class="flex min-h-0 flex-col gap-3">
          {BLOCKS.map(name => (
            <Block key={name} name={name} value={day.blocks[name] || ""} onChange={setBlock} onSelect={onSelect} />
          ))}
        </div>
        <Checklist
          todos={day.todos}
          onToggle={(i, checked) => setTodo(i, { checked })}
          onText={(i, text) => setTodo(i, { text })}
          onReorder={todos => onChange({ ...day, todos })}
          onSelect={onSelect}
          onRowMenu={openRowMenu}
        />
      </div>

      <SelectionPill
        sel={sel}
        onDelete={deleteSelection}
        onMakeRecurring={makeRecurring}
        onEditRecurring={editRecurring}
        onDeleteRecurring={deleteRecurring}
      />
    </div>
  );
}
