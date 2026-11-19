import type { IAuthenticateGeneric, Icon, ICredentialTestRequest, ICredentialType, INodeProperties } from 'n8n-workflow';

export class VeyCallApi implements ICredentialType {
	name = 'veyCallApi';

	displayName = 'VeyCall API';

	icon: Icon = { light: 'file:veycall.svg', dark: 'file:veycall.dark.svg' };

	documentationUrl = 'https://veycall.com/docs/channels';

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description:
				'An organization API key (vc_live_…), created in the VeyCall dashboard. The account needs the "API and webhooks" activation.',
		},
		{
			displayName: 'API URL',
			name: 'baseUrl',
			type: 'string',
			default: 'https://api.veycall.com/api/v1',
			description: 'Leave as is, unless VeyCall support gave you another address',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.baseUrl}}',
			url: '/agents',
		},
	};
}
