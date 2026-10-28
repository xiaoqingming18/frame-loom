# 协议契约样例

以下样例按官方文档中的请求与响应结构构造，模型 ID 使用任意别名、产物地址替换为本机地址、图片替换为 1 × 1 PNG；不是付费调用录制。测试只使用本地模拟上游。核对日期为 2026-10-29。

| 协议             | 官方来源                                                                                                                                                                | 样例与模板依据                                                                                              |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| openai-images    | https://developers.openai.com/api/docs/guides/image-generation.md                                                                                                       | Image API 生成、参考图编辑与 alpha 蒙版；GPT Image 2.5 Sunburst／Flare 质量和像素范围                       |
| ark-seedream     | https://ark.volcengine.com/region:cn-beijing/docs/image-generation-api                                                                                                  | Seedream 5.0 lite 的单图模式、14 张参考图、2K／3K／4K 查表；5.0 pro／flash 的范围不同，模板不混用           |
| gemini-generate  | https://ai.google.dev/gemini-api/docs/image-generation                                                                                                                  | generateContent 的 contents、inlineData、generationConfig；Gemini 3.1 Flash Image 模板，不使用 Interactions |
| ark-seedance     | https://ark.volcengine.com/region:cn-beijing/docs/create-video-generation-task-api 、https://ark.volcengine.com/region:cn-beijing/docs/get-video-generation-task-api.md | Seedance 2.5 角色素材、声音与任务状态                                                                       |
| dashscope-wan    | https://www.alibabacloud.com/help/en/model-studio/wan3-video-generation-api-reference                                                                                   | Wan 3.0 的 input.media、parameters、异步头与 output.task_status                                             |
| minimax-video-v2 | https://platform.minimax.io/docs/api-reference/video-generation-v2-create 、https://platform.minimax.io/docs/api-reference/video-generation-v2-query                    | MiniMax-H3 的 content、ratio、外层 task_id 与 task.content.url                                              |
| kling-omni       | https://kling.ai/document-api/api/video/4-0/video-omni.md                                                                                                               | Kling 4.0 的 contents、settings、options 与查询 data[].outputs                                              |
| openai-videos    | https://developers.openai.com/api/docs/guides/video-generation.md 、https://openrouter.ai/docs/guides/overview/multimodal/video-generation                              | Sora 2／Pro 历史 multipart 与 content 格式；OpenRouter 当前 JSON 格式不同，未混用                           |
| newapi-video     | https://doc.newapi.pro/api/generate-video/ 、https://docs.newapi.ai/zh/docs/api/ai-model/videos/getvideogeneration                                                      | 统一视频请求、metadata 与两套状态；不猜测厂商型号参数范围                                                   |

`reference.mp4` 沿用本地 FFmpeg `testsrc2` 生成的 2 秒、320 × 256、24fps H.264 素材，仅供测试。

编辑规则于 2026-10-29 再核对上述官方正文：Seedance 的 edit／extend 均要求 adaptive 比例，仅 edit 要求 duration=-1，待编辑素材至少 4 秒；Kling 确认最多一个 base_video，未声明 extend。`video.test.ts` 覆盖请求翻译；桌面 `video-edit.test.ts` 将本地素材时钟放慢为 6 秒，覆盖编辑与续写写回，不访问真实服务。

语音和文本样例在 `tts.test.ts`、`llm-protocols.test.ts` 中按以下结构构造；PCM 为本地静音字节，不是服务商录音。

| 协议                | 官方来源                                                                                                                             | 样例与模板依据                                                                  |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| openai-chat         | https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create                                   | Chat Completions SSE、usage；默认不发送采样参数                                 |
| openai-responses    | https://developers.openai.com/api/reference/resources/responses/methods/create                                                       | response 事件、输出文本和 usage                                                 |
| anthropic-messages  | https://platform.claude.com/docs/en/api/messages                                                                                     | message/content_block 事件；默认不发 temperature/top_p/top_k                    |
| openai-speech       | https://developers.openai.com/api/docs/guides/text-to-speech.md                                                                      | 13 个预置音色、二进制响应、PCM 24kHz；官方将于 2027-01-06 停服                  |
| minimax-t2a         | https://platform.minimax.io/docs/api-reference/speech-t2a-http 、https://platform.minimax.io/docs/api-reference/voice-management-get | hex 音频、voice_setting、audio_setting、三类音色目录                            |
| elevenlabs          | https://elevenlabs.io/docs/api-reference/text-to-speech/convert.mdx 、https://elevenlabs.io/docs/api-reference/voices/search         | v1 合成与 v2 分页目录；采样率包含在输出格式编码中；未确认语速上下限，模板不填写 |
| gemini-generate TTS | https://ai.google.dev/gemini-api/docs/speech-generation 、https://ai.google.dev/api/generate-content                                 | 单／双说话人、30 个预置音色；兼容早期 raw PCM 与新版 WAV，按 MIME 处理          |
