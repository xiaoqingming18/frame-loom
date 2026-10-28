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
