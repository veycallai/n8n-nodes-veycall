import { createHmac, timingSafeEqual } from 'crypto';
import type {
	IDataObject,
	IHookFunctions,
	INodeType,
	INodeTypeDescription,
	IWebhookFunctions,
	IWebhookResponseData,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes } from 'n8n-workflow';
import { veyCallRequest } from './GenericFunctions';

/** Signed events older than this are refused (replays). */
const TOLERANCE_SECONDS = 5 * 60;

export class VeyCallTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'VeyCall Trigger',
		name: 'veyCallTrigger',
		icon: { light: 'file:veycall.svg', dark: 'file:veycall.dark.svg' },
		group: ['trigger'],
		version: 1,
		subtitle: '={{$parameter["events"].join(", ")}}',
		description: 'Starts the workflow on a new lead, a lead update, a finished conversation or an approved reply to send',
		defaults: { name: 'VeyCall Trigger' },
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'veyCallApi', required: true }],
		webhooks: [{ name: 'default', httpMethod: 'POST', responseMode: 'onReceived', path: 'webhook' }],
		properties: [
			{
				displayName: 'Events',
				name: 'events',
				type: 'multiOptions',
				required: true,
				default: ['lead.created'],
				options: [
					{
						name: 'Approved Reply to Send',
						value: 'channel.reply',
						description: 'A reply approved in the dashboard, to send on its platform (Gmail, Messenger…)',
					},
					{
						name: 'Conversation Ended',
						value: 'conversation.ended',
						description: 'A call or a conversation ended, with its summary',
					},
					{ name: 'Lead Created', value: 'lead.created', description: 'Your agent captured a new lead' },
					{
						name: 'Lead Updated',
						value: 'lead.updated',
						description: 'A lead changed: status, appointment, order…',
					},
				],
			},
			{
				displayName: 'Only Urgent Leads',
				name: 'urgentOnly',
				type: 'boolean',
				default: false,
				description: 'Whether to ignore lead events that are not urgent',
				displayOptions: { show: { events: ['lead.created'] } },
			},
		],
	};

	webhookMethods = {
		default: {
			async checkExists(this: IHookFunctions): Promise<boolean> {
				const data = this.getWorkflowStaticData('node');
				if (!data.webhookId) return false;
				const { data: hooks } = await veyCallRequest.call(this, 'GET', '/integrations/webhooks');
				const url = this.getNodeWebhookUrl('default');
				const found = ((hooks as unknown as Array<{ id: string; url: string }>) ?? []).some((h) => h.id === data.webhookId && h.url === url);
				if (!found) {
					delete data.webhookId;
					delete data.secret;
				}
				return found;
			},
			async create(this: IHookFunctions): Promise<boolean> {
				const { data } = await veyCallRequest.call(this, 'POST', '/integrations/webhooks', {
					url: this.getNodeWebhookUrl('default'),
					events: this.getNodeParameter('events') as string[],
					description: `n8n: ${this.getWorkflow().name ?? 'workflow'}`.slice(0, 120),
				});
				const stored = this.getWorkflowStaticData('node');
				stored.webhookId = data.id;
				stored.secret = data.secret;
				return true;
			},
			async delete(this: IHookFunctions): Promise<boolean> {
				const stored = this.getWorkflowStaticData('node');
				if (stored.webhookId) {
					try {
						await veyCallRequest.call(this, 'DELETE', `/integrations/webhooks/${stored.webhookId}`);
					} catch (error) {
						// Already removed in the dashboard: nothing left to delete. Anything else is reported.
						const status = (error as { httpCode?: string }).httpCode;
						if (status !== '404') throw new NodeApiError(this.getNode(), error as JsonObject);
					}
				}
				delete stored.webhookId;
				delete stored.secret;
				return true;
			},
		},
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const req = this.getRequestObject();
		const secret = this.getWorkflowStaticData('node').secret as string | undefined;
		// Only events signed by VeyCall with this subscription's secret, and recent.
		const timestamp = String(req.headers['x-veycall-timestamp'] ?? '');
		const signature = String(req.headers['x-veycall-signature'] ?? '');
		const raw = (req as unknown as { rawBody?: Buffer }).rawBody?.toString('utf8') ?? JSON.stringify(req.body);
		if (secret) {
			const expected = `v1=${createHmac('sha256', secret).update(`${timestamp}.${raw}`).digest('hex')}`;
			const valid =
				signature.length === expected.length && timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
			const fresh = Math.abs(Date.now() / 1000 - Number(timestamp)) <= TOLERANCE_SECONDS;
			if (!valid || !fresh) {
				const res = this.getResponseObject();
				res.status(401).json({ error: 'Invalid signature' });
				return { noWebhookResponse: true };
			}
		}
		const body = req.body as IDataObject & { type?: string; data?: IDataObject };
		// The test event of the dashboard is let through; urgent-only drops normal new leads.
		if (
			this.getNodeParameter('urgentOnly', false) &&
			body.type === 'lead.created' &&
			(body.data as IDataObject | undefined)?.priority !== 'urgent'
		)
			return { webhookResponse: { received: true } };
		return { workflowData: [this.helpers.returnJsonArray(body)] };
	}
}
