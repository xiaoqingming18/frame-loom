import type {
  EditableScriptDocument as ScriptDocument,
  ScriptSaveResult,
} from '@frame-loom/contracts';
import { EngineRequestError } from '@/lib/engine-client';

type Snapshot = {
  generation: number;
  document: ScriptDocument;
  status: 'saved' | 'saving' | 'error' | 'conflict' | 'converting';
  message?: string;
};
export function createScriptPersistence(
  initial: { revision: number; document: ScriptDocument },
  save: (revision: number, document: ScriptDocument) => Promise<ScriptSaveResult>,
  onSaved: (result: ScriptSaveResult, document: ScriptDocument) => void,
) {
  let revision = initial.revision;
  let snapshot: Snapshot = { document: initial.document, status: 'saved', generation: 0 };
  let saved = initial.document;
  let pending: Promise<boolean> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Set<() => void>();
  let composing = false;
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
        if (composing) return false;
        const document = snapshot.document;
        update({ status: 'saving', message: undefined });
        const result = await save(revision, document);
        revision = result.revision;
        saved = document;
        onSaved(result, document);
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
    if (composing) return Promise.resolve(false);
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
    setComposing(value: boolean) {
      composing = value;
      clearTimeout(timer);
      if (!value && saved !== snapshot.document) timer = setTimeout(() => void flush(), 1000);
    },
    hasPendingChanges: () => saved !== snapshot.document || !!pending,
    change(document: ScriptDocument) {
      update({ document });
      clearTimeout(timer);
      if (!composing && !['conflict', 'converting'].includes(snapshot.status))
        timer = setTimeout(() => {
          void flush();
        }, 1000);
    },
    reset(record: { revision: number; document: ScriptDocument }) {
      clearTimeout(timer);
      revision = record.revision;
      saved = record.document;
      update({
        document: record.document,
        status: 'saved',
        message: undefined,
        generation: snapshot.generation + 1,
      });
    },
    stop() {
      clearTimeout(timer);
    },
    fail,
    flush,
  };
}
