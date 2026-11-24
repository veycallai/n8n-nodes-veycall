#!/usr/bin/env node
// Runs the built node (dist/) against a VeyCall API, with a small stand-in for n8n: parameters,
// credentials, HTTP with authentication, binary data, static data and a real webhook receiver.
//   VEYCALL_API_KEY=vc_live_… AGENT_ID=agent_… node test/harness.mjs
// Default API: http://127.0.0.1:8787/api/v1 (wrangler dev). Never point it at production with a real key
// unless you mean it: it creates and deletes leads, knowledge and webhooks.
import { createServer } from 'node:http';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { VeyCall } = require('../dist/nodes/VeyCall/VeyCall.node.js');
const { VeyCallTrigger } = require('../dist/nodes/VeyCall/VeyCallTrigger.node.js');
const { VeyCallActionTrigger } = require('../dist/nodes/VeyCall/VeyCallActionTrigger.node.js');
const { VeyCallApi } = require('../dist/credentials/VeyCallApi.credentials.js');

const credentials = { apiKey: process.env.VEYCALL_API_KEY, baseUrl: process.env.API_URL ?? 'http://127.0.0.1:8787/api/v1' };
const AGENT = process.env.AGENT_ID;
if (!credentials.apiKey || !AGENT) throw new Error('Set VEYCALL_API_KEY and AGENT_ID');

let passed = 0;
let failed = 0;
const check = (name, cond, extra) => {
	if (cond) {
		passed++;
		console.log(`  ✓ ${name}`);
	} else {
		failed++;
		console.log(`  ✗ ${name}`, extra !== undefined ? JSON.stringify(extra).slice(0, 400) : '');
	}
};

/** n8n's httpRequestWithAuthentication, as the credential's `authenticate` describes it. */
async function httpRequest(opts) {
	const auth = new VeyCallApi().authenticate.properties.headers.Authorization.replace('{{$credentials.apiKey}}', credentials.apiKey).replace(/^=/, '');
	const url = new URL(`${opts.baseURL}${opts.url}`);
	for (const [k, v] of Object.entries(opts.qs ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));
	const isForm = opts.body instanceof FormData;
	const res = await fetch(url, {
		method: opts.method,
		headers: { authorization: auth, ...(opts.body && !isForm ? { 'content-type': 'application/json' } : {}) },
		body: opts.body === undefined ? undefined : isForm ? opts.body : JSON.stringify(opts.body),
	});
	const text = await res.text();
	const json = text ? JSON.parse(text) : undefined;
	if (!res.ok) {
		const err = new Error(json?.error?.message ?? `HTTP ${res.status}`);
		err.httpCode = String(res.status);
		err.description = json?.error?.code;
		throw err;
	}
	return json;
}

const node = { name: 'VeyCall', type: 'veyCall', typeVersion: 1, parameters: {} };
const helpers = {
	httpRequestWithAuthentication: (_name, opts) => httpRequest(opts),
	assertBinaryData: (i, prop) => items[i].binary[prop],
	getBinaryDataBuffer: async (i, prop) => Buffer.from(items[i].binary[prop].data, 'base64'),
	prepareBinaryData: async (buf, fileName, mimeType) => ({ data: buf.toString('base64'), fileName, mimeType }),
	returnJsonArray: (o) => (Array.isArray(o) ? o : [o]).map((json) => ({ json })),
};
let items = [{ json: {} }];
/** Runs one operation of the action node with these parameters. */
async function run(params, input = [{ json: {} }]) {
	items = input;
	const ctx = {
		getInputData: () => items,
		getNodeParameter: (name, _i, fallback) => (name in params ? params[name] : fallback),
		getCredentials: async () => credentials,
		getNode: () => node,
		continueOnFail: () => false,
		helpers,
	};
	const [out] = await new VeyCall().execute.call(ctx);
	return out;
}
const loadOptions = (method) =>
	new VeyCall().methods.loadOptions[method].call({ getCredentials: async () => credentials, getNode: () => node, helpers });

