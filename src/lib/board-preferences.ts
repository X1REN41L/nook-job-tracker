import type { Status } from "@prisma/client";

import type { ParsedBackupSettings } from "@/lib/backup-settings-schema";
import { getSettingsState, updateSettings } from "@/lib/settings-store";
import { BOARD_COLORS } from "@/lib/settings-values";
import { STATUS_META } from "@/lib/status-meta";
import { STATUS_VALUES } from "@/lib/status-values";

export const BOARD_STATUSES = STATUS_VALUES;
export type BoardStatus = (typeof BOARD_STATUSES)[number];
export type BoardColor = (typeof BOARD_COLORS)[number];
export const BOARD_COLOR_CLASSES: Record<BoardColor, string> = {
  gold: "bg-gold", sage: "bg-sage", forest: "bg-forest", teal: "bg-teal", clay: "bg-clay", rose: "bg-rose", "neutral-dim": "bg-neutral-dim",
};
export type BoardConfiguration = { status: BoardStatus; label: string; color: BoardColor; emptyText: string };
type SavedBoards = ParsedBackupSettings["boards"];

// Only colors are customizable; names, empty-state text, and column order are fixed.
export function resolveBoards(saved: SavedBoards): BoardConfiguration[] {
  return BOARD_STATUSES.map((status) => ({
    status,
    label: STATUS_META[status].label,
    color: saved.find((board) => board.status === status)?.color ?? (STATUS_META[status].dot.slice(3) as BoardColor),
    emptyText: STATUS_META[status].empty,
  }));
}
export const DEFAULT_BOARDS = resolveBoards([]);
export function getBoards(): BoardConfiguration[] {
  return resolveBoards(getSettingsState().settings.boards);
}
export function saveBoardColor(status: BoardStatus, color: BoardColor) {
  return updateSettings((settings) => ({
    boards: resolveBoards(settings.boards).map((board) => ({ status: board.status, color: board.status === status ? color : board.color })),
  }));
}
export function resetBoards() { return updateSettings({ boards: [] }); }
export function boardFor(boards: BoardConfiguration[], status: Status) { return boards.find((board) => board.status === status); }
export function boardDot(boards: BoardConfiguration[], status: Status) {
  const board = boardFor(boards, status);
  return board ? BOARD_COLOR_CLASSES[board.color] : STATUS_META[status].dot;
}
export function boardLabel(boards: BoardConfiguration[], status: Status) { return boardFor(boards, status)?.label ?? STATUS_META[status].label; }
