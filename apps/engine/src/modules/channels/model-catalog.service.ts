import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { createHash, randomUUID } from 'node:crypto';
import {
  ModelImportPackage,
  ModelProfile,
  ModelConnection,
  LlmProtocol,
  serviceRoutes,
  ModelOverrides,
  checkGenerationRequest,
  type ChannelModelWrite,
  type ModelDefinition,
  type ServiceConnectionDefinition,
} from '@frame-loom/contracts';
import { DatabaseService } from '../../core/database/database.service.js';
import { DomainError } from '../../core/http/domain-error.js';
import { mediaProfiles, executionProfile } from '../generation/profiles/media-profiles.js';
import { modelCatalog, channelModels, channels, modelDefaults } from './channels.schema.js';
import { isPublicAddress } from '../generation/public-reference.js';
import { isIP } from 'node:net';

const videoIds: Record<string, string> = {
  'doubao-seedance-2-5-260628': 'seedance-2.5',
  'doubao-seedance-2-0-260128': 'seedance-2.0',
  'doubao-seedance-2-0-fast-260128': 'seedance-2.0-fast',
  'kling-v4': 'kling-4.0',
  'kling-v3': 'kling-3.0',
  'wan-3.0': 'wan-3.0',
  'minimax-h3': 'minimax-h3',
};
const builtins = (): ModelImportPackage =>
  ModelImportPackage.parse({
    schema: 'frame-loom.model-package',
    schemaVersion: 1,
    source: 'Frame Loom v1',
    definitions: [
      ...LlmProtocol.options.map((protocol) => ({
        id: protocol,
        version: 'v1',
        name: `文本 · ${protocol}`,
        kind: 'chat',
        protocol,
        capabilityVersion: 'v1',
        operations: [{ id: 'submit', status: 'supported' }],
      })),
      ...mediaProfiles
        .filter((profile) => profile.kind !== 'video' || videoIds[profile.id])
        .map((profile) => ({
          id: videoIds[profile.id] ?? profile.id,
          version: 'v1',
          name: profile.name,
          kind: profile.kind,
          protocol: profile.protocol,
          aliases: profile.matchIds,
          capabilityVersion: 'v1',
          operations: Object.keys(serviceRoutes[profile.protocol] ?? { submit: '' }).map((id) => ({
            id,
            status: 'supported',
          })),
          profile,
        })),
    ],
    connections: [
      ...new Set([...LlmProtocol.options, ...mediaProfiles.map((profile) => profile.protocol)]),
    ].map((protocol) => ({
      id: protocol,
      version: 'v1',
      name: protocol,
      protocol,
      routes: serviceRoutes[protocol] ?? {},
      operations: Object.keys(serviceRoutes[protocol] ?? { submit: '' }),
      capabilities: {
        upload:
          protocol === 'fastaitoken-video'
            ? 'provider-file'
            : protocol === 'openai-videos'
              ? 'file'
              : 'inline',
        idempotency: protocol === 'fastaitoken-video',
        cancel: false,
      },
    })),
  });

