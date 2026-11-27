// Low-level link encoding: the game travels in the URL fragment (#...), so no server is needed.
//
//   https://<site>/#<base64url(deflate(JSON))>
//
// Browsers never send the fragment to the web server, so the host never sees games.

/** Bump when the link format changes. */
export const LINK_VERSION = 10; // 3: no dice (#21); 4: elevation (#22); 5: eras and deployment (#7); 6: friendly pass-through (#23); 7: terrain (#24); 8: morale (#27); 9: ranged attacks (#28); 10: movement costs (#29)

export class LinkError extends Error {}

const enc = new TextEncoder();
const dec = new TextDecoder();

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

async function pipe(data: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([new Uint8Array(data)]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}
export const deflate = (data: Uint8Array) => pipe(data, new CompressionStream('deflate-raw'));
export const inflate = (data: Uint8Array) => pipe(data, new DecompressionStream('deflate-raw'));

/** Compress a value into a link fragment. */
export async function encodeFragment(value: unknown): Promise<string> {
  return toB64u(await deflate(enc.encode(JSON.stringify(value))));
}

/** Read a link fragment (or a full URL containing one). */
export async function decodeFragment<T>(hashOrUrl: string): Promise<T> {
  const fragment = hashOrUrl.includes('#') ? hashOrUrl.slice(hashOrUrl.indexOf('#') + 1) : hashOrUrl;
  try {
    return JSON.parse(dec.decode(await inflate(fromB64u(fragment.trim())))) as T;
  } catch (err) {
    if (err instanceof LinkError) throw err;
    throw new LinkError('The link is damaged or incomplete. Check you copied all of it.');
  }
}

export async function sha256(text: string): Promise<string> {
  return toB64u(new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', enc.encode(text)))).slice(0, 22);
}
