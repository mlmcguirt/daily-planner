// A small pill that appears next to highlighted text in a block or a to-do.
//
// onMouseDown must preventDefault: clicking a button would otherwise blur the field
// and wipe the selection before the click ever lands.
export function SelectionPill({ sel, onDelete, onMakeRecurring, onEditRecurring, onDeleteRecurring }) {
  if (!sel) return null;

  // Something already recurring gets Edit / Delete recurring / Delete. Anything else
  // can only be made recurring — offering both at once would be nonsense.
  const isRecurring = !!sel.rid;

  // Anchored just above the field the selection is in. Clamped so it can't run off
  // the top of the window or past the right edge.
  const top = Math.max(6, sel.rect.top - 38);
  const width = isRecurring ? 300 : 210;
  const left = Math.min(sel.rect.left + 8, window.innerWidth - width);

  return (
    <div
      id="selectionPill"
      class="fixed z-20 flex items-center gap-1 rounded-full border border-muted bg-white px-1 py-1 shadow-md"
      style={{ top: `${top}px`, left: `${left}px` }}
      onMouseDown={e => e.preventDefault()}
      onPointerDown={e => e.preventDefault()}
    >
      {isRecurring ? (
        <>
          <button
            id="pillEditRecurring"
            type="button"
            onClick={onEditRecurring}
            class="rounded-full px-3 py-1 text-[13px] text-ink hover:bg-stripe"
          >
            Edit
          </button>
          <span class="h-4 w-px bg-line" />
          <button
            id="pillDeleteRecurring"
            type="button"
            onClick={onDeleteRecurring}
            class="rounded-full px-3 py-1 text-[13px] text-alarm hover:bg-stripe"
          >
            Delete recurring
          </button>
        </>
      ) : (
        <button
          id="pillRecurring"
          type="button"
          onClick={onMakeRecurring}
          class="rounded-full px-3 py-1 text-[13px] text-ink hover:bg-stripe"
        >
          Make recurring
        </button>
      )}
      <span class="h-4 w-px bg-line" />
      <button
        id="pillDelete"
        type="button"
        onClick={onDelete}
        class="rounded-full px-3 py-1 text-[13px] text-alarm hover:bg-stripe"
      >
        Delete
      </button>
    </div>
  );
}
