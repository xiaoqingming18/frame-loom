import type { ModelConnection, ModelProfile } from '@frame-loom/contracts';

/** 旧任务的协议默认值集中在兼容边界；新接入必须显式冻结运行声明。 */
export function executionContract(connection: ModelConnection | undefined, profile: ModelProfile) {
  return (
    connection?.runtime ?? {
      upload:
        profile.protocol === 'fastaitoken-video'
          ? ('provider-file' as const)
          : profile.protocol === 'openai-videos'
            ? ('file' as const)
            : ('inline' as const),
      idempotency: profile.protocol === 'fastaitoken-video',
      cancel: false,
      concurrency: 2,
      downloadAuth: 'content' as const,
      uploadReuseMs: 3_600_000,
    }
  );
}
