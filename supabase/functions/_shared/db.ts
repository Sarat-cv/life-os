// A tiny client for the Supabase REST API, using the service role key that
// Supabase gives every Edge Function. Only backend code uses this.

import { generateVapidKeys, type VapidKeys } from './webpush.ts';

export type Db = {
  get: (path: string) => Promise<any>;
  post: (path: string, body: unknown, prefer?: string) => Promise<any>;
  patch: (path: string, body: unknown) => Promise<any>;
  del: (path: string) => Promise<any>;
  adminUser: (id: string) => Promise<any>;
};

export function db(url: string, key: string, fetcher: typeof fetch = fetch): Db {
  const base = url.replace(/\/$/, '');
  // Newer "sb_secret_" keys go in the apikey header only; older service-role keys are JWTs.
  const headers: Record<string, string> = key.startsWith('sb_')
    ? { 'apikey': key, 'Content-Type': 'application/json' }
    : { 'apikey': key, 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' };
  async function call(method: string, path: string, body?: unknown, prefer?: string) {
    const res = await fetcher(base + path, {
      method,
      headers: prefer ? { ...headers, 'Prefer': prefer } : headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(method + ' ' + path + ' failed: ' + res.status + ' ' + text);
    return text ? JSON.parse(text) : null;
  }
  return {
    get: (p) => call('GET', '/rest/v1/' + p),
    post: (p, b, prefer = 'return=representation') => call('POST', '/rest/v1/' + p, b, prefer),
    patch: (p, b) => call('PATCH', '/rest/v1/' + p, b, 'return=minimal'),
    del: (p) => call('DELETE', '/rest/v1/' + p),
    adminUser: (id) => call('GET', '/auth/v1/admin/users/' + id),
  };
}

// The push keys are made once, on first use, and kept in the server-only app_keys table.
export async function vapidKeys(d: Db): Promise<VapidKeys> {
  const rows = await d.get('app_keys?select=name,value&name=in.(vapid_public,vapid_private)');
  const pub = rows.find((r: any) => r.name === 'vapid_public');
  const priv = rows.find((r: any) => r.name === 'vapid_private');
  if (pub && priv) return { publicKey: pub.value, privateJwk: JSON.parse(priv.value) };
  const fresh = await generateVapidKeys();
  await d.post('app_keys?on_conflict=name', [
    { name: 'vapid_public', value: fresh.publicKey },
    { name: 'vapid_private', value: JSON.stringify(fresh.privateJwk) },
  ], 'resolution=ignore-duplicates,return=minimal');
  const again = await d.get('app_keys?select=name,value&name=in.(vapid_public,vapid_private)');
  return {
    publicKey: again.find((r: any) => r.name === 'vapid_public').value,
    privateJwk: JSON.parse(again.find((r: any) => r.name === 'vapid_private').value),
  };
}

export const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};
