import type { ScriptDocument, ScriptSaveResult } from '@frame-loom/contracts';
import { EngineRequestError } from '@/lib/engine-client';

type Snapshot = {
  document: ScriptDocument;
  status: 'saved' | 'saving' | 'error' | 'conflict' | 'converting';
  message?: string;
};
export function createScriptPersistence(
  initial: { revision: number; document: ScriptDocument },
  save: (revision: number, document: ScriptDocument) => Promise<ScriptSaveResult>,
  onSaved: (result: ScriptSaveResult) => void,
) {
  let revision = initial.revision;
  let snapshot: Snapshot = { document: initial.document, status: 'saved' };
  let saved = initial.document;
  let pending: Promise<boolean> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Set<() => void>();
  function update(patch: Partial<Snapshot>) {
    snapshot = { ...snapshot, ...patch };
    listeners.forEach((listener) => listener());
  }
  function fail(error: unknown) {
    update({
      status:
        error instanceof EngineRequestError && error.code === 'SCRIPT_REVISION_CONFLICT'
          ? 'conflict'
          : error instanceof EngineRequestError && error.code === 'SCRIPT_CONVERTING'
            ? 'converting'
            : 'error',
      message: error instanceof Error ? error.message : '保存失败',
    });
  }
  async function run() {
    try {
      while (saved !== snapshot.document) {
        const document = snapshot.document;
        update({ status: 'saving', message: undefined });
        const result = await save(revision, document);
        revision = result.revision;
        saved = document;
        onSaved(result);
      }
      update({ status: 'saved', message: undefined });
      return true;
    } catch (error) {
      fail(error);
      return false;
    }
  }
  function flush(): Promise<boolean> {
    clearTimeout(timer);
    if (pending) return pending;
    if (snapshot.status === 'conflict' || snapshot.status === 'converting')
      return Promise.resolve(false);
    if (saved === snapshot.document) return Promise.resolve(true);
    pending = run().finally(() => {
      pending = undefined;
    });
    return pending;
  }
  return {
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
    getRevision: () => revision,
    hasPendingChanges: () => saved !== snapshot.document || !!pending,
    change(document: ScriptDocument) {
      update({ document });
      clearTimeout(timer);
      if (!['conflict', 'converting'].includes(snapshot.status))
        timer = setTimeout(() => {
          void flush();
        }, 1000);
    },
    reset(record: { revision: number; document: ScriptDocument }) {
      clearTimeout(timer);
      revision = record.revision;
      saved = record.document;
      update({ document: record.document, status: 'saved', message: undefined });
    },
    stop() {
      clearTimeout(timer);
    },
    fail,
    flush,
  };
}
