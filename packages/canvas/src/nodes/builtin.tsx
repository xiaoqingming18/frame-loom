import { Film, Group, ImageIcon } from 'lucide-react';
import { CanvasGroupData, CanvasMediaData } from '@frame-loom/contracts';
import { defineNodeType, NodeRegistry } from '../registry/registry';
import {
  activeVersion,
  emptyMedia,
  imageInputs,
  imageOutputs,
  videoInputs,
  videoOutputs,
} from './media';
import { GroupNodeView, ImageNodeView, VideoNodeView } from './views';

function migrateMedia(data: unknown): CanvasMediaData {
  const { pendingJobId, ...rest } = CanvasMediaData.parse(data);
  return pendingJobId && !rest.pendingJobIds ? { ...rest, pendingJobIds: [pendingJobId] } : rest;
}

export const imageNode = defineNodeType({
  type: 'image',
  version: 2,
  label: '图片',
  icon: <ImageIcon />,
  category: 'media',
  defaultSize: { width: 280, height: 280 },
  minSize: { width: 120, height: 80 },
  keepAspect: true,
  dataSchema: CanvasMediaData,
  migrate: migrateMedia,
  createData: () => emptyMedia(),
  inputs: () => imageInputs,
  outputs: () => imageOutputs,
  output(data) {
    const version = activeVersion(data);
    return version ? { kind: 'image', sha256: version.sha256 } : null;
  },
  View: ImageNodeView,
});

export const videoNode = defineNodeType({
  type: 'video',
  version: 2,
  label: '视频',
  icon: <Film />,
  category: 'media',
  defaultSize: { width: 384, height: 216 },
  minSize: { width: 200, height: 112 },
  keepAspect: true,
  dataSchema: CanvasMediaData,
  migrate: migrateMedia,
  createData: () => emptyMedia('text'),
  inputs: (data) => videoInputs(data.mode),
  outputs: () => videoOutputs,
  output(data) {
    const version = activeVersion(data);
    return version ? { kind: 'video', sha256: version.sha256 } : null;
  },
  View: VideoNodeView,
});

export const groupNode = defineNodeType<CanvasGroupData>({
  type: 'group',
  version: 1,
  label: '分组',
  icon: <Group />,
  defaultSize: { width: 400, height: 300 },
  minSize: { width: 160, height: 100 },
  dataSchema: CanvasGroupData,
  createData: () => ({ color: 'gray' }),
  inputs: () => [],
  outputs: () => [],
  connectable: false,
  View: GroupNodeView,
});

export function createBuiltinRegistry(): NodeRegistry {
  return new NodeRegistry().register(imageNode).register(videoNode).register(groupNode);
}
