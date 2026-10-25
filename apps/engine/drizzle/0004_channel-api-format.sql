-- 渠道预设改为 API 格式：按旧预设回填，保持拉取模型列表的路径与鉴权不变。
ALTER TABLE `channels` ADD `api_format` text NOT NULL DEFAULT 'openai-completions';--> statement-breakpoint
UPDATE `channels` SET `api_format` = CASE `preset`
	WHEN 'openai' THEN 'openai-responses'
	WHEN 'anthropic' THEN 'anthropic-messages'
	WHEN 'minimax' THEN 'anthropic-messages'
	WHEN 'gemini' THEN 'google-generative-ai'
	ELSE 'openai-completions'
END;--> statement-breakpoint
ALTER TABLE `channels` DROP COLUMN `preset`;
