export function currentLocalDate() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function formatAppliedDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { timeZone: "UTC" }).format(new Date(value));
}
