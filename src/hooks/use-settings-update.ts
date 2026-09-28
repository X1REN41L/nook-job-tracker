import { useCallback } from "react";

import { updateSettings } from "@/lib/settings-store";
import type { ParsedBackupSettings } from "@/lib/backup-settings-schema";

type Changes = Partial<ParsedBackupSettings> | ((settings: ParsedBackupSettings) => Partial<ParsedBackupSettings>);

export function useSettingsUpdate(showToast: (message: string) => void) {
  return useCallback((changes: Changes) => {
    void updateSettings(changes).catch((error: unknown) => showToast(error instanceof Error ? error.message : "Could not save settings"));
  }, [showToast]);
}
