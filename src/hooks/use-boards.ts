import { useMemo } from "react";

import { useSettings } from "@/hooks/use-settings";
import { resolveBoards } from "@/lib/board-preferences";

export function useBoards() {
  const boards = useSettings().boards;
  return useMemo(() => resolveBoards(boards), [boards]);
}
