# Plan: 项目资产接口

Status: draft
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

- [ ] T1 实现路径解析函数 — 验证：单测覆盖 `..`、`%2e%2e` 解码后、大小写混写的 `.FrameLoom`、junction（`mklink /J` 在临时目录创建）、符号链接、8.3 短名指向根外
- [ ] T2 实现列目录与搜索 — 验证：集成测试中 `.frameloom` 不出现、链接被跳过、无权限目录被跳过、超过 500 条时 `truncated`
- [ ] T3 实现新建文件夹、上传、重命名、移动 — 验证：集成测试覆盖同名报错、上传同名递增、超过 4 GiB（流式计数，不真实写满）与剩余空间不足（注入 `statfs`）、移入自身被拒绝、中断上传后临时文件被清除
- [ ] T4 实现资产与媒体互转 — 验证：集成测试覆盖非媒体文件拒绝导入、导出同名自动改名、导出后文件哈希一致
- [ ] T5 实现文件读取接口 — 验证：集成测试覆盖 Range 206、`.html` 返回 attachment、未授权 401

## 验证

- 预期：`pnpm --filter @frame-loom/engine test`、`pnpm --filter @frame-loom/engine typecheck` 通过。
- 实际：未执行。

## 进度

- 2026-10-26：创建子计划草稿。

## 发现与偏差

无。

## 交接

尚未开始；等待 02。