@Injectable()
export class ModelCatalogService {
  constructor(private readonly database: DatabaseService) {}
  get() {
    return (
      this.database.db.select().from(modelCatalog).where(eq(modelCatalog.id, 'catalog')).get()
        ?.package ?? builtins()
    );
  }
  revision(value = this.get()) {
    return createHash('sha256')
      .update(
        JSON.stringify([
          value,
          this.database.db.select().from(channelModels).all(),
          this.database.db
            .select({ id: channels.id, updatedAt: channels.updatedAt })
            .from(channels)
            .all(),
        ]),
      )
      .digest('hex');
  }
  private validateDefinition(definition: ModelDefinition) {
    if (
      definition.operations.some(
        (operation) => operation.input && Object.keys(operation.input).length,
      )
    )
      throw new DomainError(
        'UNSUPPORTED_IMPORT',
        422,
        `模型 ${definition.id} 包含尚未执行的操作输入映射`,
      );
    if (definition.version !== 'v1' || definition.capabilityVersion !== 'v1')
      throw new DomainError(
        'UNSUPPORTED_VERSION',
        422,
        `模型 ${definition.id} 的定义或能力版本不受支持`,
      );
    if (definition.kind === 'chat') {
      LlmProtocol.parse(definition.protocol);
      if (Object.keys(definition.profile).length)
        throw new DomainError(
          'INVALID_CAPABILITY',
          422,
          '文本能力通过模型限制设置，定义不能包含未执行的字段',
        );
    } else {
      const profile = executionProfile(ModelProfile.parse(definition.profile));
      if (profile.kind !== definition.kind || profile.protocol !== definition.protocol)
        throw new DomainError('INVALID_DEFINITION', 422, '模型定义类别与执行能力不一致');
      const supported = mediaProfiles.filter((item) => item.protocol === profile.protocol);
      if (
        profile.params.some(
          (param) =>
            !supported.some((item) => item.params.some((candidate) => candidate.key === param.key)),
        ) ||
        profile.modes.some(
          (mode) =>
            !supported.some((item) => item.modes.some((candidate) => candidate.id === mode.id)),
        )
      )
        throw new DomainError(
          'INVALID_CAPABILITY',
          422,
          `模型 ${definition.id} 声明了适配器不支持的参数或模式`,
        );
      const base = supported.find(
        (item) =>
          profile.modes.every((mode) =>
            item.modes.some(
              (entry) =>
                entry.id === mode.id &&
                (entry.requiredRoles ?? []).every((role) => mode.requiredRoles?.includes(role)),
            ),
          ) &&
          (profile.promptMaxLength ?? 32000) <= (item.promptMaxLength ?? 32000) &&
          (!item.promptMaxBytes ||
            (!!profile.promptMaxBytes && profile.promptMaxBytes <= item.promptMaxBytes)) &&
          (!profile.audioParam || profile.audioParam === item.audioParam) &&
          (!['fixed-on', 'fixed-off'].includes(item.audioOutput ?? '') ||
            profile.audioOutput === item.audioOutput) &&
          profile.params.every((param) =>
            item.params.some(
              (entry) =>
                entry.key === param.key &&
                entry.type === param.type &&
                (!entry.values ||
                  !!param.values?.every((value) => entry.values!.includes(value))) &&
                (entry.min === undefined || (param.min !== undefined && param.min >= entry.min)) &&
                (entry.max === undefined || (param.max !== undefined && param.max <= entry.max)),
            ),
          ) &&
          item.params.every((param) => profile.params.some((entry) => entry.key === param.key)) &&
          item.constraints.every((rule) =>
            profile.constraints.some((entry) => JSON.stringify(entry) === JSON.stringify(rule)),
          ) &&
          profile.inputs.every((limit) =>
            item.inputs.some(
              (entry) =>
                entry.kind === limit.kind &&
                entry.transport === limit.transport &&
                limit.maxCount <= entry.maxCount &&
                limit.maxBytes <= entry.maxBytes &&
                limit.mimeTypes.every((mime) => entry.mimeTypes.includes(mime)) &&
                Object.entries(entry).every(([key, bound]) => {
                  if (typeof bound !== 'number' || ['maxCount', 'maxBytes'].includes(key))
                    return true;
                  const actual = limit[key as keyof typeof limit];
                  return (
                    typeof actual === 'number' &&
                    (key.startsWith('min') ? actual >= bound : actual <= bound)
                  );
                }) &&
                (!entry.codecs ||
                  !!limit.codecs?.every((codec) => entry.codecs!.includes(codec))) &&
                (!entry.audioCodecs ||
                  !!limit.audioCodecs?.every((codec) => entry.audioCodecs!.includes(codec))),
            ),
          ),
      );
      if (
        !base ||
        new Set(profile.params.map((param) => param.key)).size !== profile.params.length ||
        profile.runtime.concurrency > base.runtime.concurrency ||
        profile.params.some((param) =>
          checkGenerationRequest(profile, {
            modelId: '00000000-0000-4000-8000-000000000000',
            mode: profile.modes[0].id,
            prompt: '校验',
            params: { [param.key]: param.default },
            inputs: [],
            source: 'manual',
          }).some((issue) => issue.field === param.key),
        )
      )
        throw new DomainError(
          'INVALID_CAPABILITY',
          422,
          `模型 ${definition.id} 的能力超出执行器边界或默认参数无效`,
        );
    }
    if (!definition.operations.some((op) => op.id === 'submit' && op.status === 'supported'))
      throw new DomainError('INVALID_DEFINITION', 422, '模型尚无可执行的提交操作');
  }
  resolve(input: ChannelModelWrite, catalog = this.get()): ChannelModelWrite {
    if (!input.definitionId && !input.connectionId) return input;
    const definition = catalog.definitions.find((item) => item.id === input.definitionId);
    const connection = catalog.connections.find((item) => item.id === input.connectionId);
    if (!definition || !connection || definition.protocol !== connection.protocol)
      throw new DomainError('INVALID_BINDING', 422, '模型定义或接入不存在，或协议不匹配');
    this.validateDefinition(definition);
    if (!connection.operations.includes('submit'))
      throw new DomainError('INVALID_BINDING', 422, '接入未声明提交能力');
    const profile = definition.kind === 'chat' ? undefined : ModelProfile.parse(definition.profile);
    const operations = new Set(
      definition.operations.filter((item) => item.status === 'supported').map((item) => item.id),
    );
    const required = Object.keys(serviceRoutes[connection.protocol] ?? { submit: '' }).filter(
      (operation) => !['upload', 'catalog'].includes(operation),
    );
    if (
      required.some(
        (operation) =>
          !operations.has(operation) ||
          !connection.operations.includes(operation as (typeof connection.operations)[number]),
      )
    )
      throw new DomainError('INVALID_BINDING', 422, '模型与接入缺少执行器所需操作');
    if (
      (input.overrides.concurrency ?? 1) >
      Math.min(connection.runtime?.concurrency ?? 2, profile?.runtime.concurrency ?? 16)
    )
      throw new DomainError('INVALID_CAPABILITY', 422, '模型不能提高接入并发额度');
    return {
      ...input,
      kind: definition.kind,
      protocol: definition.protocol,
      profileId: definition.kind === 'chat' ? null : ModelProfile.parse(definition.profile).id,
      connection: this.connection(connection),
    };
  }
  connection(value: ServiceConnectionDefinition): ModelConnection {
    return ModelConnection.parse({
      contractVersion: 'v1',
      baseUrl: value.baseUrl,
      routes: value.routes,
      credentialRef: value.credentialRef,
      runtime: value.runtime ?? {
        ...value.capabilities,
        concurrency: 2,
        downloadAuth: 'content',
        uploadReuseMs: 3_600_000,
      },
    });
  }
  profile(input: ChannelModelWrite) {
    if (!input.definitionId) return undefined;
    const resolved = this.resolve(input);
    const definition = this.get().definitions.find((item) => item.id === input.definitionId)!;
    return resolved.kind === 'chat'
      ? undefined
      : executionProfile(ModelProfile.parse(definition.profile));
  }
  preview(raw: unknown) {
    const incoming = ModelImportPackage.parse(raw);
    if (incoming.requires.some((item) => item.name !== 'frame-loom' || item.version !== 'v1'))
      throw new DomainError('UNSUPPORTED_DEPENDENCY', 422, '存在未知或不支持的依赖版本');
    if (Object.keys(incoming.mappings).length)
      throw new DomainError(
        'UNSUPPORTED_IMPORT',
        422,
        '当前适配器尚不执行自定义字段映射，不能导入未生效的映射',
      );
    const current = this.get();
    const conflicts: string[] = [];
    const merge = <T extends { id: string }>(old: T[], next: T[]) => {
      if (new Set(next.map((item) => item.id)).size !== next.length)
        throw new DomainError('DUPLICATE_DEFINITION', 422, '导入包包含重复标识');
      const result = new Map(old.map((item) => [item.id, item]));
      for (const item of next) {
        if (result.has(item.id) && JSON.stringify(result.get(item.id)) !== JSON.stringify(item))
          conflicts.push(item.id);
        result.set(item.id, item);
      }
      return [...result.values()];
    };
    for (const definition of incoming.definitions) {
      this.validateDefinition(definition);
      const previous = current.definitions.find((item) => item.id === definition.id);
      if (
        previous &&
        (previous.kind !== definition.kind || previous.protocol !== definition.protocol)
      )
        throw new DomainError(
          'INVALID_DEFINITION',
          422,
          `模型 ${definition.id} 改变类别或协议时必须使用新标识`,
        );
    }
    for (const connection of incoming.connections) {
      if (connection.version !== 'v1' || connection.auth !== 'bearer')
        throw new DomainError('UNSUPPORTED_CONNECTION', 422, '接入须使用 v1 和渠道凭据鉴权');
      if (
        connection.credentialRef &&
        !this.database.db
          .select()
          .from(channels)
          .where(eq(channels.id, connection.credentialRef))
          .get()
      )
        throw new DomainError('CHANNEL_NOT_FOUND', 422, '凭据引用必须是本机已有渠道 ID');
      if (
        Object.keys(connection.routes).some(
          (key) =>
            !['submit', 'edit', 'query', 'content', 'upload', 'catalog', 'cancel'].includes(key),
        )
      )
        throw new DomainError('INVALID_CONNECTION', 422, '接入包含未知操作路径');
      if (connection.baseUrl) {
        const hostname = new URL(connection.baseUrl).hostname.replace(/^\[|\]$/g, '');
        if (
          hostname === 'localhost' ||
          hostname.endsWith('.localhost') ||
          (isIP(hostname) && !isPublicAddress(hostname))
        )
          throw new DomainError('INVALID_TARGET', 422, '导入服务地址不能是内网目标');
      }
      this.connection(connection);
      const upload = connection.runtime?.upload ?? connection.capabilities.upload;
      if (
        (upload === 'file' && connection.protocol !== 'openai-videos') ||
        (['url', 'provider-file'].includes(upload) &&
          ![
            'ark-video-tasks',
            'minimax-video-v2',
            'fastaitoken-video',
            'kling-video',
            'wan-video',
          ].includes(connection.protocol))
      )
        throw new DomainError('INVALID_CONNECTION', 422, '该协议不支持声明的素材交付方式');
      if (
        upload === 'provider-file' &&
        (!connection.operations.includes('upload') || !connection.routes.upload)
      )
        throw new DomainError('INVALID_CONNECTION', 422, '供应商文件交付必须声明上传操作和路径');
      const routes = { ...serviceRoutes[connection.protocol], ...connection.routes };
      if (connection.operations.some((operation) => operation !== 'submit' && !routes[operation]))
        throw new DomainError('INVALID_CONNECTION', 422, `接入 ${connection.id} 的操作缺少路径`);
      if (
        (connection.runtime?.cancel ?? connection.capabilities.cancel) &&
        (!connection.routes.cancel || !connection.operations.includes('cancel'))
      )
        throw new DomainError('INVALID_CONNECTION', 422, '取消能力必须声明取消路径');
    }
    const merged = {
      ...current,
      definitions: merge(current.definitions, incoming.definitions),
      connections: merge(current.connections, incoming.connections),
    };
    // 校验现有绑定，防止定义更新把正常配置变成半可用状态。
    for (const row of this.database.db.select().from(channelModels).all())
      if (row.definitionId || row.connectionId)
        this.resolve({ ...row, protocol: row.protocol || null }, merged);
    // 账号引用只能指向本机已有渠道，不从包内接收密钥。
    const ids = incoming.bindings.flatMap((binding) => (binding.id ? [binding.id] : []));
    if (new Set(ids).size !== ids.length)
      throw new DomainError('DUPLICATE_BINDING', 422, '同一绑定不能重复更新');
    for (const binding of incoming.bindings) {
      if (Object.keys(binding.capabilityLimit).some((key) => key !== 'concurrency'))
        throw new DomainError('INVALID_CAPABILITY', 422, '绑定只支持收窄并发额度');
      const channel = this.database.db
        .select()
        .from(channels)
        .where(eq(channels.id, binding.channelId))
        .get();
      if (!channel) throw new DomainError('CHANNEL_NOT_FOUND', 422, '导入绑定引用的本机渠道不存在');
      this.resolve(
        {
          definitionId: binding.modelDefinitionId,
          connectionId: binding.connectionId,
          upstreamModelId: binding.upstreamModelId,
          displayName: binding.alias ?? binding.upstreamModelId,
          kind: null,
          protocol: null,
          profileId: null,
          overrides: ModelOverrides.parse(binding.capabilityLimit),
          enabled: binding.enabled,
        },
        merged,
      );
      if (
        binding.id &&
        this.database.db.select().from(channelModels).where(eq(channelModels.id, binding.id)).get()
          ?.channelId !== binding.channelId
      )
        throw new DomainError('MODEL_NOT_FOUND', 422, '导入绑定更新目标不存在或不属于该渠道');
      if (binding.id) conflicts.push(binding.id);
    }
    return {
      incoming,
      before: current,
      merged,
      conflicts,
      revision: this.revision(current),
      affectedModels: this.database.db
        .select()
        .from(channelModels)
        .all()
        .filter(
          (row) =>
            conflicts.includes(row.id) ||
            conflicts.includes(row.definitionId ?? '') ||
            conflicts.includes(row.connectionId ?? ''),
        )
        .map((row) => row.displayName),
    };
  }
  apply(raw: unknown, revision: string, confirmUpdates: boolean) {
    try {
      return this.database.db.transaction((tx) => {
        const preview = this.preview(raw);
        if (revision !== preview.revision || (preview.conflicts.length && !confirmUpdates))
          throw new DomainError('IMPORT_CONFLICT', 409, '目录已变化或定义更新尚未确认，请重新预览');
        tx.insert(modelCatalog)
          .values({ id: 'catalog', package: preview.merged })
          .onConflictDoUpdate({ target: modelCatalog.id, set: { package: preview.merged } })
          .run();
        tx.update(channelModels).set({ lastCheck: null, lastMediaCheck: null }).run();
        for (const binding of preview.incoming.bindings) {
          const values = this.resolve(
            {
              definitionId: binding.modelDefinitionId,
              connectionId: binding.connectionId,
              upstreamModelId: binding.upstreamModelId,
              displayName: binding.alias ?? binding.upstreamModelId,
              kind: null,
              protocol: null,
              profileId: null,
              overrides: ModelOverrides.parse(binding.capabilityLimit),
              enabled: binding.enabled,
            },
            preview.merged,
          );
          const saved = {
            ...values,
            connection: values.connection ?? {},
            protocol: values.protocol ?? '',
            channelId: binding.channelId,
            lastCheck: null,
          };
          if (binding.id) {
            const previous = tx
              .select()
              .from(channelModels)
              .where(eq(channelModels.id, binding.id))
              .get()!;
            tx.update(channelModels).set(saved).where(eq(channelModels.id, binding.id)).run();
            if (!saved.enabled || previous.kind !== saved.kind)
              tx.delete(modelDefaults).where(eq(modelDefaults.channelModelId, binding.id)).run();
          } else
            tx.insert(channelModels)
              .values({ ...saved, id: randomUUID() })
              .run();
        }
        return this.get();
      });
    } catch (error) {
      if (error instanceof Error && error.message.includes('UNIQUE constraint'))
        throw new DomainError(
          'DUPLICATE_BINDING',
          409,
          '导入绑定重复：同一渠道、类别和上游 ID 只能保存一次；整批导入已回滚',
        );
      throw error;
    }
  }
}
