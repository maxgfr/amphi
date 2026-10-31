// Some wasm builds cannot run forever on one instance: eSpeak NG leaks a
// little memory on every run, and its heap cannot grow, so it aborts after
// some fifty sentences. This hands out an instance made afresh every few
// runs, and once more when a run fails anyway.

/** Runs `fn` on an instance from `make`, renewed every `every` runs and retried once on a fresh one if it throws. */
export function recycling<T>(make: () => Promise<T>, every: number) {
  let current: Promise<T> | null = null;
  let runs = 0;
  const renew = () => {
    const made = make();
    current = made;
    runs = 0;
    made.catch(() => {
      if (current === made) current = null;
    });
    return made;
  };
  return async <R>(fn: (instance: T) => R): Promise<R> => {
    for (let attempt = 0; ; attempt++) {
      const instance = await (current && runs < every ? current : renew());
      runs++;
      try {
        return fn(instance);
      } catch (e) {
        current = null;
        if (attempt > 0) throw e;
      }
    }
  };
}
