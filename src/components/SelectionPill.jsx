// A small pill that appears next to highlighted text in a block or a to-do.
//
// onMouseDown must preventDefault: clicking a button would otherwise blur the field
// and wipe the selection before the click ever lands.
export function SelectionPill({ sel, onDelete, onMakeRecurring, onEditRecurring, onDeleteRecurring }) {
  if (!sel) return null;

  // Something already recurring gets Edit / Delete recurring / Delete. Anything else
  // can only be made recurring — offering both at once would be nonsense.
  const isRecurring = !!sel.rid;

  // Anchored to the selection, but kept wholly on-screen — this pill is the only door to
  // the recurring feature, so a phone that pushes it off the edge makes that feature
  // unreachable. The recurring variant is 300px wide; on a narrow viewport its left used
  // to go negative (Math.min with no floor) and it slid off the left edge.
  const MARGIN = 8;
  const width = isRecurring ? 300 : 210;

  // Horizontal: track the selection's left, but never past either edge.
  const left = Math.max(MARGIN, Math.min(sel.rect.left + MARGIN, window.innerWidth - width - MARGIN));

  // Vertical: sit above the field when there's room; otherwise below it. Clamping to the
  // top edge (the old Math.max(6, …)) parked the pill ON TOP of a selection near the top
  // of the screen — hiding the very text it acts on.
  const above = sel.rect.top - 38;
  const top = above >= MARGIN ? above : sel.rect.bottom + MARGIN;

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
