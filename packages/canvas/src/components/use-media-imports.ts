import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CanvasMediaData, CanvasNode } from '@frame-loom/contracts';
import { addNodes, createNode, type Point } from '../commands/commands';
import { useCanvas } from '../context';
import { importMedia, mediaKind } from '../interaction/media-import';
import { fitMediaSize } from '../nodes/media';

export interface MediaImportTask {
  node: CanvasNode;
  file: Blob;
  error: string | null;
}

/** 上传状态只活在组件内，成功后才形成一次可撤销的文档编辑。 */
export function useMediaImports() {
  const { host, registry, store } = useCanvas();
  const [tasks, setTasks] = useState<MediaImportTask[]>([]);
  const controllers = useRef(new Map<string, AbortController>());
  useEffect(() => {
    const active = controllers.current;
    return () => {
      for (const controller of active.values()) controller.abort();
      active.clear();
    };
  }, []);
  const run = useCallback(
    async (task: MediaImportTask) => {
      const { node, file } = task;
      if (controllers.current.has(node.id)) return;
      const controller = new AbortController();
      controllers.current.set(node.id, controller);
      setTasks((current) =>
        current.map((item) => (item.node.id === node.id ? { ...item, error: null } : item)),
      );
      try {
        const { version } = await importMedia(host, file, controller.signal);
        if (controller.signal.aborted) return;
        const definition = registry.get(node.type)!;
        const size = fitMediaSize(version.width, version.height, definition.defaultSize);
        const ready = {
          ...node,
          size,
          data: { ...(node.data as CanvasMediaData), versions: [version], activeVersion: 0 },
        };
        if (!store.getState().apply((document) => addNodes(document, [ready])))
          throw new Error(store.getState().notice?.text ?? '画布无法添加节点');
        store.getState().select([node.id]);
        setTasks((current) => current.filter((item) => item.node.id !== node.id));
      } catch (error) {
        if (controller.signal.aborted) return;
        const message = error instanceof Error ? error.message : '上传失败';
        setTasks((current) =>
          current.map((item) => (item.node.id === node.id ? { ...item, error: message } : item)),
        );
        store.getState().notify(`导入失败：${message}`);
      } finally {
        if (controllers.current.get(node.id) === controller) controllers.current.delete(node.id);
      }
    },
    [host, registry, store],
  );
  const start = useCallback(
    (files: Blob[], at: Point) => {
      const supported = files.filter((file) => mediaKind(file));
      if (supported.length < files.length)
        store.getState().notify('已忽略不支持的文件，只支持 PNG、JPEG、WebP 图片和 MP4、MOV 视频');
      let x = at.x;
      const added = supported.map((file) => {
        const node = createNode(registry, mediaKind(file)!, { x, y: at.y });
        if (file instanceof File && file.name) node.title = file.name.slice(0, 200);
        x += node.size.width + 40;
        return { node, file, error: null };
      });
      setTasks((current) => [...current, ...added]);
      for (const task of added) void run(task);
    },
    [registry, run, store],
  );
  const cancel = useCallback((id: string) => {
    controllers.current.get(id)?.abort();
    controllers.current.delete(id);
    setTasks((current) => current.filter((task) => task.node.id !== id));
  }, []);
  const retry = useCallback(
    (id: string) => {
      const task = tasks.find((item) => item.node.id === id);
      if (task?.error) void run(task);
    },
    [run, tasks],
  );
  return useMemo(() => ({ tasks, start, cancel, retry }), [tasks, start, cancel, retry]);
}
