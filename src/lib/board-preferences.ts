import type { Status } from "@prisma/client";

import { STATUS_META } from "@/lib/status-meta";
import { STATUS_VALUES } from "@/lib/status-values";

export const BOARD_STATUSES = STATUS_VALUES;
type BoardStatus = (typeof BOARD_STATUSES)[number];
export type BoardConfiguration = { status: BoardStatus; label: string; dot: string; emptyText: string };

// Board names, colors, empty-state text, and column order are fixed.
export const BOARDS: BoardConfiguration[] = BOARD_STATUSES.map((status) => ({
  status,
  label: STATUS_META[status].label,
  dot: STATUS_META[status].dot,
  emptyText: STATUS_META[status].empty,
}));
function boardFor(boards: BoardConfiguration[], status: Status) { return boards.find((board) => board.status === status); }
export function boardDot(boards: BoardConfiguration[], status: Status) { return boardFor(boards, status)?.dot ?? STATUS_META[status].dot; }
export function boardLabel(boards: BoardConfiguration[], status: Status) { return boardFor(boards, status)?.label ?? STATUS_META[status].label; }
