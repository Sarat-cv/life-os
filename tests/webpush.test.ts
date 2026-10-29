// Checks the push encryption against an independent receiver written with Node's crypto,
// and checks the VAPID signature. Run: node --experimental-strip-types tests/webpush.test.ts
import { createECDH, createHmac, createDecipheriv, createPublicKey, verify } from 'node:crypto';
import { encryptPayload, vapidHeader, generateVapidKeys, b64u, unb64u } from '../supabase/functions/_shared/webpush.ts';

function hkdf(salt: Buffer, ikm: Buffer, info: Buffer, len: number) {
  const prk = createHmac('sha256', salt).update(ikm).digest();
  return createHmac('sha256', prk).update(Buffer.concat([info, Buffer.from([1])])).digest().subarray(0, len);
}
let fails = 0;
const ok = (c: boolean, m: string) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };

// Browser side (receiver)
const ua = createECDH('prime256v1'); ua.generateKeys();
const uaPub = ua.getPublicKey();
const authSecret = Buffer.from(crypto.getRandomValues(new Uint8Array(16)));
const msg = { title: 'Still good to talk?', body: 'Hi Asha, it’s 7:30 pm, the time we picked. Ready for our chat?' };
const body = Buffer.from(await encryptPayload(b64u(uaPub), b64u(authSecret), new TextEncoder().encode(JSON.stringify(msg))));

const salt = body.subarray(0, 16);
const rs = body.readUInt32BE(16);
const idlen = body[20];
const asPub = body.subarray(21, 21 + idlen);
const cipher = body.subarray(21 + idlen);
ok(rs === 4096 && idlen === 65, 'header has record size 4096 and a 65-byte key');
const shared = ua.computeSecret(asPub);
const ikm = hkdf(authSecret, shared, Buffer.concat([Buffer.from('WebPush: info\0'), uaPub, asPub]), 32);
const cek = hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
const nonce = hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12);
const d = createDecipheriv('aes-128-gcm', cek, nonce);
d.setAuthTag(cipher.subarray(cipher.length - 16));
const plain = Buffer.concat([d.update(cipher.subarray(0, cipher.length - 16)), d.final()]);
ok(plain[plain.length - 1] === 2, 'last-record padding byte is present');
ok(plain.subarray(0, -1).toString() === JSON.stringify(msg), 'receiver decrypts the exact message');

// VAPID
const keys = await generateVapidKeys();
ok(unb64u(keys.publicKey).length === 65, 'public key is a 65-byte P-256 point');
const h = await vapidHeader('https://web.push.apple.com/QGuQyavXutnMH', keys, 'mailto:hello@lifeos.app');
const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(h)!;
ok(!!m && m[4] === keys.publicKey, 'header has the token and the public key');
const claims = JSON.parse(Buffer.from(unb64u(m[2])).toString());
ok(claims.aud === 'https://web.push.apple.com' && claims.exp > Date.now() / 1000 && claims.sub.startsWith('mailto:'), 'claims: audience, expiry, subject');
const pk = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: keys.privateJwk.x!, y: keys.privateJwk.y! }, format: 'jwk' });
ok(verify('sha256', Buffer.from(m[1] + '.' + m[2]), { key: pk, dsaEncoding: 'ieee-p1363' }, Buffer.from(unb64u(m[3]))), 'ES256 signature verifies');
process.exit(fails ? 1 : 0);
