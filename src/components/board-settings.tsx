"use client";

import { useRef, useState } from "react";

import { BOARD_COLOR_CLASSES, resetBoards, saveBoardColor, type BoardConfiguration } from "@/lib/board-preferences";
import { BOARD_COLORS } from "@/lib/settings-values";
import { useBoards } from "@/hooks/use-boards";

const focusClass = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest";

export function BoardSettings({ showToast }: { showToast: (message: string) => void }) {
  const boards = useBoards();
  const [confirmReset, setConfirmReset] = useState(false);
  const resetRef = useRef<HTMLButtonElement>(null);
  const cancelResetRef = useRef<HTMLButtonElement>(null);

  return (
    <div>
      <h3 className="font-serif text-lg font-semibold">Board</h3>
      <p className="mt-1 text-sm text-ink-soft">Choose a color for each status.</p>
      <div className="mt-5 divide-y divide-line border-y border-line">
        {boards.map((board) => (
          <BoardColorRow key={board.status} board={board} onSelect={(color) => { void saveBoardColor(board.status, color).catch((error: Error) => showToast(error.message)); }} />
        ))}
      </div>
      {confirmReset ? (
        <div aria-label="Reset board colors confirmation" className="motion-small-reveal mt-5 rounded-nook-sm border border-line bg-cream p-3 text-sm" role="group">
          <p>Restore the default status colors? Application data and your default new-application status stay the same.</p>
          <div className="mt-3 flex justify-end gap-2">
            <button ref={cancelResetRef} className={`btn-ghost ${focusClass}`} onClick={() => { setConfirmReset(false); requestAnimationFrame(() => resetRef.current?.focus()); }} type="button">Cancel</button>
            <button className={`btn-danger ${focusClass}`} onClick={() => { void resetBoards().catch((error: Error) => showToast(error.message)); setConfirmReset(false); requestAnimationFrame(() => resetRef.current?.focus()); }} type="button">Restore defaults</button>
          </div>
        </div>
      ) : (
        <button ref={resetRef} className={`mt-5 rounded-nook-sm px-2 py-1 text-sm font-medium text-rose ${focusClass}`} onClick={() => { setConfirmReset(true); requestAnimationFrame(() => cancelResetRef.current?.focus()); }} type="button">Reset colors</button>
      )}
    </div>
  );
}

function BoardColorRow({ board, onSelect }: { board: BoardConfiguration; onSelect: (color: BoardConfiguration["color"]) => void }) {
  return (
    <fieldset className="flex min-h-12 flex-wrap items-center justify-between gap-x-4 gap-y-2 py-2">
      <legend className="float-left flex items-center gap-2 text-sm font-medium">
        <span className={`status-dot ${BOARD_COLOR_CLASSES[board.color]}`} />{board.label}
      </legend>
      <div className="flex flex-wrap gap-1.5">
        {BOARD_COLORS.map((color) => (
          <button key={color} aria-label={`${board.label}: ${color.replace("-", " ")}`} aria-pressed={board.color === color} className={`flex h-7 w-7 items-center justify-center rounded-full border border-line focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-forest ${board.color === color ? "ring-2 ring-forest ring-offset-2 ring-offset-paper" : ""}`} onClick={() => onSelect(color)} type="button"><span className={`h-3.5 w-3.5 rounded-full ${BOARD_COLOR_CLASSES[color]}`} /></button>
        ))}
      </div>
    </fieldset>
  );
}
