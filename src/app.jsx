import { useState, useEffect, useRef, useCallback } from "preact/hooks";
import { createSync } from "./lib/sync.js";
import {
  DATE_RE, todayStr, weekdayOf, shiftDate, normalize, emptyDay,
  mergeRecurring, pruneRecurring, isUntouched, carryOverItems, addCarried
} from "./lib/day.js";
import { PassphraseGate } from "./components/PassphraseGate.jsx";
import { Sheet } from "./components/Sheet.jsx";
import { Toolbar } from "./components/Toolbar.jsx";
import { SearchDialog } from "./components/SearchDialog.jsx";
import { RecurringDialog } from "./components/RecurringDialog.jsx";
import { ConflictDialog } from "./components/ConflictDialog.jsx";

const SAVE_DEBOUNCE = 400;

export function App() {
  const [key, setKey] = useState(() => localStorage.getItem("planner:key") || "");
  if (!key) {
    return <PassphraseGate onOpen={v => { localStorage.setItem("planner:key", v); setKey(v); }} />;
  }
  return <Planner key={key} passphrase={key} onSignOut={() => setKey("")} />;
}

function Planner({ passphrase, onSignOut }) {
  const sync = useRef(null);
  if (!sync.current) sync.current = createSync(passphrase);
  const s = sync.current;

  const [date, setDate] = useState(todayStr);
  const [day, setDay] = useState(() => emptyDay(weekdayOf(todayStr())));
  const [recurring, setRecurring] = useState([]);
  const [status, setStatus] = useState(s.status());
  const [conflict, setConflict] = useState(null);
  const [carry, setCarry] = useState(null);
  const [dialog, setDialog] = useState(null);   // "search" | "recurring"
  const [prefill, setPrefill] = useState(null); // a highlighted phrase, on its way to becoming recurring
  const [editingRid, setEditingRid] = useState(null); // a recurring item to open the editor on
  const [adopt, setAdopt] = useState(null);           // the highlighted row/line awaiting its new rid

  const saveTimer = useRef(null);
  const dateRef = useRef(date);
  dateRef.current = date;
  // load() is async; by the time the fetch lands the recurring list may have arrived,
  // so it reads the latest through a ref rather than whatever it captured on the way in.
  const recurringRef = useRef(recurring);
  recurringRef.current = recurring;

  // ---- status + conflicts -------------------------------------------------
  useEffect(() => {
    const unsub = s.subscribe(setStatus);
    s.onConflict = d => setConflict(prev => prev || s.conflictFor(d));
    return () => { unsub(); s.destroy(); };
  }, []);

  // ---- recurring list, once -----------------------------------------------
  useEffect(() => { s.getRecurring().then(setRecurring); }, []);

  // ---- load a day ---------------------------------------------------------
  // Local/queued copy first so the page is never blank, then the server's version
  // — but a queued edit is fresher than the server and must not be overwritten.
  // Prune before merge: a stored day can still carry a row from a recurring item that
  // has since been deleted or moved to another weekday. Dropping it at render time
  // (rather than only when it's deleted) keeps this correct no matter what order the
  // save, the fetch and the recurring change land in.
  const dress = (data, recur, wd) =>
    mergeRecurring(pruneRecurring(normalize(data, wd), recur, wd), recur, wd);

  const load = useCallback(async ds => {
    if (!DATE_RE.test(ds)) return;
    const wd = weekdayOf(ds);

    // An unsent edit is the freshest thing we have; then the local copy; then blank.
    const shown = s.queuedDay(ds) || s.localDay(ds);
    setDay(dress(shown, recurringRef.current, wd));

    const res = await s.fetchDay(ds);
    if (dateRef.current !== ds) return;           // user moved on while we were fetching

    // The server only wins when we have nothing queued for this day.
    if (res.ok && !s.queuedDay(ds)) {
      setDay(dress(res.data, recurringRef.current, wd));
    }
    refreshCarry(ds);
  }, []);

  useEffect(() => { load(date); }, [date]);

  // A change to the recurring list must NOT refetch the day. Doing so rebuilt the sheet
  // from the last-saved copy — which, right after you make something recurring, is the
  // version from before it was adopted — and the merge then added a second copy beside
  // the row you'd just converted. Re-merge what's on screen instead.
  useEffect(() => {
    if (!DATE_RE.test(date)) return;
    const wd = weekdayOf(date);
    setDay(d => mergeRecurring(pruneRecurring(d, recurring, wd), recurring, wd));
  }, [recurring]);

  useEffect(() => { s.flush(); }, []);            // anything stranded from a past session

  // ---- carry over ---------------------------------------------------------
  const refreshCarry = useCallback(async (ds = dateRef.current) => {
    setCarry(null);
    // Only offered while today's list is still untouched by you.
    const current = s.queuedDay(ds) || s.localDay(ds);
    if (current && !isUntouched(normalize(current, weekdayOf(ds)))) return;

    const prevDate = shiftDate(ds, -1);
    const prev = await s.anyDay(prevDate);
    if (dateRef.current !== ds) return;
    const items = carryOverItems(prev);
    if (!items.length) return;
    setCarry({ count: items.length, from: prevDate.slice(5).replace("-", "/"), items });
  }, []);

  // ---- saving -------------------------------------------------------------
  const change = useCallback(next => {
    setDay(next);
    clearTimeout(saveTimer.current);
    const ds = dateRef.current;
    saveTimer.current = setTimeout(() => {
      if (!DATE_RE.test(ds)) return;
      s.enqueue(ds, next);
      s.flush();
    }, SAVE_DEBOUNCE);
  }, []);

  // ---- actions ------------------------------------------------------------
  const doCarry = () => {
    const next = addCarried(day, carry.items);
    setCarry(null);
    change(next);
  };

  const doClear = () => {
    if (!confirm("Clear this day's entries?")) return;
    change(mergeRecurring(emptyDay(weekdayOf(date)), recurring, weekdayOf(date)));
  };

  // In the demo this button says "Reset demo" and does something quite different.
  //
  // Sign out clears planner:key, which would resurrect the passphrase gate the demo
  // exists to bypass — a stranger would be asked to invent a passphrase for a planner
  // with no server. So reset keeps the key, wipes what the demo owns, re-seeds, and
  // RELOADS: app.jsx:26 memoises the sync object for the component's lifetime, so
  // rewriting localStorage underneath a live component changes nothing on screen.
  const doSignOut = async () => {
    if (import.meta.env.VITE_DEMO) {
      if (!confirm("Reset the demo back to its starting day?")) return;
      const { resetDemo } = await import("./lib/demo-api.js");
      resetDemo();
      location.reload();
      return;
    }

    const { pending } = s.status();
    if (pending && !confirm(
      `${pending} day(s) haven't synced yet. Signing out on this device keeps them here, but ` +
      `they won't reach your other devices until you sign back in. Sign out anyway?`
    )) return;
    localStorage.removeItem("planner:key");
    onSignOut();
  };

  const resolve = which => {
    const d = conflict.date;
    if (which === "mine") {
      s.keepMine(d);
    } else {
      const theirs = s.useTheirs(d);
      if (d === dateRef.current) {
        setDay(dress(theirs, recurring, weekdayOf(d)));
      }
    }
    setConflict(s.nextConflict());               // deal with any others, one at a time
  };

  // Stop something repeating, from the pill. Confirmed first: it affects every future
  // day, not just this one, which isn't obvious from where you're standing.
  const stopRecurring = async rid => {
    const item = recurring.find(i => i.id === rid);
    if (!item) return;
    if (!confirm(`Stop "${item.text}" from repeating? It stays on days where you've already ticked it.`)) return;

    const next = recurring.filter(i => i.id !== rid);
    try {
      const saved = await s.putRecurring(next);
      setRecurring(saved);
      const wd = weekdayOf(date);
      change(pruneRecurring(day, saved, wd));   // take it off today too
    } catch {
      alert("Couldn't update your recurring to-dos — you appear to be offline. Your day's entries are still saved; try again once you're back online.");
    }
  };

  const onRecurringSaved = items => {
    setRecurring(items);
    setDialog(null);
    const wd = weekdayOf(date);

    // If this came from highlighting something on the sheet, that row/line becomes the
    // recurring item rather than gaining a duplicate next to it.
    const claimed = adopt && items.some(i => i.id === adopt.rid) ? adopt : null;
    setAdopt(null);

    if (!claimed) {
      setDay(d => mergeRecurring(pruneRecurring(d, items, wd), items, wd));
      return;
    }

    let next = day;
    if (claimed.kind === "todo") {
      // the highlighted row takes the id, so mergeRecurring sees it as already present
      next = {
        ...next,
        todos: next.todos.map((t, j) =>
          j === claimed.index && !t.rid ? { ...t, rid: claimed.rid } : t
        )
      };
    } else {
      // the line is already written in the block; record it so it isn't added again
      next = { ...next, applied: [...(next.applied || []), claimed.rid] };
    }

    next = mergeRecurring(pruneRecurring(next, items, wd), items, wd);
    change(next);        // persist the claim, or a reload would duplicate it
  };

  return (
    <>
      <Toolbar
        carry={carry}
        status={status}
        onCarry={doCarry}
        onSearch={() => setDialog("search")}
        onRecurring={() => setDialog("recurring")}
        onClear={doClear}
        onPrint={() => window.print()}
        onRetry={() => s.retryNow()}
        onSignOut={doSignOut}
      />

      <Sheet
        date={date}
        onDateChange={setDate}
        day={day}
        onChange={change}
        recurring={recurring}
        onMakeRecurring={(text, target, source) => {
          if (!text) return;
          // Prefilled, not silently created: which weekdays it repeats on is a choice
          // only you can make. Today's weekday is ticked as the obvious starting point,
          // and it keeps the box it came from.
          //
          // The id is minted here, not in the dialog, so that when the item is saved we
          // can hand it to the thing you highlighted — making that row/line the recurring
          // one instead of leaving it beside a freshly-merged duplicate.
          const rid = `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
          setPrefill({ id: rid, text, weekdays: [weekdayOf(date)], target });
          setAdopt({ rid, ...source });
          setDialog("recurring");
        }}
        onEditRecurring={rid => {
          // Open the editor on that item — landing in an unsorted list and having to
          // find it again would defeat the point of clicking it.
          setEditingRid(rid);
          setDialog("recurring");
        }}
        onDeleteRecurring={stopRecurring}
      />

      {dialog === "search" && (
        <SearchDialog
          sync={s}
          onClose={() => setDialog(null)}
          onPick={d => { setDialog(null); setDate(d); }}
        />
      )}

      {dialog === "recurring" && (
        <RecurringDialog
          items={recurring}
          prefill={prefill}
          focusId={editingRid}
          sync={s}
          onSaved={items => { setPrefill(null); setEditingRid(null); onRecurringSaved(items); }}
          onClose={() => { setPrefill(null); setEditingRid(null); setAdopt(null); setDialog(null); }}
        />
      )}

      {conflict && (
        <ConflictDialog
          conflict={conflict}
          onKeepMine={() => resolve("mine")}
          onUseTheirs={() => resolve("theirs")}
        />
      )}
    </>
  );
}
