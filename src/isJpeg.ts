export function isJPEGBase64(base64String: string) {
	// 移除可能存在的 data URI scheme 前缀
	const cleanBase64 = base64String.replace(/^data:image\/jpeg;base64,/, '');

	// 将 base64 解码为字节数组
	const binary = atob(cleanBase64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}

	// 检查 JPEG 文件头 (SOI - Start of Image)
	// JPEG 以 FF D8 开始
	if (bytes[0] !== 0xff || bytes[1] !== 0xd8) {
		return {
			isValid: false,
			reason: 'Invalid JPEG header (missing SOI marker)',
		};
	}

	// 检查 JPEG 文件尾 (EOI - End of Image)
	// JPEG 以 FF D9 结束
	if (bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) {
		return {
			isValid: false,
			reason: 'Invalid JPEG footer (missing EOI marker)',
		};
	}

	return {
		isValid: true,
		reason: 'Valid JPEG format',
	};
}
