// The game link: everything about a game travels in the URL fragment (#...), so no server is needed.
//
//   #<header>.<sealed state>
//
// header        base64url(deflate(JSON)) – public: scenario, seed, players' names and keys, whose turn.
// sealed state  base64url(ephemeral public key | iv | AES-GCM(deflate(JSON))) – the game state,
//               encrypted so that only the player whose turn it is can read it (with their PIN).
//
// Each player has an ECDH P-256 key pair. The private key travels in the header, encrypted with a
// key derived from the player's PIN (PBKDF2). To pass the turn, the sender encrypts the state to
// the next player's public key (ECIES: ephemeral ECDH + HKDF + AES-GCM, with the header as
// additional data so the header can't be altered without breaking the seal).
//
// What this protects: a link can only be opened by the player it is addressed to, so nobody can
// look at the board when it isn't their turn. What it can't protect: during your own turn your
// browser holds the whole state (it needs it to apply the rules), so a player willing to dig
// through the page's memory could see hidden units. Short PINs can be guessed by a script, so
// players should choose 6+ characters.

/** Bump when the link format changes. */
export const LINK_VERSION = 1;
export const DEFAULT_PBKDF2_ITERATIONS = 310_000;

export interface PlayerSlot {
  name: string;
  /** Raw uncompressed P-256 public key, base64url. */
  pub: string;
  /** PIN-encrypted private key: salt(16) | iv(12) | AES-GCM(d), base64url. */
  key: string;
}

export type Phase = 'join' | 'play' | 'over';

export interface Header {
  v: number;
  /** Random game id, used to remember things about this game in the browser. */
  id: string;
  name: string;
  scenario: string;
  seed: number;
  /** Number of players the game was created for. */
  n: number;
  /** Players who have joined, in turn order. */
  players: PlayerSlot[];
  phase: Phase;
  /** Round number and whose turn it is (index into players). */
  turn: number;
  cur: number;
  /** PBKDF2 iterations used for PINs. */
  it: number;
}

const subtle = () => globalThis.crypto.subtle;
const enc = new TextEncoder();
const dec = new TextDecoder();

// ---------------------------------------------------------------- bytes

export function toB64u(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromB64u(s: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new LinkError('The link is damaged (unexpected characters).');
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};

const randomBytes = (n: number) => globalThis.crypto.getRandomValues(new Uint8Array(n));

/** Copy into a fresh ArrayBuffer-backed array (what WebCrypto's types expect). */
const buf = (u: Uint8Array): Uint8Array<ArrayBuffer> => new Uint8Array(u);

async function pipe(data: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([buf(data)]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}
export const deflate = (data: Uint8Array) => pipe(data, new CompressionStream('deflate-raw'));
export const inflate = (data: Uint8Array) => pipe(data, new DecompressionStream('deflate-raw'));

export class LinkError extends Error {}
export class WrongPinError extends LinkError {
  constructor() { super('That PIN is not right.'); }
}

// ---------------------------------------------------------------- keys

async function pinKey(pin: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const base = await subtle().importKey('raw', enc.encode(pin.normalize('NFKC')), 'PBKDF2', false, ['deriveKey']);
  return subtle().deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: buf(salt), iterations }, base,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

/** Create a player's key pair, with the private key locked by their PIN. */
export async function createPlayerSlot(name: string, pin: string, iterations: number): Promise<PlayerSlot> {
  const pair = await subtle().generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair;
  const pub = new Uint8Array(await subtle().exportKey('raw', pair.publicKey));
  const jwk = await subtle().exportKey('jwk', pair.privateKey);
  const d = fromB64u(jwk.d!);
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv: buf(iv) }, await pinKey(pin, salt, iterations), buf(d)));
  return { name, pub: toB64u(pub), key: toB64u(concat(salt, iv, ct)) };
}

