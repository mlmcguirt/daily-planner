import { DAY_LABELS, weekdayOf, shiftDate, DATE_RE } from "../lib/day.js";

const FULL_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

// The M–S marker is derived from the date, never stored — a saved weekday that
// disagrees with the date is simply wrong.
export function DateHeader({ date, onDateChange }) {
  const [y, m, d] = date.split("-");
  const usable = DATE_RE.test(date);            // a half-typed date has no week to move within
  const active = usable ? weekdayOf(date) : -1;

  const set = (part, value) => {
    const next = { y, m, d, [part]: value };
    onDateChange(`${next.y || "0000"}-${(next.m || "00").padStart(2, "0")}-${(next.d || "00").padStart(2, "0")}`);
  };

  const field = "border-0 border-b border-muted bg-transparent p-0 pb-0.5 text-center text-[15px] text-ink outline-none";

  return (
    <header class="mb-3 flex flex-none flex-wrap items-center justify-between gap-3">
      {/* Clicking a weekday jumps to that day of the week you're currently looking at —
          relative to the open date, not to today, or paging back a month and tapping W
          would fling you into this week. The arrows move a whole week, keeping the
          weekday you're on: Wednesday -> the previous Wednesday. */}
      <div class="days flex items-center gap-1">
        <StepButton id="prevWeek" label="Previous week" date={date} onDateChange={onDateChange} by={-7}>‹</StepButton>
        {DAY_LABELS.map((label, i) => (
          <button
            key={i}
            type="button"
            data-idx={i}
            aria-label={`Go to ${FULL_DAYS[i]} of this week`}
            // The day you're on, said out loud rather than only drawn. A screen reader now
            // announces it, and the tests can ask which day is current without knowing what
            // it happens to look like this week.
            aria-current={i === active ? "date" : undefined}
            title={FULL_DAYS[i]}
            disabled={!usable}
            onClick={() => usable && onDateChange(shiftDate(date, i - active))}
            // The day you're on is BOLD. It used to be a black box with a white letter —
            // a filled chip sitting on the paper, the heaviest mark on the whole sheet, for
            // something that is just "you are here". Weight says the same thing in the
            // page's own voice, and says it more quietly.
            class={`flex h-[34px] w-[34px] items-center justify-center rounded-lg border-0 bg-transparent text-lg text-ink hover:bg-stripe ${
              i === active ? "font-bold" : "font-normal"
            } ${usable ? "cursor-pointer" : "cursor-default opacity-40"}`}
          >
            {label}
          </button>
        ))}
        <StepButton id="nextWeek" label="Next week" date={date} onDateChange={onDateChange} by={7}>›</StepButton>
      </div>
      <div class="flex items-center gap-1.5">
        <StepButton id="prevDay" label="Previous day" date={date} onDateChange={onDateChange} by={-1}>‹</StepButton>
        <input id="mm" class={`${field} w-[34px]`} inputmode="numeric" maxlength="2" placeholder="MM"
          value={m} onInput={e => set("m", e.currentTarget.value)} />
        <span class="text-muted">/</span>
        <input id="dd" class={`${field} w-[34px]`} inputmode="numeric" maxlength="2" placeholder="DD"
          value={d} onInput={e => set("d", e.currentTarget.value)} />
        <span class="text-muted">/</span>
        <input id="yy" class={`${field} w-[52px]`} inputmode="numeric" maxlength="4" placeholder="YYYY"
          value={y} onInput={e => set("y", e.currentTarget.value)} />
        <StepButton id="nextDay" label="Next day" date={date} onDateChange={onDateChange} by={1}>›</StepButton>
      </div>
    </header>
  );
}

// Steps a day at a time. Disabled while the date is half-typed — stepping from an
// incomplete date would land somewhere arbitrary.
function StepButton({ id, label, date, onDateChange, by, children }) {
  const usable = DATE_RE.test(date);
  return (
    <button
      id={id}
      type="button"
      aria-label={label}
      title={label}
      disabled={!usable}
      onClick={() => usable && onDateChange(shiftDate(date, by))}
      // No border, no box. The weekday letters beside these are bare glyphs that tint on
      // hover; boxing the arrows made them read as chrome sitting on the paper, when they
      // are the same kind of control. They keep their full 26x30 hit area — only the
      // outline goes.
      class="flex h-[30px] w-[26px] flex-none items-center justify-center rounded-md border-0 bg-transparent text-[17px] leading-none text-ink hover:bg-stripe disabled:cursor-default disabled:opacity-40"
    >
      {children}
    </button>
  );
}
