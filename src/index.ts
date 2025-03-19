import { Bot, webhookCallback } from 'grammy';
import { GenerationConfig, GoogleGenerativeAI, HarmBlockThreshold, HarmCategory, SchemaType } from '@google/generative-ai';
import telegramifyMarkdown from 'telegramify-markdown';
//@ts-ignore
import { Buffer } from 'node:buffer';
import { isJPEGBase64 } from './isJpeg';
import { extractAllOGInfo } from './og';
function dispatchContent(content: string) {
	if (content.startsWith('data:image/jpeg;base64,')) {
		return {
			inlineData: {
				data: content.slice('data:image/jpeg;base64,'.length),
				mimeType: 'image/jpeg',
			},
		};
	}
	return content;
}

function getMessageLink(r: { groupId: string; messageId: number; topicId?: number | null }): string {
	return r.topicId
		? `https://t.me/c/${parseInt(r.groupId.slice(2))}/${r.topicId}/${r.messageId}`
		: `https://t.me/c/${parseInt(r.groupId.slice(2))}/${r.messageId}`;
}

function getSendTime(r: R) {
	return new Date(r.timeStamp).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
}

/**
 * 将数字转换为上标数字
 * @param {number} num - 要转换的数字
 * @returns {string} 上标形式的数字
 */
export function toSuperscript(num: number): string {
	const superscripts = {
		'0': '⁰',
		'1': '¹',
		'2': '²',
		'3': '³',
		'4': '⁴',
		'5': '⁵',
		'6': '⁶',
		'7': '⁷',
		'8': '⁸',
		'9': '⁹',
	};

	return num
		.toString()
		.split('')
		.map((digit) => superscripts[digit as keyof typeof superscripts])
		.join('');
}
/**
 * 处理 Markdown 文本中的重复链接，将其转换为顺序编号的格式
 * @param {string} text - 输入的 Markdown 文本
 * @param {Object} options - 配置选项
 * @param {string} options.prefix - 链接文本的前缀，默认为"链接"
 * @param {boolean} options.useEnglish - 是否使用英文(link1)而不是中文(链接1)，默认为 false
 * @returns {string} 处理后的 Markdown 文本
 */
export function processMarkdownLinks(
	text: string,
	options: { prefix: string; useEnglish: boolean } = {
		prefix: '引用',
		useEnglish: false,
	}
): string {
	const { prefix, useEnglish } = options;

	// 用于存储已经出现过的链接
	const linkMap = new Map();
	let linkCounter = 1;

	// 匹配 markdown 链接的正则表达式
	const linkPattern = /\[([^\]]+)\]\(([^)]+)\)/g;

	return text.replace(linkPattern, (match, displayText, url) => {
		// 只处理显示文本和 URL 完全相同的情况
		if (displayText !== url) {
			return match; // 保持原样
		}

		// 如果这个 URL 已经出现过，使用已存在的编号
		if (!linkMap.has(url)) {
			linkMap.set(url, linkCounter++);
		}
		const linkNumber = linkMap.get(url);

		// 根据选项决定使用中文还是英文格式
		const linkPrefix = useEnglish ? 'link' : prefix;

		// 返回新的格式 [链接1](原URL) 或 [link1](原URL)
		return `[${linkPrefix}${toSuperscript(linkNumber)}](${url})`;
	});
}

type R = {
	groupId: string;
	userName: string;
	content: string;
	messageId: number;
	timeStamp: number;
};

function getGenModel(env: Env) {
	const model = 'gemini-2.0-flash-exp';
	const gateway_name = 'telegram-summary-bot';
	const genAI = new GoogleGenerativeAI(env.GEMINI_API_KEY);
	const account_id = env.account_id;
	// https://www.reddit.com/r/Bard/comments/1i14ko9/quite_literally_everything_is_getting_censored/
	const safetySettings = [
		{
			category: HarmCategory.HARM_CATEGORY_HARASSMENT,
			threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH,
		},
		{
			category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
			threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH,
		},
		{
			category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
			threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH,
		},
		{
			category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
			threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH,
		},
	];
	const generationConfig = {
		maxOutputTokens: 4096,
	};
	return genAI.getGenerativeModel(
		{ model, safetySettings, generationConfig },
		{ baseUrl: `https://gateway.ai.cloudflare.com/v1/${account_id}/${gateway_name}/google-ai-studio`, timeout: 99999999999 }
	);
}

function getCommandVar(str: string, delim: string) {
	return str.slice(str.indexOf(delim) + delim.length);
}

