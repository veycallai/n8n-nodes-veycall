#!/usr/bin/env node
// Local run: creates a throwaway VeyCall account on the local stack (wrangler dev + local Supabase),
// runs test/harness.mjs with its API key, then deletes the account.
//   node test/local.mjs
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const API = 'http://127.0.0.1:8787/api/v1';
const SUPABASE = 'http://localhost:8000';
const env = Object.fromEntries(
	readFileSync('/home/undefined/Documents/dockers/supabase/.env', 'utf8')
		.split('\n')
		.filter((l) => /^[A-Z_]+=/.test(l))
		.map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);
const admin = { apikey: env.SERVICE_ROLE_KEY, authorization: `Bearer ${env.SERVICE_ROLE_KEY}`, 'content-type': 'application/json' };
const api = async (method, path, token, body) =>
	(await fetch(`${API}${path}`, { method, headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined })).json();

const email = `n8n-node-${Date.now().toString(36)}@example.com`;
const password = `Pw-${crypto.randomUUID()}`;
const user = await (await fetch(`${SUPABASE}/auth/v1/admin/users`, { method: 'POST', headers: admin, body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { organization_name: 'n8n node test' } }) })).json();
const token = (await (await fetch(`${SUPABASE}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: env.ANON_KEY, 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) })).json()).access_token;
const orgId = (await api('GET', '/me', token)).data.organization_id;
let code = 1;
try {
	await fetch(`${SUPABASE}/rest/v1/organization_features`, { method: 'POST', headers: admin, body: JSON.stringify({ organization_id: orgId, feature: 'api', source: 'admin' }) });
	await fetch(`${SUPABASE}/rest/v1/organizations?id=eq.${orgId}`, { method: 'PATCH', headers: admin, body: JSON.stringify({ credit_micros: 10_000_000 }) });
	const agent = (await api('POST', '/agents', token, { name: 'Sarah', language: 'en-US' })).data;
	await api('POST', `/agents/${agent.id}/publish`, token);
	const key = (await api('POST', '/api-keys', token, { name: 'n8n' })).data.key;
	code = spawnSync('node', ['test/harness.mjs'], { stdio: 'inherit', env: { ...process.env, VEYCALL_API_KEY: key, AGENT_ID: agent.id, API_URL: API } }).status ?? 1;
} finally {
	await fetch(`${SUPABASE}/auth/v1/admin/users/${user.id}`, { method: 'DELETE', headers: admin });
	await fetch(`${SUPABASE}/rest/v1/organizations?id=eq.${orgId}`, { method: 'DELETE', headers: admin });
}
process.exit(code);
