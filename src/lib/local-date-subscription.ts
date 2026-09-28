type DateEvents = Pick<Window, "addEventListener" | "removeEventListener" | "setTimeout" | "clearTimeout">;
type VisibilityEvents = Pick<Document, "addEventListener" | "removeEventListener" | "visibilityState">;

export function subscribeToLocalDate(onStoreChange: () => void, environment: { window: DateEvents; document: VisibilityEvents } = { window, document }) {
  const { window: browserWindow, document: browserDocument } = environment;
  let timeout: number;
  const arm = () => {
    browserWindow.clearTimeout(timeout);
    const now = new Date();
    const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    timeout = browserWindow.setTimeout(() => {
      onStoreChange();
      arm();
    }, nextMidnight.getTime() - now.getTime());
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
