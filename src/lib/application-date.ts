export function currentLocalDate() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function currentBrowserTimeZone() {
  try {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!timeZone || /^[+-]\d/.test(timeZone)) return "UTC";
    new Intl.DateTimeFormat("en-US", { timeZone });
    return timeZone;
  } catch {
    // UTC is the explicit fallback when the browser cannot supply a usable IANA timezone.
    return "UTC";
  }
}

export function formatAppliedDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { timeZone: "UTC" }).format(new Date(value));
}
