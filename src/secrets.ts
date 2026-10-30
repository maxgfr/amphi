// Every secret (AI keys, the GitHub token, the sync passphrase) lives in one
// llm-connect key vault: AES-GCM under a vault key, never in clear in storage.
//
// Two modes:
// - "device" (default): the vault is created with a random passphrase that is
//   thrown away and unlocks itself on this device (`rememberOnDevice`). No
//   prompt; a copy of the browser profile yields only ciphertext.
// - "passphrase": the vault opens only with the user's passphrase and locks
//   itself after 15 idle minutes, so a script loaded later cannot read keys
//   while it is locked.
// Switching rewrites the vault: the secrets are read, the vault is reset and
// created again under the new protection, then the secrets are written back.

import { createKeyVault, type KeyVault } from "llm-connect";

export type VaultMode = "device" | "passphrase";
const MODE_KEY = "amphi-vault-mode";
const DB = "amphi-vault";
const AUTO_LOCK_MS = 15 * 60_000;

export function vaultMode(): VaultMode {
  try {
    return localStorage.getItem(MODE_KEY) === "passphrase" ? "passphrase" : "device";
  } catch {
    return "device";
  }
}

export const vault: KeyVault = createKeyVault({ dbName: DB, autoLockMs: vaultMode() === "passphrase" ? AUTO_LOCK_MS : undefined });

function randomPassphrase(): string {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

let ready: Promise<void> | null = null;

/** Load the vault; in device mode, create it on first use. Leaves it locked in passphrase mode. */
export function loadVault(): Promise<void> {
  ready ??= (async () => {
    const state = await vault.load();
    if (state === "empty" && vaultMode() === "device") await vault.create(randomPassphrase(), { rememberOnDevice: true });
  })();
  return ready;
}

async function readAll(): Promise<[string, string][]> {
  const out: [string, string][] = [];
  for (const name of await vault.list()) {
    const v = await vault.get(name);
    if (v !== null) out.push([name, v]);
  }
  return out;
}

async function rewrite(secrets: [string, string][], create: () => Promise<void>, mode: VaultMode) {
  await vault.reset();
  await create();
  for (const [name, v] of secrets) await vault.set(name, v);
  localStorage.setItem(MODE_KEY, mode);
}

/** Protect every secret with a passphrase from now on. The page reloads to apply the auto-lock. */
export async function protectWithPassphrase(passphrase: string): Promise<void> {
  await loadVault();
  const secrets = await readAll();
  await rewrite(secrets, () => vault.create(passphrase, { rememberOnDevice: false }), "passphrase");
}

/** Back to opening on this device without a prompt (needs the vault unlocked). */
export async function removePassphrase(): Promise<void> {
  const secrets = await readAll();
  await rewrite(secrets, () => vault.create(randomPassphrase(), { rememberOnDevice: true }), "device");
}

/** Forgotten passphrase: every secret is deleted and the vault starts again in device mode. */
export async function resetVault(): Promise<void> {
  await vault.reset();
  localStorage.setItem(MODE_KEY, "device");
  await vault.create(randomPassphrase(), { rememberOnDevice: true });
}

export const getSecret = async (name: string) => {
  await loadVault();
  return vault.get(name);
};
export const setSecret = async (name: string, value: string) => {
  await loadVault();
  await vault.set(name, value);
};
export const deleteSecret = async (name: string) => {
  await loadVault();
  await vault.delete(name);
};
