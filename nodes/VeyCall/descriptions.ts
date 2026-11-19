import type { INodeProperties } from 'n8n-workflow';

const show = (resource: string, operation: string[]) => ({ show: { resource: [resource], operation } });

const agentPicker = (resource: string, operation: string[], required = true): INodeProperties => ({
	displayName: 'Agent Name or ID',
	name: 'agentId',
	type: 'options',
	typeOptions: { loadOptionsMethod: 'getAgents' },
	default: '',
	required,
	description:
		'The VeyCall agent. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
	displayOptions: show(resource, operation),
});

const returnAll = (resource: string): INodeProperties[] => [
	{
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		default: false,
		description: 'Whether to return all results or only up to a given limit',
		displayOptions: show(resource, ['getAll']),
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		typeOptions: { minValue: 1 },
		default: 50,
		description: 'Max number of results to return',
		displayOptions: { show: { resource: [resource], operation: ['getAll'], returnAll: [false] } },
	},
];

export const CHANNELS = [
	{ name: 'Discord', value: 'discord' },
	{ name: 'Gmail', value: 'gmail' },
	{ name: 'Instagram', value: 'instagram' },
	{ name: 'Mattermost', value: 'mattermost' },
	{ name: 'Messenger', value: 'messenger' },
	{ name: 'Microsoft Teams', value: 'teams' },
	{ name: 'Other', value: '__other' },
	{ name: 'Outlook', value: 'outlook' },
	{ name: 'Slack', value: 'slack' },
	{ name: 'SMS', value: 'sms' },
	{ name: 'Telegram', value: 'telegram' },
	{ name: 'WhatsApp', value: 'whatsapp' },
];

const channelFields = (operation: string[]): INodeProperties[] => [
	{
		displayName: 'Channel',
		name: 'channel',
		type: 'options',
		options: CHANNELS,
		default: 'gmail',
		required: true,
		description: 'Where the conversation happens. The agent answers right away unless you chose Approval for this channel in the dashboard.',
		displayOptions: show('message', operation),
	},
	{
		displayName: 'Channel Name',
		name: 'customChannel',
		type: 'string',
		default: '',
		required: true,
		placeholder: 'zendesk',
		description: '2 to 32 lowercase letters, digits, - or _',
		displayOptions: { show: { resource: ['message'], operation, channel: ['__other'] } },
	},
	{
		displayName: 'Conversation ID',
		name: 'conversationId',
		type: 'string',
		default: '',
		required: true,
		description: "The platform's thread, chat or contact ID (Gmail thread ID, Slack channel, WhatsApp number…). Messages with the same ID form one conversation.",
		displayOptions: show('message', operation),
	},
];

// ---------------------------------------------------------------------------
// Message
// ---------------------------------------------------------------------------

export const messageOperations: INodeProperties = {
	displayName: 'Operation',
	name: 'operation',
	type: 'options',
	noDataExpression: true,
	displayOptions: { show: { resource: ['message'] } },
	options: [
		{
			name: 'Answer',
			value: 'answer',
			action: 'Answer a customer message',
			description: 'Send a message a customer wrote (text, voice note, photos…) and get your agent\'s reply to send back',
		},
		{
			name: 'Record Business Reply',
			value: 'business',
			action: 'Record a message the business sent itself',
			description: 'You answered the customer yourself: the agent sees it and steps back in that conversation for a while',
		},
		{
			name: 'Get Approved Replies',
			value: 'getApproved',
			action: 'Get approved replies to send',
			description: 'Replies approved in the dashboard and not sent yet (without the trigger)',
		},
		{
			name: 'Mark Reply Sent',
			value: 'markSent',
			action: 'Mark an approved reply as sent',
		},
	],
	default: 'answer',
};

