export function splitPath(path: string): { name: string; dir: string } {
  const i = path.lastIndexOf("/");
  return i < 0 ? { name: path, dir: "" } : { name: path.slice(i + 1), dir: path.slice(0, i) };
}

const rtf = typeof Intl !== "undefined" ? new Intl.RelativeTimeFormat(undefined, { numeric: "auto" }) : null;

/** "3 minutes ago" style relative time for unix seconds. */
export function relativeTime(unixSeconds: number, now: number = Date.now() / 1000): string {
  const diff = unixSeconds - now;
  const abs = Math.abs(diff);
  const table: [number, Intl.RelativeTimeFormatUnit][] = [
    [60, "second"],
    [3600, "minute"],
    [86400, "hour"],
    [86400 * 7, "day"],
    [86400 * 30, "week"],
    [86400 * 365, "month"],
    [Infinity, "year"],
  ];
  const divisors: Record<string, number> = { second: 1, minute: 60, hour: 3600, day: 86400, week: 604800, month: 2592000, year: 31536000 };
  if (abs < 45) return "just now";
  for (const [limit, unit] of table) {
    if (abs < limit) {
      const v = Math.round(diff / (divisors[unit] ?? 1));
      return rtf ? rtf.format(v, unit) : `${Math.abs(v)} ${unit}s ago`;
    }
  }
  return "";
}

export function absoluteTime(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** Guesses a folder name from a clone URL: https://host/o/repo.git → repo */
export function repoNameFromUrl(url: string): string {
  const cleaned = url.trim().replace(/[/\\]+$/, "").replace(/\.git$/i, "");
  const last = cleaned.split(/[/:\\]/).pop() ?? "";
  return last.replace(/[^\w.-]/g, "");
}
