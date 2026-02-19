import { format } from "date-fns";

export function renderTemplate(
  template: string,
  vars: Record<string, string> = {},
): string {
  const now = new Date();
  const defaults: Record<string, string> = {
    date: format(now, "yyyy-MM-dd"),
    datetime: format(now, "yyyy-MM-dd_HH-mm-ss"),
    time: format(now, "HH-mm-ss"),
    year: format(now, "yyyy"),
    month: format(now, "MM"),
    day: format(now, "dd"),
  };

  const merged = { ...defaults, ...vars };
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    return merged[key] ?? `{{${key}}}`;
  });
}