export const messageFields: INodeProperties[] = [
	agentPicker('message', ['answer', 'business']),
	...channelFields(['answer', 'business']),
	{
		displayName: 'Message ID',
		name: 'messageId',
		type: 'string',
		default: '',
		required: true,
		description: "The platform's unique ID of this message. Sending the same ID again returns the same answer, without paying twice.",
		displayOptions: show('message', ['answer']),
	},
	{
		displayName: 'Sender ID',
		name: 'senderId',
		type: 'string',
		default: '',
		required: true,
		description: "The customer's ID on the platform (email address, user ID, phone number…)",
		displayOptions: show('message', ['answer']),
	},
	{
		displayName: 'Text',
		name: 'text',
		type: 'string',
		typeOptions: { rows: 4 },
		default: '',
		description: 'What the customer wrote (for an email, the body without the quoted history). Can be empty for a voice note.',
		displayOptions: show('message', ['answer', 'business']),
	},
	{
		displayName: 'Voice Note',
		name: 'audioSource',
		type: 'options',
		options: [
			{ name: 'None', value: 'none' },
			{ name: 'From Binary Data', value: 'binary', description: 'The audio file of a previous node (e.g. downloaded from WhatsApp)' },
			{ name: 'From URL', value: 'url', description: 'An https link VeyCall can download' },
		],
		default: 'none',
		description: 'A voice note from the customer: it is transcribed and answered like a text',
		displayOptions: show('message', ['answer']),
	},
	{
		displayName: 'Input Binary Field',
		name: 'binaryPropertyName',
		type: 'string',
		default: 'data',
		required: true,
		hint: 'The name of the input binary field holding the audio',
		displayOptions: { show: { resource: ['message'], operation: ['answer'], audioSource: ['binary'] } },
	},
	{
		displayName: 'Audio URL',
		name: 'audioUrl',
		type: 'string',
		default: '',
		required: true,
		placeholder: 'https://…',
		displayOptions: { show: { resource: ['message'], operation: ['answer'], audioSource: ['url'] } },
	},
	{
		displayName: 'Reply As',
		name: 'replyAs',
		type: 'options',
		options: [
			{ name: 'Automatic', value: 'auto', description: 'A voice note gets a voice note back, a text gets text' },
			{ name: 'Text', value: 'text' },
			{ name: 'Voice and Text', value: 'voice', description: 'Always add the reply in the agent\'s voice' },
		],
		default: 'auto',
		description: 'The reply in the agent\'s voice comes as binary field "audio" (MP3), ready to send as a voice note',
		displayOptions: show('message', ['answer']),
	},
	{
		displayName: 'Additional Fields',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: show('message', ['answer']),
		options: [
			{
				displayName: 'Attachments',
				name: 'attachments',
				type: 'fixedCollection',
				typeOptions: { multipleValues: true },
				default: {},
				description: 'Photos, files, places or contacts the customer sent: the agent reads their caption, name or address',
				options: [
					{
						name: 'attachment',
						displayName: 'Attachment',
						values: [
							{
						displayName: 'Address',
						name: 'address',
						type: 'string',
						default: '',
							},
							{
						displayName: 'Caption',
						name: 'caption',
						type: 'string',
						default: '',
							},
							{
						displayName: 'Latitude',
						name: 'latitude',
						type: 'number',
						default: 0
							},
							{
						displayName: 'Longitude',
						name: 'longitude',
						type: 'number',
						default: 0
							},
							{
						displayName: 'Name',
						name: 'name',
						type: 'string',
						default: '',
							},
							{
						displayName: 'Type',
						name: 'type',
						type: 'options',
						options: [
									{
										name: 'Audio',
										value: 'audio',
									},
									{
										name: 'Contact',
										value: 'contact',
									},
									{
										name: 'File',
										value: 'file',
									},
									{
										name: 'Image',
										value: 'image',
									},
									{
										name: 'Location',
										value: 'location',
									},
									{
										name: 'Other',
										value: 'other',
									},
									{
										name: 'Sticker',
										value: 'sticker',
									},
									{
										name: 'Video',
										value: 'video',
									},
								],
						default: 'image',
							},
					],
					},
				],
			},
			{
				displayName: 'Earlier Messages (JSON)',
				name: 'history',
				type: 'json',
				default: '[]',
				description:
					'The messages exchanged before VeyCall, oldest first: [{"from": "customer" or "business", "text": "…"}]. Read once, on the first message of a conversation.',
			},
			{
				displayName: 'Metadata (JSON)',
				name: 'metadata',
				type: 'json',
				default: '{}',
				description: 'Stored with the message and sent back with approved replies (4 KB max). For email, pass headers like auto_submitted or list_ID.',
			},
			{ displayName: 'Received At', name: 'receivedAt', type: 'dateTime', default: '' },
			{ displayName: 'Sender Email', name: 'senderEmail', type: 'string', placeholder: 'name@email.com', default: '' },
			{ displayName: 'Sender Name', name: 'senderName', type: 'string', default: '' },
			{
				displayName: 'Sender Phone',
				name: 'senderPhone',
				type: 'string',
				default: '',
				description: 'International format, like +33612345678',
			},
			{ displayName: 'Subject', name: 'subject', type: 'string', default: '', description: 'Email subject' },
		],
	},
	{
		displayName: 'Sent At',
		name: 'sentAt',
		type: 'dateTime',
		default: '',
		displayOptions: show('message', ['business']),
	},
	{
		displayName: 'Channel',
		name: 'filterChannel',
		type: 'string',
		default: '',
		placeholder: 'gmail',
		description: 'Only the replies of this channel (empty: all)',
		displayOptions: show('message', ['getApproved']),
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		typeOptions: { minValue: 1, maxValue: 100 },
		default: 50,
		description: 'Max number of results to return',
		displayOptions: show('message', ['getApproved']),
	},
	{
		displayName: 'Reply ID',
		name: 'replyId',
		type: 'string',
		default: '',
		required: true,
		placeholder: 'chr_…',
		displayOptions: show('message', ['markSent']),
	},
];

