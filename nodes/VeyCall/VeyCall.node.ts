import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import {
	agentFields,
	agentOperations,
	conversationFields,
	conversationOperations,
	knowledgeFields,
	knowledgeOperations,
	leadFields,
	leadOperations,
	messageFields,
	messageOperations,
} from './descriptions';
import { getAgents, parseJson, veyCallList, veyCallRequest } from './GenericFunctions';

/** Keeps only the fields that were filled in. */
const filled = (o: IDataObject) =>
	Object.fromEntries(Object.entries(o).filter(([, v]) => v !== '' && v !== undefined && v !== null)) as IDataObject;

export class VeyCall implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'VeyCall',
		name: 'veyCall',
		icon: { light: 'file:veycall.svg', dark: 'file:veycall.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description:
			'Your VeyCall AI agent answers on any platform (text and voice notes); manage leads, conversations and knowledge',
		defaults: { name: 'VeyCall' },
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'veyCallApi', required: true }],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Agent', value: 'agent' },
					{ name: 'Conversation', value: 'conversation' },
					{ name: 'Knowledge', value: 'knowledge' },
					{ name: 'Lead', value: 'lead' },
					{ name: 'Message', value: 'message' },
				],
				default: 'message',
			},
			messageOperations,
			...messageFields,
			leadOperations,
			...leadFields,
			conversationOperations,
			...conversationFields,
			knowledgeOperations,
			...knowledgeFields,
			agentOperations,
			...agentFields,
		],
	};

	methods = { loadOptions: { getAgents } };

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const out: INodeExecutionData[] = [];
		for (let i = 0; i < items.length; i++) {
			try {
				const resource = this.getNodeParameter('resource', i) as string;
				const operation = this.getNodeParameter('operation', i) as string;
				const result = await run.call(this, resource, operation, i);
				for (const r of result) out.push({ ...r, pairedItem: { item: i } });
			} catch (error) {
				if (this.continueOnFail()) {
					out.push({ json: { error: (error as Error).message }, pairedItem: { item: i } });
					continue;
				}
				throw new NodeOperationError(this.getNode(), error as Error, { itemIndex: i });
			}
		}
		return [out];
	}
}

const list = (data: unknown): INodeExecutionData[] =>
	((Array.isArray(data) ? data : [data]) as IDataObject[]).map((json) => ({ json }));

