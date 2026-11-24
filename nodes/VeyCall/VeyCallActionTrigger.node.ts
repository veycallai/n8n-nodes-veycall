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
import { getAgents, veyCallRequest } from './GenericFunctions';

/** Signed calls older than this are refused (replays). */
const TOLERANCE_SECONDS = 5 * 60;

/**
 * A custom action of a VeyCall agent, run by this workflow: when the workflow is activated, the action is
 * added to the agent (kind "n8n", this webhook's URL); the agent calls it during a conversation with the
 * details it collected; the workflow does the work, and its last node's output goes back to the agent
 * ({ ok, say, data } or any JSON). Deactivating the workflow removes the action.
 */
export class VeyCallActionTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'VeyCall Action Trigger',
		name: 'veyCallActionTrigger',
		icon: { light: 'file:veycall.svg', dark: 'file:veycall.dark.svg' },
		group: ['trigger'],
		version: 1,
		subtitle: '={{$parameter["title"]}}',
		description: 'Runs when your VeyCall agent calls this action during a conversation, and sends the result back to it',
		defaults: { name: 'VeyCall Action Trigger' },
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'veyCallApi', required: true }],
		webhooks: [
			{
				name: 'default',
				httpMethod: 'POST',
				responseMode: 'lastNode',
				responseData: 'firstEntryJson',
				path: 'action',
			},
		],
		properties: [
			{
				displayName:
					'The output of the last node goes back to the agent. Best: { "ok": true, "say": "what the agent can tell the customer", "data": { … } }. Answer within 8 seconds during a call.',
				name: 'notice',
				type: 'notice',
				default: '',
			},
			{
				displayName: 'Agent Name or ID',
				name: 'agentId',
				type: 'options',
				typeOptions: { loadOptionsMethod: 'getAgents' },
				default: '',
				required: true,
				description:
					'The agent that gets this action. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
			},
			{
				displayName: 'Action Name',
				name: 'title',
				type: 'string',
				default: '',
				required: true,
				placeholder: 'Create an order',
			},
			{
				displayName: 'Technical Name',
				name: 'name',
				type: 'string',
				default: '',
				required: true,
				placeholder: 'create_order',
				description: 'Lowercase letters, digits and _, unique for this agent',
			},
			{
				displayName: 'When Should the Agent Use It?',
				name: 'description',
				type: 'string',
				typeOptions: { rows: 2 },
				default: '',
				required: true,
				placeholder: 'When the customer has confirmed the product and quantity they want to buy',
			},
			{
				displayName: 'Information to Collect',
				name: 'parameters',
				type: 'fixedCollection',
				typeOptions: { multipleValues: true },
				default: {},
				description: 'What the agent asks the customer before calling the action',
				options: [
					{
						name: 'parameter',
						displayName: 'Field',
						values: [
							{ displayName: 'Description', name: 'description', type: 'string', default: '', description: 'What it is, for the agent' },
							{ displayName: 'Name', name: 'name', type: 'string', default: '', placeholder: 'product' },
							{ displayName: 'Required', name: 'required', type: 'boolean', default: true },
							{
								displayName: 'Type',
								name: 'type',
								type: 'options',
								options: [
									{ name: 'Email', value: 'email' },
									{ name: 'Number', value: 'number' },
									{ name: 'Phone', value: 'phone' },
									{ name: 'Text', value: 'string' },
									{ name: 'Whole Number', value: 'integer' },
									{ name: 'Yes / No', value: 'boolean' },
								],
								default: 'string',
							},
						],
					},
				],
			},
			{
				displayName: 'Ask the Customer to Confirm First',
				name: 'confirm',
				type: 'boolean',
				default: false,
				description: 'Whether the agent repeats the details and waits for a yes before calling (orders, bookings, payments)',
			},
		],
	};

	methods = { loadOptions: { getAgents } };

	webhookMethods = {
		default: {
			async checkExists(this: IHookFunctions): Promise<boolean> {
				const data = this.getWorkflowStaticData('node');
				if (!data.actionId || !data.agentId) return false;
				const { data: actions } = await veyCallRequest.call(this, 'GET', `/agents/${data.agentId}/actions`);
				const url = this.getNodeWebhookUrl('default');
				const found = ((actions as unknown as Array<{ id: string; url: string }>) ?? []).some((a) => a.id === data.actionId && a.url === url);
				if (!found) {
					delete data.actionId;
					delete data.agentId;
					delete data.secret;
				}
				return found;
			},
			async create(this: IHookFunctions): Promise<boolean> {
				const url = this.getNodeWebhookUrl('default') as string;
				const agentId = this.getNodeParameter('agentId') as string;
				// n8n's test URL ("Listen for test event") gets its own action, so it doesn't clash with the live one.
				const test = url.includes('/webhook-test/');
				const name = String(this.getNodeParameter('name')).trim().toLowerCase();
				const parameters = (((this.getNodeParameter('parameters', {}) as IDataObject).parameter as IDataObject[]) ?? [])
					.filter((p) => p.name && p.description)
					.map((p) => ({ name: String(p.name).trim().toLowerCase(), type: p.type ?? 'string', description: String(p.description), required: p.required !== false }));
				const { data } = await veyCallRequest.call(this, 'POST', `/agents/${agentId}/actions`, {
					kind: 'n8n',
					name: test ? `${name}_test`.slice(0, 41) : name,
					title: `${this.getNodeParameter('title') as string}${test ? ' (n8n test)' : ''}`.slice(0, 80),
					description: this.getNodeParameter('description') as string,
					url,
					parameters,
					confirm: this.getNodeParameter('confirm', false) as boolean,
				});
				const stored = this.getWorkflowStaticData('node');
				stored.actionId = data.id;
				stored.agentId = agentId;
				stored.secret = data.signing_secret;
				return true;
			},
			async delete(this: IHookFunctions): Promise<boolean> {
				const stored = this.getWorkflowStaticData('node');
				if (stored.actionId && stored.agentId) {
					try {
						await veyCallRequest.call(this, 'DELETE', `/agents/${stored.agentId}/actions/${stored.actionId}`);
					} catch (error) {
						// Already removed in the dashboard: nothing left to delete. Anything else is reported.
						if ((error as { httpCode?: string }).httpCode !== '404') throw new NodeApiError(this.getNode(), error as JsonObject);
					}
				}
				delete stored.actionId;
				delete stored.agentId;
				delete stored.secret;
				return true;
			},
		},
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const req = this.getRequestObject();
		const secret = this.getWorkflowStaticData('node').secret as string | undefined;
		const timestamp = String(req.headers['x-veycall-timestamp'] ?? '');
		const signature = String(req.headers['x-veycall-signature'] ?? '');
		const raw = (req as unknown as { rawBody?: Buffer }).rawBody?.toString('utf8') ?? JSON.stringify(req.body);
		const expected = secret ? `v1=${createHmac('sha256', secret).update(`${timestamp}.${raw}`).digest('hex')}` : '';
		const valid = Boolean(secret) && signature.length === expected.length && timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
		const fresh = Math.abs(Date.now() / 1000 - Number(timestamp)) <= TOLERANCE_SECONDS;
		if (!valid || !fresh) {
			this.getResponseObject().status(401).json({ ok: false, error: 'Invalid signature' });
			return { noWebhookResponse: true };
		}
		// { action, parameters, customer, conversation, agent, language, test }
		return { workflowData: [this.helpers.returnJsonArray(req.body as IDataObject)] };
	}
}
