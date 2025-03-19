export async function extractAllOGInfo(url: string): Promise<string> {
	const ogData = new Map<string, string>();
	try {
		const response = await fetch(url);
		if (!response.ok) {
			throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
		}

		class MetaHandler {
			element(element: Element) {
				const propertyValue = element.getAttribute('property');
				// og
				if (propertyValue?.startsWith('og:')) {
					const contentValue = element.getAttribute('content');
					if (contentValue) {
						ogData.set(propertyValue.replace('og:', ''), contentValue);
					}
					element.remove();
				}
				// youtube
				const name = element.getAttribute('name');
				const contentValue = element.getAttribute('content');

				if (name && contentValue) {
					ogData.set(name, contentValue);
					element.remove();
				}
			}
		}
		const rewriter = new HTMLRewriter().on('meta', new MetaHandler());
		await rewriter.transform(response).text(); // 使用 await 处理 Promise
		if (ogData.size === 0) {
			return url;
		}
		let ret = '';
		for (const [key, value] of ogData.entries()) {
			ret += `${key}: ${value}\n`;
		}
		return `${url} 的相关信息为:\n` + ret;
	} catch (error) {
		return url;
	}
}
