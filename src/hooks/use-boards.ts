import { useSettings } from "@/hooks/use-settings";
import { DEFAULT_BOARDS } from "@/lib/board-preferences";

export function useBoards() {
  const boards = useSettings().boards;
  return boards.length ? boards : DEFAULT_BOARDS;
}
