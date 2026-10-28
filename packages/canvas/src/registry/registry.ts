import type { ComponentType, ReactNode } from 'react';
import type { z } from 'zod';
import type { CanvasNode, CanvasMediaData } from '@frame-loom/contracts';
import type { CanvasGenerationModel } from '../host';
import { videoInputs } from '../nodes/media';

/** 端口上流动的数据类型；新增节点只需声明自己的输入输出。 */
export type PortDataType = 'image' | 'video' | 'audio' | 'text';

export interface InputPort {
  id: string;
  label: string;
  accepts: readonly PortDataType[];
  /** 该端口最多接受的连线条数。 */
  max: number;
}
export interface OutputPort {
  id: string;
  label: string;
  dataType: PortDataType;
}

export interface NodeViewProps<Data = unknown> {
  node: CanvasNode & { data: Data };
  selected: boolean;
}

export interface NodeTypeDefinition<Data = unknown> {
  type: string;
  version: number;
  label: string;
  icon: ReactNode;
  /** 添加菜单中的分组；不填的类型不出现在添加菜单。 */
  category?: 'media' | 'organize';
  defaultSize: { width: number; height: number };
  minSize: { width: number; height: number };
  keepAspect?: boolean;
  dataSchema: z.ZodType<Data>;
  createData(): Data;
  /** 把旧版本数据迁移到当前版本；未来版本由占位视图保留。 */
  migrate?(data: unknown, fromVersion: number): Data;
  inputs(data: Data): readonly InputPort[];
  outputs(data: Data): readonly OutputPort[];
  /** 节点当前可供下游引用的产物；没有产物时返回 null。 */
  output?(data: Data): { kind: PortDataType; sha256: string } | null;
  /** 节点间不允许连线的类型（如分组）。 */
  connectable?: boolean;
  View: ComponentType<NodeViewProps<Data>>;
}

export class NodeRegistry {
  private readonly types = new Map<string, NodeTypeDefinition>();
  private generationModels: CanvasGenerationModel[] = [];

  setGenerationModels(models: CanvasGenerationModel[]): void {
    this.generationModels = models;
  }

  register<Data>(definition: NodeTypeDefinition<Data>): this {
    if (this.types.has(definition.type)) throw new Error(`节点类型重复注册：${definition.type}`);
    this.types.set(definition.type, definition as unknown as NodeTypeDefinition);
    return this;
  }

  get(type: string): NodeTypeDefinition | undefined {
    return this.types.get(type);
  }

  list(): NodeTypeDefinition[] {
    return [...this.types.values()];
  }

  supports(node: CanvasNode): boolean {
    const definition = this.get(node.type);
    return (
      !!definition &&
      node.typeVersion === definition.version &&
      definition.dataSchema.safeParse(node.data).success
    );
  }

  migrate(node: CanvasNode): CanvasNode {
    const definition = this.get(node.type);
    if (!definition?.migrate || node.typeVersion >= definition.version) return node;
    return {
      ...node,
      typeVersion: definition.version,
      data: definition.dataSchema.parse(definition.migrate(node.data, node.typeVersion)),
    };
  }

  inputs(node: CanvasNode): readonly InputPort[] {
    const definition = this.get(node.type);
    const data = definition?.dataSchema.safeParse(node.data);
    if (
      data?.success &&
      node.typeVersion === definition?.version &&
      (node.type === 'image' || node.type === 'video')
    ) {
      const media = data.data as CanvasMediaData;
      const models = this.generationModels.filter((model) => model.kind === node.type);
      const model = media.modelId ? models.find((model) => model.id === media.modelId) : models[0];
      if (model?.capability.kind === 'video') return videoInputs(media, model.capability);
      if (model?.capability.kind === 'image')
        return model.capability.references.max === 0
          ? []
          : [
              {
                id: 'reference',
                label: '参考图',
                accepts: ['image'],
                max: model.capability.references.max ?? 50,
              },
            ];
    }
    return definition && node.typeVersion === definition.version && data?.success
      ? definition.inputs(data.data)
      : [];
  }

  outputs(node: CanvasNode): readonly OutputPort[] {
    const definition = this.get(node.type);
    const data = definition?.dataSchema.safeParse(node.data);
    return definition && node.typeVersion === definition.version && data?.success
      ? definition.outputs(data.data)
      : [];
  }
}

export function defineNodeType<Data>(
  definition: NodeTypeDefinition<Data>,
): NodeTypeDefinition<Data> {
  return definition;
}