function messageTemplate(s: string) {
	return s;
	// return `下面由免费 gemini 2.0 概括群聊信息\n` + s + `\n本开源项目[地址](https://github.com/asukaminato0721/telegram-summary-bot)`;
}
function getUserName(msg: any) {
	if (msg?.sender_chat?.title) {
		return msg.sender_chat.title as string;
	}
	return (msg.from?.first_name as string) || 'anonymous';
}
export default {
	async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
		console.log('开始执行定时任务:', new Date().toISOString());
		const date = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));

		// 清理旧消息
		if (date.getHours() === 0 && date.getMinutes() < 5) {
			console.log('开始清理旧消息');
			await env.DB.prepare(
				`
          DELETE FROM Messages
          WHERE id IN (
            SELECT id
            FROM (
              SELECT
                id,
                ROW_NUMBER() OVER (
                  PARTITION BY groupId
                  ORDER BY timeStamp DESC
                ) as row_num
              FROM Messages
            ) ranked
            WHERE row_num > 3000
          );`
			).run();
			console.log('旧消息清理完成');
		}

		// 获取要处理的单一 groupId (从环境变量或硬编码)
		const groupId = env.GROUP_ID;
		console.log('目标群组ID:', groupId);

		if (!groupId) {
			console.error('未设置目标群组ID');
			return;
		}

		console.log('开始处理群组:', groupId);

		// 查询特定 groupId 的消息
		const { results } = await env.DB.prepare(
			`
    SELECT * FROM Messages
    WHERE groupId = ?
    AND timeStamp >= ?
    AND topicId = ?
    ORDER BY timeStamp ASC
`
		)
			.bind(groupId, Date.now() - 24 * 60 * 60 * 1000, env.TOPIC_ID || null)
			.all();
		console.log('查询到消息数量:', results.length);

		// 生成摘要
		console.log('开始生成摘要');
		const result = await getGenModel(env).generateContent([
			`用符合风格的语气概括下面的对话, 对话格式为
====================
用户名:
发言内容
相应链接
====================
如果对话里出现了多个主题, 请分条概括, 涉及到的图片也要提到相关内容, 并在回答的关键词中用 markdown 的格式引用原对话的链接, 格式为
[引用1](链接本体)
[引用2](链接本体)
[关键字1](链接本体)
[关键字2](链接本体)`,
			`概括的开头是: 本日群聊总结如下：`,
			...results.flatMap((r: any) => [`====================`, `${r.userName}:`, dispatchContent(r.content), getMessageLink(r)]),
		]);
		console.log('摘要生成完成');

		// 发送摘要到 Telegram 群组
		console.log('准备发送摘要到群组:', groupId);
		await fetch(`https://api.telegram.org/bot${env.SECRET_TELEGRAM_API_TOKEN}/sendMessage`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				chat_id: groupId,
				message_thread_id: env.TOPIC_ID || undefined,
				text: processMarkdownLinks(telegramifyMarkdown(messageTemplate(result.response.text()), 'keep')),
				parse_mode: 'MarkdownV2',
			}),
		});
		console.log('摘要发送完成');

		// 清理旧图片
		if (date.getHours() === 0 && date.getMinutes() < 5) {
			console.log('开始清理旧图片');
			ctx.waitUntil(
				env.DB.prepare(
					`
          DELETE
          FROM Messages
          WHERE timeStamp < ? AND content LIKE 'data:image/jpeg;base64,%'`
				)
					.bind(Date.now() - 24 * 60 * 60 * 1000)
					.run()
			);
			console.log('旧图片清理完成');
		}

		console.log('定时任务处理完成');
	},
	fetch: async (request: Request, env: Env, ctx: ExecutionContext) => {
		console.log('收到新的请求');
		const bot = new Bot(env.SECRET_TELEGRAM_API_TOKEN);

		// 状态命令
		bot.command('status', async (ctx) => {
			console.log('收到状态请求');
			try {
				await ctx.reply('我家还蛮大的');
			} catch (e) {
				console.error('发送消息失败:', e);
			}
		});

		// 查询命令
		bot.command('query', async (ctx) => {
			console.log('收到查询请求');
			const messageText = ctx.message?.text || '';
			if (!messageText.split(' ')[1]) {
				console.log('查询关键词为空');
				try {
					await ctx.reply('请输入要查询的关键词');
				} catch (e) {
					console.error('发送消息失败:', e);
				}
				return;
			}
			console.log('开始查询关键词:', messageText.split(' ')[1]);
			const { results } = await env.DB.prepare(
				`
				SELECT * FROM Messages
				WHERE groupId=? AND content GLOB ?
				ORDER BY timeStamp DESC
				LIMIT 2000`
			)
				.bind(ctx.chat.id, `*${messageText.split(' ')[1]}*`)
				.all();
			console.log('查询到结果数量:', results.length);
			try {
				await ctx.reply(
					`查询结果:
${results
	.map(
		(r: any) =>
			`${r.userName}: ${r.content} ${r.messageId == null ? '' : `[link](https://t.me/c/${parseInt(r.groupId.slice(2))}/${r.messageId})`}`
	)
	.join('\n')}`,
					{ parse_mode: 'MarkdownV2' }
				);
			} catch (e) {
				console.error('发送消息失败:', e);
			}
		});

		// 处理文本消息
		bot.on('message:text', async (ctx) => {
			console.log('收到新消息');
			if (!ctx.chat.type.includes('group')) {
				console.log('消息不是来自群组');
				await ctx.reply('I am a bot, please add me to a group to use me.');
				return;
			}

			const msg = ctx.message;
			const groupId = msg.chat.id;
			const topicId = msg.message_thread_id || null;
			let content = msg.text || '';

			// const fwd = msg.forward_origin?.type;
			// if (fwd) {
			// 	content = `转发自 ${fwd}: ${content}`;
			// }

			const replyTo = msg.reply_to_message?.message_id;
			if (replyTo) {
				content = `回复 ${getMessageLink({ groupId: groupId.toString(), messageId: replyTo, topicId })}: ${content}`;
			}
			if (content.startsWith('http') && !content.includes(' ')) {
				console.log('处理URL消息');
				content = await extractAllOGInfo(content);
			}
			const messageId = msg.message_id;
			const groupName = msg.chat.title || 'anonymous';
			const timeStamp = Date.now();
			const userName = getUserName(msg);
			console.log('准备保存消息到数据库:', {
				groupId,
				messageId,
				topicId,
				userName,
				groupName,
				content,
			});
			try {
				await env.DB.prepare(
					`
					INSERT INTO Messages(id, groupId, timeStamp, userName, content, messageId, groupName, topicId) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
				)
					.bind(
						getMessageLink({ groupId: groupId.toString(), messageId, topicId }),
						groupId,
						timeStamp,
						userName,
						content,
						messageId,
						groupName,
						topicId
					)
					.run();
				console.log('消息保存成功');
			} catch (e) {
				console.error('消息保存失败:', e);
			}
		});

		// 处理图片消息
		bot.on('message:photo', async (ctx) => {
			console.log('处理图片消息');
			const msg = ctx.message;
			const groupId = msg.chat.id;
			const messageId = msg.message_id;
			const groupName = msg.chat.title || 'anonymous';
			const topicId = msg.message_thread_id || null;
			const timeStamp = Date.now();
			const userName = getUserName(msg);
			const photo = msg.photo![msg.photo!.length - 1];
			console.log('开始获取图片文件');
			const file = await ctx.api.getFile(photo.file_id).then(async (response) => {
				const fileUrl = `https://api.telegram.org/file/bot${env.SECRET_TELEGRAM_API_TOKEN}/${response.file_path}`;
				const fileResponse = await fetch(fileUrl);
				return fileResponse.arrayBuffer();
			});
			if (!isJPEGBase64(Buffer.from(file).toString('base64')).isValid) {
				console.error('不是有效的JPEG图片');
				return;
			}
			console.log('准备保存图片到数据库');
			try {
				await env.DB.prepare(
					`
				INSERT OR REPLACE INTO Messages(id, groupId, timeStamp, userName, content, messageId, groupName, topicId) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
				)
					.bind(
						getMessageLink({ groupId: groupId.toString(), messageId, topicId }),
						groupId,
						timeStamp,
						userName,
						'data:image/jpeg;base64,' + Buffer.from(file).toString('base64'),
						messageId,
						groupName,
						topicId
					)
					.run();
				console.log('图片保存成功');
			} catch (e) {
				console.error('图片保存失败:', e);
			}
		});

		// 处理编辑消息
		bot.on('edited_message:text', async (ctx) => {
			console.log('处理编辑消息');
			const msg = ctx.editedMessage;
			const groupId = msg.chat.id;
			const content = msg.text || '';
			const messageId = msg.message_id;
			const groupName = msg.chat.title || 'anonymous';
			const topicId = msg.message_thread_id || null;
			const timeStamp = Date.now();
			const userName = getUserName(msg);
			console.log('准备更新编辑的消息');
			try {
				await env.DB.prepare(
					`
				INSERT OR REPLACE INTO Messages(id, groupId, timeStamp, userName, content, messageId, groupName, topicId) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
				)
					.bind(
						getMessageLink({ groupId: groupId.toString(), messageId, topicId }),
						groupId,
						timeStamp,
						userName,
						content,
						messageId,
						groupName,
						topicId
					)
					.run();
				console.log('编辑消息更新成功');
			} catch (e) {
				console.error('编辑消息更新失败:', e);
			}
		});

		return webhookCallback(bot, 'cloudflare-mod')(request);
	},
};
