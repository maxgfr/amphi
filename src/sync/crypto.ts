// End-to-end encryption of the synced tree. The key comes from the user's
// passphrase (PBKDF2-SHA256, 600 000 iterations, a random salt kept in
// amphi.json); the repository sees only amphi.json and opaque objects.
//
// PBKDF2 gives 512 bits: an AES-GCM-256 key for the contents and an HMAC key
// that names the objects (`objects/<hmac of the path>`, `media/<hmac>` for the
// original files, so listing a repository never means downloading its media).
// An object holds, each sealed with its own fresh 12-byte IV:
//   "AMP1" | u16 length | seal(path, aad = object name) | seal(content, aad = path)
// The first part tells a device which path an object it has never seen holds;
// both are bound to where they sit, so an object moved, swapped or edited
// fails to open. amphi.json keeps an HMAC check value: a wrong passphrase is
// told apart from a damaged repository.

export const PBKDF2_ITERATIONS = 600_000;
const MAGIC = new Uint8Array([0x41, 0x4d, 0x50, 0x31]); // "AMP1"
const CHECK = "amphi/1 passphrase check";

export interface Keys {
  aes: CryptoKey;
  mac: CryptoKey;
}

export class CryptoError extends Error {
  override name = "CryptoError";
}

const enc = new TextEncoder();
const dec = new TextDecoder();
const buf = (b: Uint8Array) => b as Uint8Array<ArrayBuffer>;

export const hex = (b: ArrayBuffer | Uint8Array) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

export function toBase64(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromBase64(s: string): Uint8Array {
  const bin = atob(s.replace(/\s/g, ""));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export const newSalt = () => crypto.getRandomValues(new Uint8Array(16));

export async function deriveKeys(passphrase: string, salt: Uint8Array, iterations = PBKDF2_ITERATIONS): Promise<Keys> {
  const material = await crypto.subtle.importKey("raw", enc.encode(passphrase.normalize("NFC")), "PBKDF2", false, ["deriveBits"]);
  const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: buf(salt), iterations }, material, 512));
  const aes = await crypto.subtle.importKey("raw", bits.slice(0, 32), "AES-GCM", false, ["encrypt", "decrypt"]);
  const mac = await crypto.subtle.importKey("raw", bits.slice(32), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return { aes, mac };
}

const hmac = async (keys: Keys, text: string) => hex(await crypto.subtle.sign("HMAC", keys.mac, enc.encode(text)));

/** Stored in amphi.json: tells whether a passphrase is the right one. */
export const checkValue = (keys: Keys) => hmac(keys, CHECK);

const BLOB = /^blobs\/([0-9a-f]{64})(?:\.[a-z0-9]+)?$/;

/** Where a path is stored. A file's name depends on its hash only, not on its extension. */
export async function objectName(keys: Keys, path: string): Promise<string> {
  const blob = BLOB.exec(path);
  return blob ? `media/${await hmac(keys, `blob:${blob[1]}`)}` : `objects/${await hmac(keys, `path:${path}`)}`;
}

/** AES-GCM with a fresh IV: iv | ciphertext and tag. */
export async function seal(keys: Keys, aad: string, plain: Uint8Array): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(aad) }, keys.aes, buf(plain)));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv);
  out.set(ct, 12);
  return out;
}

export async function open(keys: Keys, aad: string, sealed: Uint8Array): Promise<Uint8Array> {
  if (sealed.length < 28) throw new CryptoError("Encrypted data too short");
  try {
    return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: buf(sealed.slice(0, 12)), additionalData: enc.encode(aad) }, keys.aes, buf(sealed.slice(12))));
  } catch {
    throw new CryptoError("Encrypted data does not open: wrong key, or changed");
  }
}

export async function encryptFile(keys: Keys, path: string, bytes: Uint8Array): Promise<{ name: string; bytes: Uint8Array }> {
  const name = await objectName(keys, path);
  const head = await seal(keys, name, enc.encode(path));
  const body = await seal(keys, path, bytes);
  const out = new Uint8Array(6 + head.length + body.length);
  out.set(MAGIC);
  new DataView(out.buffer).setUint16(4, head.length);
  out.set(head, 6);
  out.set(body, 6 + head.length);
  return { name, bytes: out };
}

const hasMagic = (b: Uint8Array) => b.length >= 4 && MAGIC.every((x, i) => b[i] === x);

/** Opens an object found at `name`; it may be stored as bytes or as base64 text. */
export async function decryptFile(keys: Keys, name: string, stored: Uint8Array): Promise<{ path: string; bytes: Uint8Array }> {
  let b = stored;
  if (!hasMagic(b)) {
    try {
      b = fromBase64(dec.decode(b));
    } catch {
      throw new CryptoError("Not an amphi encrypted object");
    }
  }
  if (!hasMagic(b) || b.length < 6) throw new CryptoError("Not an amphi encrypted object");
  const n = new DataView(b.buffer, b.byteOffset).getUint16(4);
  const path = dec.decode(await open(keys, name, b.subarray(6, 6 + n)));
  if ((await objectName(keys, path)) !== name) throw new CryptoError("Encrypted object is not where it belongs");
  return { path, bytes: await open(keys, path, b.subarray(6 + n)) };
}
