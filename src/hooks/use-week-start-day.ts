import { useSyncExternalStore } from "react";

import { useSettings } from "@/hooks/use-settings";

const WEEK_START_DAYS = { saturday: 6, sunday: 0, monday: 1 } as const;

type WeekInfoLocale = Intl.Locale & { getWeekInfo?: () => { firstDay: number }; weekInfo?: { firstDay: number } };

function subscribe() {
  return () => {};
}

/** The browser locale's first day of the week (0 is Sunday), or Monday where the browser can't tell. */
function localeWeekStartDay() {
  try {
    const locale = new Intl.Locale(navigator.language) as WeekInfoLocale;
    const firstDay = (locale.getWeekInfo?.() ?? locale.weekInfo)?.firstDay;
    return firstDay === undefined ? 1 : firstDay % 7;
  } catch {
    return 1;
  }
}

// The server can't see the browser's locale, so it renders Monday and the browser corrects it after hydration.
function serverWeekStartDay() {
  return 1;
}

/** The first day of the week chosen in Settings, counted from Sunday (0) like `Date.getDay`. */
export function useWeekStartDay() {
  const weekStart = useSettings().weekStart;
  const localeDay = useSyncExternalStore(subscribe, localeWeekStartDay, serverWeekStartDay);
  return weekStart === "system" ? localeDay : WEEK_START_DAYS[weekStart];
}
