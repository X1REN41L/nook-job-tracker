type DateEvents = Pick<Window, "addEventListener" | "removeEventListener" | "setTimeout" | "clearTimeout">;
type VisibilityEvents = Pick<Document, "addEventListener" | "removeEventListener" | "visibilityState">;

type ClockEnvironment = { window: DateEvents; document: VisibilityEvents };

export function subscribeToLocalDate(onStoreChange: () => void, environment: ClockEnvironment = { window, document }) {
  return subscribeToLocalClock((now) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1), onStoreChange, environment);
}

export function subscribeToLocalMinute(onStoreChange: () => void, environment: ClockEnvironment = { window, document }) {
  return subscribeToLocalClock((now) => new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes() + 1), onStoreChange, environment);
}

/** Notifies at each `nextChange` and whenever the page becomes visible again. */
function subscribeToLocalClock(nextChange: (now: Date) => Date, onStoreChange: () => void, { window: browserWindow, document: browserDocument }: ClockEnvironment) {
  let timeout: number;
  const arm = () => {
    browserWindow.clearTimeout(timeout);
    const now = new Date();
    timeout = browserWindow.setTimeout(() => {
      onStoreChange();
      arm();
    }, nextChange(now).getTime() - now.getTime());
  };
  const onVisible = () => {
    if (browserDocument.visibilityState !== "visible") return;
    onStoreChange();
    arm();
  };
  arm();
  browserDocument.addEventListener("visibilitychange", onVisible);
  return () => {
    browserWindow.clearTimeout(timeout);
    browserDocument.removeEventListener("visibilitychange", onVisible);
  };
}
