// localStorage belongs to the origin, and maxgfr.github.io is shared by every
// project page: another site filling the quota makes our writes throw. Reads
// and writes go through here so neither can break a screen, and a write says
// whether it was kept.

export function readLocal(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** False when the value could not be stored (full, blocked or missing): it is gone after a reload. */
export function writeLocal(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

/** Thrown when a choice could not be stored, so the screen can say so instead of claiming success. */
export class StorageFullError extends Error {
  constructor() {
    super("Storage for this site is full");
    this.name = "StorageFullError";
  }
}
