import type { Status } from "@prisma/client";

import { getSettingsState, updateSettings } from "@/lib/settings-store";
import { BOARD_COLORS } from "@/lib/settings-values";
import { STATUS_META } from "@/lib/status-meta";
import { STATUS_VALUES } from "@/lib/status-values";

export const BOARD_STATUSES = STATUS_VALUES;
export type BoardStatus = (typeof BOARD_STATUSES)[number];
export type BoardColor = (typeof BOARD_COLORS)[number];
export const BOARD_COLOR_CLASSES: Record<BoardColor, string> = {
  gold: "bg-gold", sage: "bg-sage", forest: "bg-forest", clay: "bg-clay", rose: "bg-rose", "neutral-dim": "bg-neutral-dim",
};
export type BoardConfiguration = { status: BoardStatus; label: string; color: BoardColor; emptyText: string };
export const DEFAULT_BOARDS: BoardConfiguration[] = BOARD_STATUSES.map((status) => ({
  status, label: STATUS_META[status].label, color: STATUS_META[status].dot.slice(3) as BoardColor, emptyText: STATUS_META[status].empty,
}));
export function getBoards(): BoardConfiguration[] {
  const boards = getSettingsState().settings.boards;
  return boards.length ? boards : DEFAULT_BOARDS;
}
export function saveBoards(boards: BoardConfiguration[] | ((current: BoardConfiguration[]) => BoardConfiguration[])) {
  return updateSettings((settings) => ({ boards: typeof boards === "function" ? boards(settings.boards.length ? settings.boards : DEFAULT_BOARDS) : boards }));
}
export function resetBoards() { return saveBoards([]); }
export function boardFor(boards: BoardConfiguration[], status: Status) { return boards.find((board) => board.status === status); }
export function boardDot(boards: BoardConfiguration[], status: Status) {
  const board = boardFor(boards, status);
  return board ? BOARD_COLOR_CLASSES[board.color] : STATUS_META[status].dot;
}
export function boardLabel(boards: BoardConfiguration[], status: Status) { return boardFor(boards, status)?.label ?? STATUS_META[status].label; }
