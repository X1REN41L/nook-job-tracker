import { useSettings } from "@/hooks/use-settings";

/** The clock (Automatic, 12-hour, or 24-hour) chosen in Settings, for formatting times. */
export function useTimeFormat() {
  return useSettings().timeFormat;
}