// ---------------------------------------------------------------------------
// Lead
// ---------------------------------------------------------------------------

const LEAD_STATUS = [
	{ name: 'Contacted', value: 'contacted' },
	{ name: 'Lost', value: 'lost' },
	{ name: 'New', value: 'new' },
	{ name: 'Qualified', value: 'qualified' },
	{ name: 'Won', value: 'won' },
];
const PRIORITY = [
	{ name: 'Normal', value: 'normal' },
	{ name: 'Urgent', value: 'urgent' },
];

export const leadOperations: INodeProperties = {
	displayName: 'Operation',
	name: 'operation',
	type: 'options',
	noDataExpression: true,
	displayOptions: { show: { resource: ['lead'] } },
	options: [
		{ name: 'Create', value: 'create', action: 'Create a lead' },
		{ name: 'Delete', value: 'delete', action: 'Delete a lead' },
		{ name: 'Get', value: 'get', action: 'Get a lead' },
		{ name: 'Get Many', value: 'getAll', action: 'Get many leads' },
		{ name: 'Update', value: 'update', action: 'Update a lead' },
	],
	default: 'create',
};

const leadDetails: INodeProperties[] = [
	{ displayName: 'Name', name: 'name', type: 'string', default: '' },
	{ displayName: 'Email', name: 'email', type: 'string', placeholder: 'name@email.com', default: '' },
	{ displayName: 'Phone', name: 'phone', type: 'string', default: '' },
	{ displayName: 'Status', name: 'status', type: 'options', options: LEAD_STATUS, default: 'new' },
	{ displayName: 'Priority', name: 'priority', type: 'options', options: PRIORITY, default: 'normal' },
	{ displayName: 'Notes', name: 'notes', type: 'string', typeOptions: { rows: 3 }, default: '' },
];

