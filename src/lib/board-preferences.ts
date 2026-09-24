import { Status } from "@prisma/client";
import { useSyncExternalStore } from "react";

import { DEFAULT_BOARD_STATUSES, PREFERENCE_CHANGE_EVENT, subscribeToPreferences } from "@/lib/general-preferences";
import { STATUS_META } from "@/lib/status-meta";

export const BOARD_PREFERENCE_KEY = "nook-board-configuration";
export const BOARD_STATUSES = DEFAULT_BOARD_STATUSES;
export type BoardStatus = (typeof BOARD_STATUSES)[number];
export const BOARD_COLORS = ["gold", "sage", "forest", "clay", "rose", "neutral-dim"] as const;
export type BoardColor = (typeof BOARD_COLORS)[number];
export const BOARD_COLOR_CLASSES: Record<BoardColor, string> = {
  gold: "bg-gold", sage: "bg-sage", forest: "bg-forest", clay: "bg-clay", rose: "bg-rose", "neutral-dim": "bg-neutral-dim",
};
export type BoardConfiguration = { status: BoardStatus; label: string; color: BoardColor; emptyText: string };

const DEFAULT_BOARDS: BoardConfiguration[] = BOARD_STATUSES.map((status) => ({
  status,
  label: STATUS_META[status].label,
  color: STATUS_META[status].dot.slice(3) as BoardColor,
  emptyText: STATUS_META[status].empty,
}));

let cachedRaw: string | null = null;
let cachedBoards: BoardConfiguration[] = DEFAULT_BOARDS;

export function normalizeBoards(value: unknown): BoardConfiguration[] {
  if (!Array.isArray(value)) return DEFAULT_BOARDS;
  const entries = new Map<BoardStatus, Partial<BoardConfiguration>>();
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const candidate = item as Record<string, unknown>;
    if (!BOARD_STATUSES.includes(candidate.status as BoardStatus) || entries.has(candidate.status as BoardStatus)) continue;
    entries.set(candidate.status as BoardStatus, candidate);
  }
  const order = [...entries.keys(), ...BOARD_STATUSES.filter((status) => !entries.has(status))];
  return order.map((status) => {
    const entry = entries.get(status);
    const fallback = DEFAULT_BOARDS.find((board) => board.status === status)!;
    return {
      status,
      label: typeof entry?.label === "string" && entry.label.trim() && entry.label.length <= 80 ? entry.label.trim() : fallback.label,
      color: BOARD_COLORS.includes(entry?.color as BoardColor) ? entry!.color as BoardColor : fallback.color,
      emptyText: typeof entry?.emptyText === "string" && entry.emptyText.trim() && entry.emptyText.length <= 240 ? entry.emptyText.trim() : fallback.emptyText,
    };
  });
}

export function getBoards(): BoardConfiguration[] {
  let raw: string | null;
  try { raw = localStorage.getItem(BOARD_PREFERENCE_KEY); } catch { return DEFAULT_BOARDS; }
  if (raw === cachedRaw) return cachedBoards;
  cachedRaw = raw;
  try { cachedBoards = normalizeBoards(raw ? JSON.parse(raw) : null); }
  catch { cachedBoards = DEFAULT_BOARDS; }
  return cachedBoards;
}

export function saveBoards(boards: BoardConfiguration[]) {
  try {
    const raw = JSON.stringify(normalizeBoards(boards));
    localStorage.setItem(BOARD_PREFERENCE_KEY, raw);
    cachedRaw = raw;
    cachedBoards = normalizeBoards(boards);
    window.dispatchEvent(new Event(PREFERENCE_CHANGE_EVENT));
  } catch {
    // Keep the last stored configuration when storage is unavailable.
  }
}

export function resetBoards() {
  try {
    localStorage.removeItem(BOARD_PREFERENCE_KEY);
    cachedRaw = null;
    cachedBoards = DEFAULT_BOARDS;
    window.dispatchEvent(new Event(PREFERENCE_CHANGE_EVENT));
  } catch {
    // Keep the last stored configuration when storage is unavailable.
  }
}

export function useBoards() {
  return useSyncExternalStore(subscribeToPreferences, getBoards, () => DEFAULT_BOARDS);
}

export function boardFor(boards: BoardConfiguration[], status: Status) {
  return boards.find((board) => board.status === status);
}

export function boardDot(boards: BoardConfiguration[], status: Status) {
  const board = boardFor(boards, status);
  return board ? BOARD_COLOR_CLASSES[board.color] : STATUS_META[status].dot;
}

export function boardLabel(boards: BoardConfiguration[], status: Status) {
  return boardFor(boards, status)?.label ?? STATUS_META[status].label;
}
