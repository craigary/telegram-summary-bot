import OpenAI from 'openai';
export function getGenModel(env: Env) {
	const apiKey = 'my api key'; // defaults to process.env["OPENAI_API_KEY"]
	const accountId = '{account_id}';
	const gatewayId = '{gateway_id}';
	const baseURL = `https://gateway.ai.cloudflare.com/v1/${accountId}/${gatewayId}/openai`;

	const openai = new OpenAI({
		apiKey,
		baseURL,
	});
	return {
		generateContent: async function (prompt: string) {
			const model = 'gpt-3.5-turbo-0613';
			const messages = [{ role: 'user', content: prompt }];
			const maxTokens = 100;
			return (
				await openai.chat.completions.create({
					model,
					//@ts-ignore
					messages,
					max_tokens: maxTokens,
				})
			).choices[0].message.content!;
		},
	};
}