export const leadFields: INodeProperties[] = [
	{
		displayName: 'Lead ID',
		name: 'leadId',
		type: 'string',
		default: '',
		required: true,
		placeholder: 'lead_…',
		displayOptions: show('lead', ['get', 'update', 'delete']),
	},
	{
		displayName: 'Fields',
		name: 'leadFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		description: 'Give at least a name, an email or a phone',
		displayOptions: show('lead', ['create']),
		options: [
			...leadDetails,
			{ displayName: 'Agent ID', name: 'agent_id', type: 'string', default: '', placeholder: 'agent_…' },
			{ displayName: 'Conversation ID', name: 'conversation_id', type: 'string', default: '', placeholder: 'conv_…' },
		],
	},
	{
		displayName: 'Update Fields',
		name: 'updateFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: show('lead', ['update']),
		options: leadDetails,
	},
	...returnAll('lead'),
	{
		displayName: 'Filters',
		name: 'filters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		displayOptions: show('lead', ['getAll']),
		options: [
			{ displayName: 'Agent ID', name: 'agent_id', type: 'string', default: '' },
			{ displayName: 'Priority', name: 'priority', type: 'options', options: PRIORITY, default: 'urgent' },
			{ displayName: 'Search', name: 'q', type: 'string', default: '', description: 'Name, email or phone' },
			{ displayName: 'Status', name: 'status', type: 'options', options: LEAD_STATUS, default: 'new' },
		],
	},
];

// ---------------------------------------------------------------------------
// Conversation
// ---------------------------------------------------------------------------

export const conversationOperations: INodeProperties = {
	displayName: 'Operation',
	name: 'operation',
	type: 'options',
	noDataExpression: true,
	displayOptions: { show: { resource: ['conversation'] } },
	options: [
		{ name: 'Delete', value: 'delete', action: 'Delete a conversation' },
		{ name: 'Get', value: 'get', action: 'Get a conversation', description: 'With its summary and captured lead' },
		{ name: 'Get Many', value: 'getAll', action: 'Get many conversations' },
		{ name: 'Get Messages', value: 'getMessages', action: 'Get the messages of a conversation', description: 'The transcript' },
	],
	default: 'get',
};

export const conversationFields: INodeProperties[] = [
	{
		displayName: 'Conversation ID',
		name: 'conversationId',
		type: 'string',
		default: '',
		required: true,
		placeholder: 'conv_…',
		displayOptions: show('conversation', ['get', 'getMessages', 'delete']),
	},
	...returnAll('conversation'),
	{
		displayName: 'Filters',
		name: 'filters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		displayOptions: show('conversation', ['getAll']),
		options: [
			{ displayName: 'Agent ID', name: 'agent_id', type: 'string', default: '' },
			{
				displayName: 'Channel',
				name: 'channel',
				type: 'options',
				options: [
					{ name: 'Messages (Channels)', value: 'messaging' },
					{ name: 'Phone', value: 'phone' },
					{ name: 'Test (Voice Studio)', value: 'dashboard' },
					{ name: 'Website and Calls', value: 'web' },
				],
				default: 'web',
			},
			{ displayName: 'From', name: 'from', type: 'dateTime', default: '' },
			{ displayName: 'Platform', name: 'platform', type: 'string', default: '', placeholder: 'gmail' },
			{
				displayName: 'Status',
				name: 'status',
				type: 'options',
				options: [
					{ name: 'Abandoned', value: 'abandoned' },
					{ name: 'Active', value: 'active' },
					{ name: 'Completed', value: 'completed' },
					{ name: 'Failed', value: 'failed' },
				],
				default: 'completed',
			},
			{ displayName: 'To', name: 'to', type: 'dateTime', default: '' },
		],
	},
];

// ---------------------------------------------------------------------------
// Knowledge
// ---------------------------------------------------------------------------

export const knowledgeOperations: INodeProperties = {
	displayName: 'Operation',
	name: 'operation',
	type: 'options',
	noDataExpression: true,
	displayOptions: { show: { resource: ['knowledge'] } },
	options: [
		{ name: 'Add', value: 'create', action: 'Add knowledge', description: 'A website, an online store, a text or a FAQ' },
		{ name: 'Delete', value: 'delete', action: 'Delete a knowledge document' },
		{ name: 'Get', value: 'get', action: 'Get a knowledge document' },
		{ name: 'Get Many', value: 'getAll', action: 'Get many knowledge documents' },
		{ name: 'Re-Index', value: 'reindex', action: 'Re index a knowledge document', description: 'Read the website or file again' },
		{ name: 'Upload File', value: 'upload', action: 'Upload a file', description: 'PDF, TXT, DOCX or CSV, up to 20 MB' },
	],
	default: 'create',
};

