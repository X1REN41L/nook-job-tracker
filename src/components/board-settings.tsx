"use client";

import { closestCenter, DndContext, KeyboardSensor, PointerSensor, TouchSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent, type DragOverEvent, type DragStartEvent, type KeyboardCoordinateGetter } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { useCallback, useRef, useState } from "react";

import { BOARD_COLORS, BOARD_COLOR_CLASSES, saveBoards, resetBoards, useBoards, type BoardConfiguration, type BoardStatus } from "@/lib/board-preferences";

const keyboardCoordinates: KeyboardCoordinateGetter = (event, args) => {
  if (event.code !== "ArrowUp" && event.code !== "ArrowDown") return undefined;
  const boards = args.context.droppableRects;
  const current = String(args.context.over?.id ?? args.context.active?.id).replace("reorder:", "");
  const rows = [...boards.entries()].sort((a, b) => a[1].top - b[1].top);
  const index = rows.findIndex(([id]) => id === current);
  const target = rows[index + (event.code === "ArrowDown" ? 1 : -1)]?.[1];
  const active = args.context.collisionRect;
  if (!target || !active) return args.currentCoordinates;
  return { x: target.left + (target.width - active.width) / 2, y: target.top + (target.height - active.height) / 2 };
};

export function BoardSettings() {
  const boards = useBoards();
  const [editing, setEditing] = useState<BoardStatus | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [drag, setDrag] = useState<{ active: BoardStatus; over: BoardStatus; height: number } | null>(null);
  const resetRef = useRef<HTMLButtonElement>(null);
  const cancelResetRef = useRef<HTMLButtonElement>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: keyboardCoordinates }),
  );

  function update(status: BoardStatus, patch: Partial<BoardConfiguration>) {
    saveBoards(boards.map((board) => board.status === status ? { ...board, ...patch } : board));
  }

  function reorder(event: DragEndEvent) {
    setDrag(null);
    const from = boards.findIndex((board) => `reorder:${board.status}` === event.active.id);
    const to = boards.findIndex((board) => board.status === event.over?.id);
    if (from < 0 || to < 0 || from === to) return;
    const next = [...boards];
    next.splice(to, 0, next.splice(from, 1)[0]);
    saveBoards(next);
  }

  function startDrag(event: DragStartEvent) {
    const active = String(event.active.id).replace("reorder:", "") as BoardStatus;
    setDrag({ active, over: active, height: event.active.rect.current.initial?.height ?? 48 });
  }

  function moveDrag(event: DragOverEvent) {
    const over = event.over?.id as BoardStatus | undefined;
    if (over) setDrag((current) => current ? { ...current, over } : current);
  }

  const activeIndex = drag ? boards.findIndex((board) => board.status === drag.active) : -1;
  const overIndex = drag ? boards.findIndex((board) => board.status === drag.over) : -1;

  return (
    <div>
      <h3 className="font-serif text-lg font-semibold">Board</h3>
      <p className="mt-1 text-sm text-ink-soft">Customize board names, colors, empty states, and order.</p>
      <DndContext accessibility={{ screenReaderInstructions: { draggable: "Press Space or Enter to pick up a board. Use Up and Down Arrow to move it. Press Space or Enter to drop, or Escape to cancel." } }} collisionDetection={closestCenter} onDragCancel={() => setDrag(null)} onDragEnd={reorder} onDragOver={moveDrag} onDragStart={startDrag} sensors={sensors}>
        <div className="mt-5 divide-y divide-line border-y border-line">
          {boards.map((board, index) => (
            <BoardRow key={board.status} board={board} editing={editing === board.status} shift={drag && index !== activeIndex && overIndex >= 0 && ((activeIndex < index && index <= overIndex) || (overIndex <= index && index < activeIndex)) ? (activeIndex < overIndex ? -drag.height : drag.height) : 0} onEdit={() => setEditing(editing === board.status ? null : board.status)} onUpdate={(patch) => update(board.status, patch)} />
          ))}
        </div>
      </DndContext>
      {confirmReset ? (
        <div aria-label="Reset board defaults confirmation" className="mt-5 rounded-nook-sm border border-line bg-cream p-3 text-sm" role="group">
          <p>Restore default names, colors, empty-state messages, and order? Application data and your default new-application status stay the same.</p>
          <div className="mt-3 flex justify-end gap-2">
            <button ref={cancelResetRef} className="btn-ghost focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest" onClick={() => { setConfirmReset(false); requestAnimationFrame(() => resetRef.current?.focus()); }} type="button">Cancel</button>
            <button className="btn-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest" onClick={() => { resetBoards(); setEditing(null); setConfirmReset(false); requestAnimationFrame(() => resetRef.current?.focus()); }} type="button">Restore defaults</button>
          </div>
        </div>
      ) : (
        <button ref={resetRef} className="mt-5 rounded-nook-sm px-2 py-1 text-sm font-medium text-rose focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest" onClick={() => { setConfirmReset(true); requestAnimationFrame(() => cancelResetRef.current?.focus()); }} type="button">Reset defaults</button>
      )}
    </div>
  );
}

