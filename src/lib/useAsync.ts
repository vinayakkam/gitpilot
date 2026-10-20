import { useCallback, useEffect, useRef, useState } from "react";
import type { AppError } from "@/bindings/AppError";
import { toAppError } from "./errors";

/** Loads data with cancellation of stale responses. `deps` changes trigger a reload. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[], enabled = true) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const [loading, setLoading] = useState(enabled);
  const seq = useRef(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const reload = useCallback(async () => {
    const s = ++seq.current;
    setLoading(true);
    try {
      const d = await fnRef.current();
      if (s === seq.current) {
        setData(d);
        setError(null);
      }
    } catch (e) {
      if (s === seq.current) setError(toAppError(e));
    } finally {
      if (s === seq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (enabled) void reload();
    else seq.current++;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, enabled]);

  return { data, error, loading, reload, setData };
}

export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return v;
}
