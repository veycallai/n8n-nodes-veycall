import type {
	IDataObject,
	IExecuteFunctions,
	IHookFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	INodePropertyOptions,
	IWebhookFunctions,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError } from 'n8n-workflow';

/** The API's envelope: `data`, and `meta` for paginated lists. */
export type VeyCallResponse = { data: IDataObject; meta?: IDataObject };

type Context = IExecuteFunctions | ILoadOptionsFunctions | IHookFunctions | IWebhookFunctions;

/** A call to the VeyCall API with the organization API key. Returns the `data` of the answer (and its `meta`). */
export async function veyCallRequest(
	this: Context,
	method: IHttpRequestMethods,
	path: string,
	body?: IDataObject | FormData,
	qs?: IDataObject,
): Promise<VeyCallResponse> {
	const credentials = await this.getCredentials('veyCallApi');
	const options: IHttpRequestOptions = {
		method,
		baseURL: String(credentials.baseUrl || 'https://api.veycall.com/api/v1').replace(/\/$/, ''),
		url: path,
		// A file upload is sent as a form; everything else is JSON.
		json: !(body instanceof FormData),
	};
	if (body !== undefined) options.body = body;
	if (qs) options.qs = Object.fromEntries(Object.entries(qs).filter(([, v]) => v !== undefined && v !== ''));
	try {
		const res = (await this.helpers.httpRequestWithAuthentication.call(this, 'veyCallApi', options)) as
			| VeyCallResponse
			| string
			| undefined;
		const parsed = typeof res === 'string' ? (JSON.parse(res) as VeyCallResponse) : res;
		return parsed ?? { data: { success: true } };
	} catch (error) {
		throw new NodeApiError(this.getNode(), error as JsonObject);
	}
}

/** Every page of a list (cursor pagination), or the first `limit` items. */
export async function veyCallList(
	this: IExecuteFunctions,
	path: string,
	qs: IDataObject,
	returnAll: boolean,
	limit: number,
): Promise<IDataObject[]> {
	const out: IDataObject[] = [];
	let cursor: string | undefined;
	do {
		const page = await veyCallRequest.call(this, 'GET', path, undefined, {
			...qs,
			limit: returnAll ? 100 : Math.min(100, limit - out.length),
			cursor,
		});
		out.push(...((page.data as unknown as IDataObject[]) ?? []));
		cursor = (page.meta?.next_cursor as string | undefined) ?? undefined;
	} while (cursor && (returnAll || out.length < limit));
	return returnAll ? out : out.slice(0, limit);
}

/** The organization's agents, for the agent pickers. */
export async function getAgents(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
	const { data } = await veyCallRequest.call(this, 'GET', '/agents');
	return ((data as unknown as Array<{ id: string; name: string; status?: string }>) ?? []).map((a) => ({
		name: a.status === 'archived' ? `${a.name} (archived)` : a.name,
		value: a.id,
	}));
}

/** A JSON field that may arrive as text or as an object. */
export function parseJson(this: IExecuteFunctions, value: unknown, field: string, i: number): unknown {
	if (value === undefined || value === null || value === '') return undefined;
	if (typeof value !== 'string') return value;
	try {
		return JSON.parse(value);
	} catch {
		throw new NodeApiError(this.getNode(), { message: `${field} is not valid JSON` } as JsonObject, { itemIndex: i });
	}
}