const run_ = Date.now().toString(36);
try {
	console.log('Credential and agent list');
	await httpRequest({ method: 'GET', baseURL: credentials.baseUrl, url: new VeyCallApi().test.request.url });
	check('the credential test call works', true);
	const agents = await loadOptions('getAgents');
	check('the agent picker lists the agents', agents.some((a) => a.value === AGENT), agents);

	console.log('Message: answer');
	const answer = await run({
		resource: 'message',
		operation: 'answer',
		agentId: AGENT,
		channel: '__other',
		customChannel: 'mattermost',
		conversationId: `MM-${run_}`,
		messageId: `mm-${run_}-1`,
		senderId: 'u-lea',
		text: 'Hello, do you work on Saturdays?',
		replyAs: 'auto',
		audioSource: 'none',
		additionalFields: {
			senderName: 'Léa',
			attachments: { attachment: [{ type: 'image', caption: 'My kitchen', latitude: 0, longitude: 0 }] },
			history: '[{"from":"customer","text":"Hi"},{"from":"business","text":"Hello!"}]',
			metadata: '{"post_id":"abc"}',
		},
	});
	const a = answer[0].json;
	check('the agent answers a Mattermost message (custom channel)', a.status === 'reply' && a.reply?.text?.length > 0, a);
	check('no audio for a text', !answer[0].binary, answer[0]);

	const voice = await run({
		resource: 'message',
		operation: 'answer',
		agentId: AGENT,
		channel: 'slack',
		conversationId: `SL-${run_}`,
		messageId: `sl-${run_}-1`,
		senderId: 'u-tom',
		text: '',
		replyAs: 'auto',
		audioSource: 'url',
		audioUrl: 'http://not-https.test/a.mp3',
		additionalFields: {},
	}).catch((e) => e);
	check('an http audio link is refused with a clear error', voice instanceof Error, voice);

	console.log('Message: business reply');
	const business = await run({
		resource: 'message',
		operation: 'business',
		agentId: AGENT,
		channel: '__other',
		customChannel: 'mattermost',
		conversationId: `MM-${run_}`,
		text: 'I will call you this afternoon. Paul',
		sentAt: '',
	});
	check('a reply typed by the business is recorded', business[0].json.action === 'owner_recorded', business[0].json);
	const approved = await run({ resource: 'message', operation: 'getApproved', filterChannel: '', limit: 10 });
	check('approved replies can be listed', Array.isArray(approved), approved);

	console.log('Lead');
	const lead = (await run({ resource: 'lead', operation: 'create', leadFields: { name: 'Jane Doe', email: 'jane@example.com', priority: 'urgent' } }))[0].json;
	check('creates a lead', /^lead_/.test(lead.id ?? ''), lead);
	const updated = (await run({ resource: 'lead', operation: 'update', leadId: lead.id, updateFields: { status: 'qualified', notes: 'Called back' } }))[0].json;
	check('updates it', updated.status === 'qualified', updated);
	const many = await run({ resource: 'lead', operation: 'getAll', returnAll: false, limit: 5, filters: { priority: 'urgent' } });
	check('lists leads with a filter and a limit', many.length >= 1 && many.length <= 5 && many.every((x) => x.json.priority === 'urgent'), many.length);
	const empty = await run({ resource: 'lead', operation: 'create', leadFields: {} }).catch((e) => e);
	check('a lead without name, email or phone is refused before calling VeyCall', empty instanceof Error && /at least/.test(empty.message), empty?.message);

	console.log('Conversation');
	const convs = await run({ resource: 'conversation', operation: 'getAll', returnAll: true, filters: { platform: 'mattermost' } });
	check('lists conversations of a platform (all pages)', convs.some((c) => c.json.id === a.conversation_id), convs.length);
	const msgs = await run({ resource: 'conversation', operation: 'getMessages', conversationId: a.conversation_id });
	check('reads the transcript, the business reply included', msgs.some((m) => m.json.content?.includes('this afternoon')), msgs.map((m) => m.json.content));

	console.log('Knowledge');
	const faq = (
		await run({
			resource: 'knowledge',
			operation: 'create',
			type: 'faq',
			faq: { item: [{ question: 'Do you work on Saturdays?', answer: 'Yes, 9 to 12.' }] },
			additionalFields: { title: `FAQ ${run_}` },
		})
	)[0].json;
	check('adds a FAQ', /^kd_/.test(faq.id ?? ''), faq);
	const file = (
		await run({ resource: 'knowledge', operation: 'upload', binaryPropertyName: 'data', additionalFields: { title: `Prices ${run_}` } }, [
			{ json: {}, binary: { data: { data: Buffer.from('Boiler service: 90 EUR.\nCall-out: 40 EUR.').toString('base64'), mimeType: 'text/plain', fileName: 'prices.txt' } } },
		])
	)[0].json;
	check('uploads a file from binary data', /^kd_/.test(file.id ?? ''), file);
	for (const id of [faq.id, file.id].filter(Boolean)) await run({ resource: 'knowledge', operation: 'delete', documentId: id });
	check('deletes them', true);

	console.log('Agent');
	const agent = (await run({ resource: 'agent', operation: 'get', agentId: AGENT }))[0].json;
	check('gets the agent', agent.id === AGENT, agent);

	console.log('Trigger');
	const received = [];
	const server = createServer((req, res) => {
		let raw = '';
		req.on('data', (c) => (raw += c));
		req.on('end', async () => {
			const fake = { headers: req.headers, rawBody: Buffer.from(raw), body: JSON.parse(raw || '{}') };
			let status = 200;
			const response = { status: (s) => ((status = s), response), json: () => response };
			const result = await new VeyCallTrigger().webhook.call({
				getRequestObject: () => fake,
				getResponseObject: () => response,
				getWorkflowStaticData: () => staticData,
				getNodeParameter: (n, f) => (n === 'urgentOnly' ? false : f),
				getNode: () => node,
				helpers,
			});
			received.push({ status, result, type: fake.body.type });
			res.writeHead(status).end('{}');
		});
	});
	await new Promise((r) => server.listen(0, '127.0.0.1', r));
	const hookUrl = `http://127.0.0.1:${server.address().port}/webhook`;
	const staticData = {};
	const hookCtx = {
		getWorkflowStaticData: () => staticData,
		getNodeWebhookUrl: () => hookUrl,
		getNodeParameter: (n) => (n === 'events' ? ['lead.created'] : undefined),
		getWorkflow: () => ({ name: 'Harness' }),
		getCredentials: async () => credentials,
		getNode: () => node,
		helpers,
	};
	const hooks = new VeyCallTrigger().webhookMethods.default;
	check('not subscribed yet', !(await hooks.checkExists.call(hookCtx)));
	await hooks.create.call(hookCtx);
	check('subscribes when the workflow is activated', /^whk_/.test(staticData.webhookId ?? '') && /^whsec_/.test(staticData.secret ?? ''), staticData);
	check('…and finds its subscription again', await hooks.checkExists.call(hookCtx));
	const newLead = (await run({ resource: 'lead', operation: 'create', leadFields: { name: 'Trigger Test' } }))[0].json;
	for (let i = 0; i < 40 && !received.some((r) => r.type === 'lead.created'); i++) await new Promise((r) => setTimeout(r, 500));
	const ev = received.find((r) => r.type === 'lead.created');
	check('a new lead starts the workflow (signature checked)', ev?.status === 200 && ev.result.workflowData?.[0]?.[0]?.json?.data?.id === newLead.id, received);
	const forged = await fetch(hookUrl, {
		method: 'POST',
		headers: { 'content-type': 'application/json', 'x-veycall-timestamp': String(Math.floor(Date.now() / 1000)), 'x-veycall-signature': 'v1=00' },
		body: JSON.stringify({ type: 'lead.created', data: { id: 'lead_fake' } }),
	});
	check('a forged event is refused (401)', forged.status === 401);
	await hooks.delete.call(hookCtx);
	check('unsubscribes when the workflow is deactivated', !staticData.webhookId && !(await hooks.checkExists.call(hookCtx)));
	server.close();
	for (const id of [lead.id, newLead.id]) await run({ resource: 'lead', operation: 'delete', leadId: id });

	console.log('Action trigger');
	const actionData = {};
	let lastNodeOutput = { ok: true, say: 'Ticket 77 opened.', data: { ticket: 77 } };
	const actionServer = createServer((req, res) => {
		let raw = '';
		req.on('data', (c) => (raw += c));
		req.on('end', async () => {
			const fake = { headers: req.headers, rawBody: Buffer.from(raw), body: JSON.parse(raw || '{}') };
			let status = 200;
			const response = { status: (x) => ((status = x), response), json: () => response };
			const result = await new VeyCallActionTrigger().webhook.call({
				getRequestObject: () => fake,
				getResponseObject: () => response,
				getWorkflowStaticData: () => actionData,
				getNode: () => node,
				helpers,
			});
			// n8n runs the workflow; with responseMode lastNode, the last node's JSON is the answer.
			if (result.noWebhookResponse) return res.writeHead(status, { 'content-type': 'application/json' }).end('{"ok":false,"error":"Invalid signature"}');
			actionData.lastInput = result.workflowData[0][0].json;
			res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(lastNodeOutput));
		});
	});
	await new Promise((r) => actionServer.listen(0, '127.0.0.1', r));
	const actionUrl = `http://127.0.0.1:${actionServer.address().port}/webhook/abc/action`;
	const actionParams = {
		agentId: AGENT,
		title: 'Open a ticket',
		name: 'open_ticket',
		description: 'When the customer reports a problem with an order',
		parameters: { parameter: [{ name: 'problem', type: 'string', description: 'What went wrong', required: true }] },
		confirm: false,
	};
	const actionCtx = {
		getWorkflowStaticData: () => actionData,
		getNodeWebhookUrl: () => actionUrl,
		getNodeParameter: (n, f) => (n in actionParams ? actionParams[n] : f),
		getCredentials: async () => credentials,
		getNode: () => node,
		helpers,
	};
	const actionHooks = new VeyCallActionTrigger().webhookMethods.default;
	check('the action does not exist yet', !(await actionHooks.checkExists.call(actionCtx)));
	await actionHooks.create.call(actionCtx);
	check('activating the workflow adds the action to the agent', /^act_/.test(actionData.actionId ?? '') && /^whsec_/.test(actionData.secret ?? ''), actionData);
	check('…and finds it again', await actionHooks.checkExists.call(actionCtx));
	const tested = await httpRequest({
		method: 'POST',
		baseURL: credentials.baseUrl,
		url: `/agents/${AGENT}/actions/${actionData.actionId}/test`,
		body: { parameters: { problem: 'Broken zip' }, customer: { name: 'Léa' } },
	});
	check('VeyCall calls the workflow (signature checked) and the last node answers the agent', tested.data.ok === true && tested.data.result.say === 'Ticket 77 opened.' && tested.data.result.data?.ticket === 77, tested.data);
	check('the workflow gets the parameters and the customer', actionData.lastInput?.parameters?.problem === 'Broken zip' && actionData.lastInput?.customer?.name === 'Léa', actionData.lastInput);
	lastNodeOutput = { status: 'opened', id: 78 };
	const plain = await httpRequest({ method: 'POST', baseURL: credentials.baseUrl, url: `/agents/${AGENT}/actions/${actionData.actionId}/test`, body: { parameters: { problem: 'Late' } } });
	check('any JSON from the last node reaches the agent as data', plain.data.ok === true && plain.data.result.data?.id === 78, plain.data);
	const forgedAction = await fetch(actionUrl, { method: 'POST', headers: { 'content-type': 'application/json', 'x-veycall-timestamp': String(Math.floor(Date.now() / 1000)), 'x-veycall-signature': 'v1=00' }, body: '{"action":"open_ticket"}' });
	check('a forged call is refused (401)', forgedAction.status === 401);
	await actionHooks.delete.call(actionCtx);
	const left = await httpRequest({ method: 'GET', baseURL: credentials.baseUrl, url: `/agents/${AGENT}/actions` });
	check('deactivating the workflow removes the action', !left.data.some((a) => a.name === 'open_ticket') && !actionData.actionId, left.data);
	actionServer.close();
} catch (err) {
	failed++;
	console.log('  ✗ stopped:', err?.message, err?.description ?? '', err?.stack?.split('\n').slice(1, 3).join(' | '));
} finally {
	console.log(`\n${passed} passed, ${failed} failed`);
	process.exit(failed ? 1 : 0);
}