function BoardRow({ board, editing, shift, onEdit, onUpdate }: {
  board: BoardConfiguration;
  editing: boolean;
  shift: number;
  onEdit: () => void;
  onUpdate: (patch: Partial<BoardConfiguration>) => void;
}) {
  const { attributes, listeners, setNodeRef: setDragRef, setActivatorNodeRef, transform, isDragging } = useDraggable({ id: `reorder:${board.status}` });
  const { setNodeRef: setDropRef } = useDroppable({ id: board.status });
  const [draftName, setDraftName] = useState(board.label);
  const [draftEmpty, setDraftEmpty] = useState(board.emptyText);
  const setRefs = useCallback((node: HTMLDivElement | null) => { setDragRef(node); setDropRef(node); }, [setDragRef, setDropRef]);
  const focusClass = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest";

  return (
    <div ref={setRefs} className={`relative ${isDragging ? "z-10 rounded-nook-sm bg-cream shadow-sm" : "transition-transform duration-200 ease-out motion-reduce:transition-none"}`} style={{ transform: isDragging ? `${CSS.Translate.toString(transform)} scale(1.012)` : shift ? `translate3d(0, ${shift}px, 0)` : undefined }}>
      <div className="flex min-h-12 items-center gap-2 py-1.5">
        <button ref={setActivatorNodeRef} {...attributes} {...listeners} aria-label={`Reorder ${board.label} board`} className={`touch-none cursor-grab rounded-nook-sm p-1.5 text-ink-soft active:cursor-grabbing ${focusClass}`} type="button">
          <svg aria-hidden="true" fill="none" height="18" stroke="currentColor" strokeLinecap="round" strokeWidth="2" viewBox="0 0 20 20" width="18"><path d="M3 5h14M3 10h14M3 15h14" /></svg>
        </button>
        <span className={`status-dot ${BOARD_COLOR_CLASSES[board.color]}`} />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{board.label}</span>
        <button aria-expanded={editing} className={`rounded-nook-sm px-2 py-1 text-sm font-medium text-forest hover:bg-forest-tint ${focusClass}`} onClick={() => { setDraftName(board.label); setDraftEmpty(board.emptyText); onEdit(); }} type="button">{editing ? "Done" : "Edit"}</button>
      </div>
      {editing && (
        <div className="grid gap-3 pb-4 pl-9 pr-2">
          <div>
            <label className="mb-1 block text-xs font-semibold" htmlFor={`board-name-${board.status}`}>Name</label>
            <input className={`input max-w-sm text-sm ${focusClass}`} id={`board-name-${board.status}`} maxLength={80} onBlur={() => { if (!draftName.trim()) setDraftName(board.label); }} onChange={(event) => { const value = event.target.value; setDraftName(value); if (value.trim()) onUpdate({ label: value }); }} type="text" value={draftName} />
          </div>
          <fieldset>
            <legend className="mb-1 text-xs font-semibold">Color</legend>
            <div className="flex flex-wrap gap-2">
              {BOARD_COLORS.map((color) => (
                <button key={color} aria-label={color.replace("-", " ")} aria-pressed={board.color === color} className={`flex h-8 w-8 items-center justify-center rounded-full border border-line focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-forest ${board.color === color ? "ring-2 ring-forest ring-offset-2 ring-offset-paper" : ""}`} onClick={() => onUpdate({ color })} type="button"><span className={`h-4 w-4 rounded-full ${BOARD_COLOR_CLASSES[color]}`} /></button>
              ))}
            </div>
          </fieldset>
          <div>
            <label className="mb-1 block text-xs font-semibold" htmlFor={`board-empty-${board.status}`}>Empty state text</label>
            <textarea className={`input max-w-sm resize-y text-sm ${focusClass}`} id={`board-empty-${board.status}`} maxLength={240} onBlur={() => { if (!draftEmpty.trim()) setDraftEmpty(board.emptyText); }} onChange={(event) => { const value = event.target.value; setDraftEmpty(value); if (value.trim()) onUpdate({ emptyText: value }); }} rows={2} value={draftEmpty} />
          </div>
        </div>
      )}
    </div>
  );
}