export const knowledgeFields: INodeProperties[] = [
	{
		displayName: 'Document ID',
		name: 'documentId',
		type: 'string',
		default: '',
		required: true,
		placeholder: 'kd_…',
		displayOptions: show('knowledge', ['get', 'delete', 'reindex']),
	},
	{
		displayName: 'Type',
		name: 'type',
		type: 'options',
		options: [
			{ name: 'FAQ', value: 'faq' },
			{ name: 'Online Store', value: 'store', description: 'Shopify, WooCommerce or any store with a sitemap' },
			{ name: 'Text', value: 'text' },
			{ name: 'Website Page or Site', value: 'url' },
		],
		default: 'url',
		displayOptions: show('knowledge', ['create']),
	},
	{
		displayName: 'URL',
		name: 'url',
		type: 'string',
		default: '',
		required: true,
		placeholder: 'https://…',
		displayOptions: { show: { resource: ['knowledge'], operation: ['create'], type: ['url', 'store'] } },
	},
	{
		displayName: 'Content',
		name: 'content',
		type: 'string',
		typeOptions: { rows: 6 },
		default: '',
		required: true,
		displayOptions: { show: { resource: ['knowledge'], operation: ['create'], type: ['text'] } },
	},
	{
		displayName: 'Questions',
		name: 'faq',
		type: 'fixedCollection',
		typeOptions: { multipleValues: true },
		default: {},
		required: true,
		displayOptions: { show: { resource: ['knowledge'], operation: ['create'], type: ['faq'] } },
		options: [
			{
				name: 'item',
				displayName: 'Question',
				values: [
					{ displayName: 'Question', name: 'question', type: 'string', default: '' },
					{ displayName: 'Answer', name: 'answer', type: 'string', typeOptions: { rows: 2 }, default: '' },
				],
			},
		],
	},
	{
		displayName: 'Input Binary Field',
		name: 'binaryPropertyName',
		type: 'string',
		default: 'data',
		required: true,
		hint: 'The name of the input binary field holding the file',
		displayOptions: show('knowledge', ['upload']),
	},
	{
		displayName: 'Additional Fields',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: show('knowledge', ['create', 'upload']),
		options: [
			{ displayName: 'Title', name: 'title', type: 'string', default: '' },
			{
				displayName: 'Agent ID',
				name: 'agent_id',
				type: 'string',
				default: '',
				description: 'Only this agent uses it (empty: all agents)',
			},
		],
	},
	...returnAll('knowledge'),
	{
		displayName: 'Filters',
		name: 'filters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		displayOptions: show('knowledge', ['getAll']),
		options: [
			{ displayName: 'Agent ID', name: 'agent_id', type: 'string', default: '' },
			{
				displayName: 'Status',
				name: 'status',
				type: 'options',
				options: [
					{ name: 'Failed', value: 'failed' },
					{ name: 'Pending', value: 'pending' },
					{ name: 'Processing', value: 'processing' },
					{ name: 'Ready', value: 'ready' },
				],
				default: 'ready',
			},
		],
	},
];

// ---------------------------------------------------------------------------
// Agent
// ---------------------------------------------------------------------------

export const agentOperations: INodeProperties = {
	displayName: 'Operation',
	name: 'operation',
	type: 'options',
	noDataExpression: true,
	displayOptions: { show: { resource: ['agent'] } },
	options: [
		{ name: 'Get', value: 'get', action: 'Get an agent' },
		{ name: 'Get Many', value: 'getAll', action: 'Get many agents' },
	],
	default: 'getAll',
};

export const agentFields: INodeProperties[] = [agentPicker('agent', ['get'])];