async function run(this: IExecuteFunctions, resource: string, operation: string, i: number): Promise<INodeExecutionData[]> {
	const p = <T>(name: string, fallback?: T) => this.getNodeParameter(name, i, fallback) as T;
	const all = () => [p<boolean>('returnAll', false), p<number>('limit', 50)] as const;

	if (resource === 'message') {
		const channel = () => {
			const c = p<string>('channel');
			return c === '__other' ? p<string>('customChannel').trim().toLowerCase() : c;
		};
		if (operation === 'answer') {
			const extra = p<IDataObject>('additionalFields', {});
			const body: IDataObject = {
				agent_id: p<string>('agentId'),
				channel: channel(),
				conversation_id: p<string>('conversationId'),
				message_id: p<string>('messageId'),
				from: filled({
					id: p<string>('senderId'),
					name: extra.senderName,
					email: extra.senderEmail,
					phone: extra.senderPhone,
				}),
				text: p<string>('text', ''),
				reply_as: p<string>('replyAs', 'auto'),
				...filled({ subject: extra.subject, received_at: extra.receivedAt }),
			};
			const source = p<string>('audioSource', 'none');
			if (source === 'binary') {
				const prop = p<string>('binaryPropertyName');
				const bin = this.helpers.assertBinaryData(i, prop);
				const buffer = await this.helpers.getBinaryDataBuffer(i, prop);
				body.audio = { base64: buffer.toString('base64'), mime_type: bin.mimeType };
			} else if (source === 'url') {
				body.audio = { url: p<string>('audioUrl') };
			}
			const attachments = ((extra.attachments as IDataObject | undefined)?.attachment as IDataObject[] | undefined) ?? [];
			if (attachments.length)
				body.attachments = attachments.map((a) => {
					const hasPlace = a.type === 'location' && (Number(a.latitude) !== 0 || Number(a.longitude) !== 0);
					return filled({
						type: a.type,
						caption: a.caption,
						name: a.name,
						address: a.address,
						...(hasPlace ? { latitude: a.latitude, longitude: a.longitude } : {}),
					});
				});
			const history = parseJson.call(this, extra.history, 'Earlier Messages', i);
			if (Array.isArray(history) && history.length) body.history = history;
			const metadata = parseJson.call(this, extra.metadata, 'Metadata', i);
			if (metadata && Object.keys(metadata).length) body.metadata = metadata;

			const { data } = await veyCallRequest.call(this, 'POST', '/channels/messages', body);
			const reply = data?.reply as IDataObject | undefined;
			const audio = reply?.audio as { base64: string; mime_type: string } | undefined;
			if (!audio) return [{ json: data }];
			// The reply in the agent's voice, as a binary field ready for a "send audio" node.
			const json = { ...data, reply: { ...reply, audio: { mime_type: audio.mime_type, binary_field: 'audio' } } };
			const ext = audio.mime_type.includes('ogg') ? 'ogg' : 'mp3';
			const binary = await this.helpers.prepareBinaryData(Buffer.from(audio.base64, 'base64'), `reply.${ext}`, audio.mime_type);
			return [{ json, binary: { audio: binary } }];
		}
		if (operation === 'business') {
			const { data } = await veyCallRequest.call(this, 'POST', '/channels/messages/business', {
				agent_id: p<string>('agentId'),
				channel: channel(),
				conversation_id: p<string>('conversationId'),
				text: p<string>('text', ''),
				...filled({ sent_at: p<string>('sentAt', '') }),
			});
			return [{ json: data }];
		}
		if (operation === 'getApproved') {
			const { data } = await veyCallRequest.call(this, 'GET', '/channels/replies', undefined, {
				channel: p<string>('filterChannel', ''),
				limit: p<number>('limit', 50),
			});
			return list(data);
		}
		if (operation === 'markSent') {
			const { data } = await veyCallRequest.call(this, 'POST', `/channels/replies/${p<string>('replyId')}/sent`);
			return [{ json: data }];
		}
	}

	if (resource === 'lead') {
		if (operation === 'create') {
			const fields = filled(p<IDataObject>('leadFields', {}));
			if (!fields.name && !fields.email && !fields.phone)
				throw new NodeOperationError(this.getNode(), 'Give the lead at least a name, an email or a phone', { itemIndex: i });
			const { data } = await veyCallRequest.call(this, 'POST', '/leads', { source: 'api', ...fields });
			return [{ json: data }];
		}
		if (operation === 'get') return [{ json: (await veyCallRequest.call(this, 'GET', `/leads/${p<string>('leadId')}`)).data }];
		if (operation === 'update') {
			const { data } = await veyCallRequest.call(this, 'PATCH', `/leads/${p<string>('leadId')}`, filled(p<IDataObject>('updateFields', {})));
			return [{ json: data }];
		}
		if (operation === 'delete') {
			await veyCallRequest.call(this, 'DELETE', `/leads/${p<string>('leadId')}`);
			return [{ json: { id: p<string>('leadId'), deleted: true } }];
		}
		if (operation === 'getAll') return list(await veyCallList.call(this, '/leads', filled(p<IDataObject>('filters', {})), ...all()));
	}

	if (resource === 'conversation') {
		const id = () => p<string>('conversationId');
		if (operation === 'get') return [{ json: (await veyCallRequest.call(this, 'GET', `/conversations/${id()}`)).data }];
		if (operation === 'getMessages') return list((await veyCallRequest.call(this, 'GET', `/conversations/${id()}/messages`)).data);
		if (operation === 'delete') {
			await veyCallRequest.call(this, 'DELETE', `/conversations/${id()}`);
			return [{ json: { id: id(), deleted: true } }];
		}
		if (operation === 'getAll') {
			const filters = filled(p<IDataObject>('filters', {}));
			for (const k of ['from', 'to']) if (filters[k]) filters[k] = new Date(String(filters[k])).toISOString();
			return list(await veyCallList.call(this, '/conversations', filters, ...all()));
		}
	}

	if (resource === 'knowledge') {
		const id = () => p<string>('documentId');
		const extra = filled(p<IDataObject>('additionalFields', {}));
		if (operation === 'create') {
			const type = p<string>('type');
			const body: IDataObject = { type, ...extra };
			if (type === 'url' || type === 'store') body.url = p<string>('url');
			if (type === 'text') {
				body.content = p<string>('content');
				body.title ??= 'Text';
			}
			if (type === 'faq') body.items = ((p<IDataObject>('faq', {}).item as IDataObject[] | undefined) ?? []).filter((q) => q.question && q.answer);
			return [{ json: (await veyCallRequest.call(this, 'POST', '/knowledge', body)).data }];
		}
		if (operation === 'upload') {
			const prop = p<string>('binaryPropertyName');
			const bin = this.helpers.assertBinaryData(i, prop);
			const buffer = await this.helpers.getBinaryDataBuffer(i, prop);
			const form = new FormData();
			form.append('file', new Blob([new Uint8Array(buffer)], { type: bin.mimeType }), bin.fileName ?? 'document');
			if (extra.title) form.append('title', String(extra.title));
			if (extra.agent_id) form.append('agent_id', String(extra.agent_id));
			return [{ json: (await veyCallRequest.call(this, 'POST', '/knowledge/upload', form)).data }];
		}
		if (operation === 'get') return [{ json: (await veyCallRequest.call(this, 'GET', `/knowledge/${id()}`)).data }];
		if (operation === 'reindex') return [{ json: (await veyCallRequest.call(this, 'POST', `/knowledge/${id()}/reindex`)).data }];
		if (operation === 'delete') {
			await veyCallRequest.call(this, 'DELETE', `/knowledge/${id()}`);
			return [{ json: { id: id(), deleted: true } }];
		}
		if (operation === 'getAll') return list(await veyCallList.call(this, '/knowledge', filled(p<IDataObject>('filters', {})), ...all()));
	}

	if (resource === 'agent') {
		if (operation === 'get') return [{ json: (await veyCallRequest.call(this, 'GET', `/agents/${p<string>('agentId')}`)).data }];
		if (operation === 'getAll') return list((await veyCallRequest.call(this, 'GET', '/agents')).data);
	}

	throw new NodeOperationError(this.getNode(), `Unknown operation ${resource}.${operation}`, { itemIndex: i });
}
