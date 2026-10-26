# Plan: 项目资产接口

Status: done
Parent: plan.md

## 目标

engine 提供项目资产接口，所有路径基于项目根目录并经过统一的路径解析函数（规范化、拒绝 `..`／绝对路径／盘符／`\0`／设备名／`.frameloom`、`realpath` 仍在根内、逐段 `lstat` 拒绝符号链接与 junction）：

- `GET /projects/:id/assets?path=`、`GET /projects/:id/assets/search?q=`（全项目、最多 500 条、`truncated` 标记）。
- `POST /projects/:id/assets/folders`、`POST /projects/:id/assets/files?path=&name=`（4 GiB、`statfs` 检查剩余空间、同名「名称 (2).ext」递增）、`PATCH /projects/:id/assets`（重命名）、`POST /projects/:id/assets/move`。
- `POST /projects/:id/media/from-asset`（图片与视频）与 `POST /projects/:id/assets/from-media`（同名自动改名）。
- `GET /projects/:id/files/media/:sha256` 与 `GET /projects/:id/files/assets?path=`：`sendFile` 支持 Range，设置 `nosniff`，只对图片、视频、音频返回内联 MIME，其余为 `application/octet-stream` 加 `Content-Disposition: attachment`。

## 前置条件

- 02 完成。

## 步骤

- [x] T1 实现路径解析函数 — 验证：集成测试覆盖 `..`、解码后的 `%2e%2e`、混写 `.FrameLoom`、真实 junction；符号链接无 Windows 权限时注入 lstat，8.3 解析边界注入 realpath
- [x] T2 实现列目录与搜索 — 验证：`.frameloom` 隐藏、链接跳过、注入无权限目录跳过、501 条匹配时返回 500 条且 `truncated`
- [x] T3 实现新建文件夹、上传、重命名、移动 — 验证：同名冲突／递增、重命名／移动、移入自身、流式计数超过 4 GiB、注入空间不足、中断与取消后无临时残留
- [x] T4 实现资产与媒体互转 — 验证：非媒体拒绝、同名导出递增、导出字节一致
- [x] T5 实现文件读取接口 — 验证：Range 206／416、HTML 附件与 octet-stream、nosniff、未授权 401、缺失资产 404

## 验证

- 预期：`pnpm --filter @frame-loom/engine test`、`pnpm --filter @frame-loom/engine typecheck` 通过。
- 实际：全仓 `pnpm test` 598 项通过（engine 186 项），`pnpm typecheck`、`pnpm lint` 通过。新增 `project-content.integration.test.ts` 共 9 项，覆盖媒体与资产；真实测试临时目录位于 Windows NTFS。
- 收尾：`pnpm format:check`、`pnpm run verify` 通过（21 篇笔记、44 份计划）；文件错误响应补丁后再次通过上述 9 项集成测试、engine typecheck 与 lint。

## 进度

- 2026-10-26：创建子计划草稿。
- 2026-10-26：完成 T1–T5、鉴权流式接口和文件读取，完成全仓回归；尚未提交。

## 发现与偏差

- 资产上传与文件移动使用同卷硬链接发布完整文件并移除旧链接，防止覆盖外部并发创建的同名文件；目录移动仍 rename。需要支持硬链接的本地磁盘，理由和代价见父计划关联笔记。
- junction 使用 Node `symlink(..., 'junction')` 创建。8.3 与无权限边界采用注入验证，未验证真实短名、非 NTFS／网络盘与断电恢复。

## 交接

无。