/** Unlock a player's private key with their PIN. Throws WrongPinError. */
export async function unlockPlayer(slot: PlayerSlot, pin: string, iterations: number): Promise<CryptoKey> {
  const blob = fromB64u(slot.key);
  const salt = blob.subarray(0, 16);
  const iv = blob.subarray(16, 28);
  let d: Uint8Array;
  try {
    d = new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: buf(iv) }, await pinKey(pin, salt, iterations), buf(blob.subarray(28))));
  } catch {
    throw new WrongPinError();
  }
  const pub = fromB64u(slot.pub);
  return subtle().importKey('jwk', {
    kty: 'EC', crv: 'P-256', d: toB64u(d), x: toB64u(pub.subarray(1, 33)), y: toB64u(pub.subarray(33, 65)), ext: false,
  }, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
}

async function sharedAesKey(privateKey: CryptoKey, publicRaw: Uint8Array): Promise<CryptoKey> {
  const pub = await subtle().importKey('raw', buf(publicRaw), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const bits = await subtle().deriveBits({ name: 'ECDH', public: pub }, privateKey, 256);
  const hkdf = await subtle().importKey('raw', bits, 'HKDF', false, ['deriveKey']);
  return subtle().deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: enc.encode(`battlelines-v${LINK_VERSION}`) },
    hkdf, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

// ---------------------------------------------------------------- header and state

export async function encodeHeader(h: Header): Promise<string> {
  return toB64u(await deflate(enc.encode(JSON.stringify(h))));
}

export async function decodeHeader(s: string): Promise<Header> {
  let h: Header;
  try {
    h = JSON.parse(dec.decode(await inflate(fromB64u(s))));
  } catch (err) {
    if (err instanceof LinkError) throw err;
    throw new LinkError('The link is damaged or incomplete. Check you copied all of it.');
  }
  if (h.v !== LINK_VERSION) throw new LinkError(`This link is from a different version of Battle Lines (v${h.v}).`);
  return h;
}

/** Encrypt a payload so only the holder of `recipientPub`'s private key can read it. */
export async function seal(payload: unknown, recipient: PlayerSlot, headerText: string): Promise<string> {
  const eph = await subtle().generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair;
  const ephPub = new Uint8Array(await subtle().exportKey('raw', eph.publicKey));
  const key = await sharedAesKey(eph.privateKey, fromB64u(recipient.pub));
  const iv = randomBytes(12);
  const body = await deflate(enc.encode(JSON.stringify(payload)));
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv: buf(iv), additionalData: enc.encode(headerText) }, key, buf(body)));
  return toB64u(concat(ephPub, iv, ct));
}

export async function unseal<T>(sealed: string, privateKey: CryptoKey, headerText: string): Promise<T> {
  const blob = fromB64u(sealed);
  if (blob.length < 65 + 12 + 16) throw new LinkError('The link is damaged or incomplete. Check you copied all of it.');
  const key = await sharedAesKey(privateKey, blob.subarray(0, 65));
  let body: Uint8Array;
  try {
    body = new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: buf(blob.subarray(65, 77)), additionalData: enc.encode(headerText) },
      key, buf(blob.subarray(77))));
  } catch {
    throw new LinkError('This link could not be opened. It may have been altered, or it was meant for another player.');
  }
  return JSON.parse(dec.decode(await inflate(body))) as T;
}

/** A payload anyone can read (used once the game is over, when there is nothing left to hide). */
export async function openPayload(payload: unknown): Promise<string> {
  return toB64u(await deflate(enc.encode(JSON.stringify(payload))));
}
export async function readOpenPayload<T>(s: string): Promise<T> {
  return JSON.parse(dec.decode(await inflate(fromB64u(s)))) as T;
}

export async function sha256(text: string): Promise<string> {
  return toB64u(new Uint8Array(await subtle().digest('SHA-256', enc.encode(text)))).slice(0, 22);
}

/** Split "#header.payload" (or a full URL containing it). */
export function splitLink(hashOrUrl: string): { header: string; payload: string | null } | null {
  const hash = hashOrUrl.includes('#') ? hashOrUrl.slice(hashOrUrl.indexOf('#') + 1) : hashOrUrl;
  if (!hash) return null;
  const [header, payload] = hash.split('.');
  return { header, payload: payload || null };
}
