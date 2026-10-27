import type { CanvasDocument, CanvasMediaData, GenerationJob } from '@frame-loom/contracts';
import { appendVersion } from './media';

const active = new Set(['pending', 'submitting', 'running', 'downloading']);

export function isActiveGenerationJob(job: GenerationJob) {
  return active.has(job.status);
}

export function writeGenerationJob(document: CanvasDocument, job: GenerationJob) {
  if (
    isActiveGenerationJob(job) ||
    ['submit_unknown', 'failed', 'paused', 'download_failed'].includes(job.status)
  )
    return document;
  let changed = false;
  const nodes = document.nodes.map((node) => {
    if (node.type !== 'image' && node.type !== 'video') return node;
    const data = node.data as CanvasMediaData;
    if (!data.pendingJobIds?.includes(job.id)) return node;
    changed = true;
    const rest = { ...data };
    rest.pendingJobIds = data.pendingJobIds.filter((id) => id !== job.id);
    const output = job.outputs[0];
    if (
      job.status !== 'succeeded' ||
      !output ||
      data.versions.some((version) => version.jobId === job.id)
    )
      return { ...node, data: rest };
    return {
      ...node,
      data: appendVersion(rest, {
        sha256: output.sha256,
        mime: output.mime,
        width: output.width,
        height: output.height,
        ...(output.durationMs == null ? {} : { durationMs: output.durationMs }),
        jobId: job.id,
        createdAt: output.createdAt,
      }),
    };
  });
  return changed ? { ...document, nodes } : document;
}
