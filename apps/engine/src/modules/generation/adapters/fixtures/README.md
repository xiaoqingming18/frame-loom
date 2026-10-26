# 生成协议样例

这些是按公开协议构造的脱敏模拟响应，用于固定解析行为；不是实际付费调用的录制结果。真实供应商核对与冒烟由 05 完成。PNG 为 1 × 1 测试素材，示例 URL 不指向真实供应商。

图片 JSON 的 `requestCases` 固定语义参数到供应商请求字段的映射，适配器测试同时断言未知参数不外传；OpenAI 同样验证 multipart edits。`ark-images.json` 的 `jpegBase64` 是 Pillow 本地生成的 1 × 1 白色 JPEG，集成测试通过本地 HTTP 下载该固件，核对 MIME、扩展名与落盘字节。图片节点整体验收及真实供应商冒烟由各自计划持有。

视频任务响应直接构造在 `video-tasks.test.ts` 中，覆盖提交、排队、运行、成功、失败、审核拒绝和 429；`video.integration.test.ts` 的本地 HTTP 服务覆盖 S3 素材管线和过期产物链接重新查询。

`reference.mp4` 是本地生成的 2 秒、320 × 256、24 fps、H.264 测试视频，使用本机 FFmpeg 的 `testsrc2` 输入和 `-movflags +faststart` 生成，仅用于适配器与媒体播放测试，不作为产品运行时依赖。
