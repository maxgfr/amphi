// React reads of the database: a query runs again whenever one of the tables
// it reads changes, here or in another tab.

import { useEffect, useRef, useState } from "react";
import { getBlob, onChange } from "./db.ts";
import type { Id, Table } from "./schema.ts";

/** `undefined` while loading, then the query's result, refreshed when `tables` change. */
export function useLive<R>(query: () => Promise<R>, tables: readonly (Table | "blobs")[], deps: readonly unknown[]): R | undefined {
  const [value, setValue] = useState<R | undefined>(undefined);
  const run = useRef(0);
  useEffect(() => {
    let alive = true;
    const go = () => {
      const n = ++run.current;
      void query().then(
        (v) => alive && n === run.current && setValue(() => v),
        () => {},
      );
    };
    go();
    const off = onChange((t) => tables.includes(t) && go());
    return () => {
      alive = false;
      off();
    };
    // The caller lists the query's dependencies.
  }, deps);
  return value;
}

/** An object URL for a stored file, revoked when no longer shown. */
export function useBlobUrl(id: Id | undefined): string | undefined {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!id) return setUrl(undefined);
    let u: string | undefined;
    let alive = true;
    void getBlob(id).then((b) => {
      if (!alive || !b) return;
      u = URL.createObjectURL(b.data);
      setUrl(u);
    });
    return () => {
      alive = false;
      if (u) URL.revokeObjectURL(u);
    };
  }, [id]);
  return url;
}
