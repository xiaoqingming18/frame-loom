import { AudioLines, Film, Group, ImageIcon } from 'lucide-react';
import { CanvasGroupData, CanvasMediaData, migrateCanvasMediaData } from '@frame-loom/contracts';
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
import { AudioNodeView } from './audio-view';

export const audioNode = defineNodeType({
  type: 'audio',
  version: 1,
  label: '音频',
  icon: <AudioLines />,
  category: 'media',
  defaultSize: { width: 320, height: 160 },
  minSize: { width: 240, height: 120 },
  dataSchema: CanvasMediaData,
  createData: () => emptyMedia(),
  inputs: () => [],
  outputs: () => [{ id: 'out', label: '音频', dataType: 'audio' }],
  output(data) {
    const version = activeVersion(data);
    return version ? { kind: 'audio', sha256: version.sha256 } : null;
  },
  View: AudioNodeView,
});

function migrateMedia(data: unknown): CanvasMediaData {
  return CanvasMediaData.parse(migrateCanvasMediaData(data));
}

export const imageNode = defineNodeType({
  type: 'image',
  version: 3,
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
  version: 3,
  label: '视频',
  icon: <Film />,
  category: 'media',
  defaultSize: { width: 384, height: 216 },
  minSize: { width: 200, height: 112 },
  keepAspect: true,
  dataSchema: CanvasMediaData,
  migrate: migrateMedia,
  createData: () => emptyMedia('t2v'),
  inputs: (data) => videoInputs(data),
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
  return new NodeRegistry()
    .register(imageNode)
    .register(videoNode)
    .register(audioNode)
    .register(groupNode);
}
