// Running an API call from a screen: busy while it runs, the player reloaded
// after it, and any error kept to show.

import { useState } from "react";

/** Run an API call, then reload the player; surfaces any error. */
export function useAct(refresh: () => Promise<unknown>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, act };
}
