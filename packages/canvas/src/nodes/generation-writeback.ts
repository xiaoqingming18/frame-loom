import type { CanvasDocument, CanvasMediaData, GenerationJob } from '@frame-loom/contracts';
import { appendVersion } from './media';

const active = new Set(['pending', 'submitting', 'running', 'downloading']);

export function isActiveGenerationJob(job: GenerationJob) {
  return active.has(job.status);
}

export function writeGenerationJob(document: CanvasDocument, job: GenerationJob) {
  if (!job.outputs.length && !['succeeded', 'cancelled'].includes(job.status)) return document;
  let changed = false;
  const nodes = document.nodes.map((node) => {
    if (!['image', 'video', 'audio'].includes(node.type)) return node;
    const data = node.data as CanvasMediaData;
    if (!data.pendingJobIds?.includes(job.id)) return node;
    let next = data;
    if (['succeeded', 'cancelled'].includes(job.status))
      next = { ...next, pendingJobIds: data.pendingJobIds.filter((id) => id !== job.id) };
    for (const output of job.outputs) {
      if (
        next.versions.some(
          (version) => version.jobId === job.id && version.sha256 === output.sha256,
        )
      )
        continue;
      next = appendVersion(next, { ...output, jobId: job.id });
    }
    if (next === data) return node;
    changed = true;
    return { ...node, data: next };
  });
  return changed ? { ...document, nodes } : document;
}
