import { useState } from 'react';
import { Camera, ScanFace, Sun } from 'lucide-react';
import { Button } from '@frame-loom/ui/components/button';
import { Dialog, DialogContent, DialogTitle } from '@frame-loom/ui/components/dialog';
import {
  ImageEditRecipe,
  imageEditSupport,
  planEditGeometry,
  type CanvasMediaData,
} from '@frame-loom/contracts';
import { useCanvas, useCanvasState } from '../context';
import { createImageEditChild } from '../commands/commands';
import { EmotionWorkspace } from './emotion-workspace';
import { activeVersion } from './media';
import { AnglePreview, LightingPreview } from './image-edit-previews';
import { buildImageEditPrompt } from './image-edit-prompts';
import {
  anglePresets,
  applyAnglePreset,
  buildLightingPrompt,
  defaultAngleParameters,
  defaultLightingParameters,
  defaultLightingTemplate,
  lightingStylePrompts,
  type AngleParameters,
  type LightingParameters,
} from './image-edit-parameters';

export function ImageEditTools({ nodeId, data }: { nodeId: string; data: CanvasMediaData }) {
  const { host, registry, store } = useCanvas();
  const version = activeVersion(data);
  const config = useCanvasState((state) => state.generationConfig);
  const [tool, setTool] = useState<'angle' | 'lighting' | 'emotion' | null>(null);
  const [angle, setAngle] = useState<AngleParameters>(defaultAngleParameters);
  const [lighting, setLighting] = useState<LightingParameters>(defaultLightingParameters);
  const [smartDescription, setSmartDescription] = useState('');
  const [template, setTemplate] = useState(defaultLightingTemplate);
  const [showTemplate, setShowTemplate] = useState(false);
  const [modelId, setModelId] = useState(data.modelId ?? '');
  if (!version) return null;
  const models = (config?.models ?? []).filter((model) => model.capability.kind === 'image');
  const model = models.find((item) => item.id === modelId);
  let geometry: ReturnType<typeof planEditGeometry> | undefined;
  let geometryIssue: string | undefined;
  if (model?.capability.kind === 'image') {
    try {
      geometry = planEditGeometry(model.capability, {
        x: 0,
        y: 0,
        width: version.width ?? 0,
        height: version.height ?? 0,
      });
    } catch (error) {
      geometryIssue = error instanceof Error ? error.message : '无法规划图片尺寸';
    }
  }
  if (tool === 'emotion')
    return (
      <>
        <Button
          size="sm"
          variant="outline"
          aria-label="表情编辑"
          onClick={() => setTool('emotion')}
        >
          <ScanFace aria-hidden="true" className="size-3.5" />
          表情
        </Button>
        <EmotionWorkspace
          key={version.sha256}
          nodeId={nodeId}
          sourceHash={version.sha256}
          imageUrl={host.media.url(version.sha256)}
          width={version.width ?? 0}
          height={version.height ?? 0}
          models={models}
          selectedModel={model}
          onClose={() => setTool(null)}
        />
      </>
    );
  const source = { nodeId, sha256: version.sha256 };
  const recipe = (operation: 'angle' | 'lighting') =>
    ImageEditRecipe.parse(
      operation === 'angle'
        ? { version: 1, source, operation, ...angle }
        : { version: 1, source, operation, ...lighting },
    );
  const createChild = (operation: 'angle' | 'lighting') => {
    const selectedModel = model;
    if (selectedModel?.capability.kind !== 'image') {
      store.getState().notify('请选择图片编辑模型');
      return;
    }
    const params = recipe(operation);
    const issue =
      geometryIssue ??
      imageEditSupport(selectedModel.capability, selectedModel.protocol)[operation].reason;
    if (issue) {
      store.getState().notify(issue);
      return;
    }
    const prompt = buildImageEditPrompt(params, smartDescription, template);
    const before = store.getState().document.nodes.length;
    if (
      !store
        .getState()
        .apply((document) =>
          createImageEditChild(
            registry,
            document,
            nodeId,
            params,
            prompt,
            selectedModel.id,
            geometry?.request,
          ),
        )
    )
      return;
    const child = store.getState().document.nodes[before];
    store.getState().select([child.id]);
    if (operation === 'angle') {
      setTool(null);
      if (!host.generation) return;
      void host.generation
        .create({
          modelId: selectedModel.id,
          prompt,
          params: geometry?.request ?? {},
          extras: {},
          inputs: [{ kind: 'image', role: 'reference', order: 0, sha256: version.sha256 }],
          imageEdit: params,
          source: 'canvas',
        })
        .then((job) => {
          store.getState().setGenerationJob(job);
          store.getState().applySystem((document) => ({
            ...document,
            nodes: document.nodes.map((node) =>
              node.id === child.id
                ? { ...node, data: { ...(node.data as CanvasMediaData), pendingJobIds: [job.id] } }
                : node,
            ),
          }));
        })
        .catch((error: unknown) =>
          store.getState().notify(error instanceof Error ? error.message : '提交角度编辑失败'),
        );
    } else setTool(null);
  };
  const activeModel = model;
  const issue =
    geometryIssue ??
    (activeModel?.capability.kind === 'image'
      ? imageEditSupport(activeModel.capability, activeModel.protocol)[tool ?? 'angle'].reason
      : undefined);
  const disabled = activeModel?.capability.kind !== 'image' || !!issue;
  return (
    <div className="nodrag nopan relative inline-flex items-center gap-1">
      <Button
        size="sm"
        variant="outline"
        onClick={() => setTool(tool === 'angle' ? null : 'angle')}
        aria-label="多角度编辑"
      >
        <Camera aria-hidden="true" className="size-3.5" />
        角度
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          setLighting(defaultLightingParameters);
          setSmartDescription('');
          setTemplate(defaultLightingTemplate);
          setShowTemplate(false);
          setTool(tool === 'lighting' ? null : 'lighting');
        }}
        aria-label="重打光编辑"
      >
        <Sun aria-hidden="true" className="size-3.5" />
        打光
      </Button>
      <Button size="sm" variant="outline" onClick={() => setTool('emotion')} aria-label="表情编辑">
        <ScanFace aria-hidden="true" className="size-3.5" />
        表情
      </Button>
      {tool && (
        <Dialog open onOpenChange={(open) => !open && setTool(null)}>
          <DialogContent
            showCloseButton={false}
            aria-describedby={undefined}
            className="nodrag nopan z-[100] max-h-[calc(100%-2rem)] overflow-auto bg-popover p-3 text-popover-foreground shadow-panel"
          >
            <header className="flex items-center justify-between">
              <DialogTitle className="text-sm font-medium">
                {tool === 'angle' ? '多角度编辑' : '重打光编辑'}
              </DialogTitle>
              <Button
                size="icon"
                variant="ghost"
                aria-label="关闭编辑面板"
                onClick={() => setTool(null)}
              >
                ×
              </Button>
            </header>
            <label className="grid grid-cols-[5rem_1fr] items-center gap-2 text-xs">
              模型
              <select
                aria-label="编辑模型"
                className="h-8 rounded-md border bg-background px-2"
                value={model?.id ?? ''}
                onChange={(event) => setModelId(event.target.value)}
              >
                <option value="">选择图片编辑模型</option>
                {models.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            {tool === 'angle' ? (
              <>
                <div className="flex flex-wrap gap-1">
                  {anglePresets.map((preset) => (
                    <Button
                      key={preset.id}
                      size="sm"
                      variant="outline"
                      onClick={() => setAngle((current) => applyAnglePreset(current, preset.id))}
                    >
                      {preset.label}
                    </Button>
                  ))}
                </div>
                <AngleRange
                  label="水平环绕"
                  value={angle.horizontalAngle}
                  min={-180}
                  max={180}
                  onChange={(horizontalAngle) =>
                    setAngle((current) => ({ ...current, horizontalAngle }))
                  }
                />
                <AngleRange
                  label="俯仰"
                  value={angle.pitchAngle}
                  min={-60}
                  max={60}
                  onChange={(pitchAngle) => setAngle((current) => ({ ...current, pitchAngle }))}
                />
                <AngleRange
                  label="景别"
                  value={angle.cameraDistance}
                  min={1}
                  max={10}
                  step={0.1}
                  onChange={(cameraDistance) =>
                    setAngle((current) => ({ ...current, cameraDistance }))
                  }
                />
                <label className="flex items-center gap-2 text-xs">
                  镜头
                  <select
                    className="h-8 rounded-md border bg-background px-2"
                    value={angle.lens}
                    onChange={(event) =>
                      setAngle((current) => ({
                        ...current,
                        lens: event.target.value as AngleParameters['lens'],
                      }))
                    }
                  >
                    <option value="standard">标准</option>
                    <option value="wide">广角</option>
                  </select>
                </label>
                <AnglePreview
                  imageUrl={host.media.url(version.sha256)}
                  value={angle}
                  onChange={setAngle}
                />
              </>
            ) : (
              <>
                <LightingPreview
                  imageUrl={host.media.url(version.sha256)}
                  value={lighting}
                  onChange={setLighting}
                />
                <AngleRange
                  label="水平光向"
                  value={lighting.azimuth}
                  min={0}
                  max={359}
                  onChange={(azimuth) => setLighting((current) => ({ ...current, azimuth }))}
                />
                <AngleRange
                  label="垂直光向"
                  value={lighting.elevation}
                  min={-80}
                  max={80}
                  onChange={(elevation) => setLighting((current) => ({ ...current, elevation }))}
                />
                <AngleRange
                  label="亮度"
                  value={lighting.brightness}
                  min={0}
                  max={100}
                  onChange={(brightness) => setLighting((current) => ({ ...current, brightness }))}
                />
                <label className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={lighting.rimLight}
                    onChange={(event) =>
                      setLighting((current) => ({ ...current, rimLight: event.target.checked }))
                    }
                  />
                  轮廓光
                </label>
                <label className="flex items-center gap-2 text-xs">
                  光色
                  <input
                    aria-label="光色"
                    type="color"
                    value={lighting.lightColor}
                    onChange={(event) =>
                      setLighting((current) => ({ ...current, lightColor: event.target.value }))
                    }
                  />
                </label>
                <label className="grid grid-cols-[5rem_1fr] items-center gap-2 text-xs">
                  风格
                  <select
                    aria-label="打光风格"
                    className="h-8 rounded-md border bg-background px-2"
                    value={lighting.stylePreset}
                    onChange={(event) =>
                      setLighting((current) => ({ ...current, stylePreset: event.target.value }))
                    }
                  >
                    <option value="">无</option>
                    {Object.entries(lightingStylePrompts).map(([id, prompt]) => (
                      <option key={id} value={id}>
                        {prompt.split('，')[0]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={lighting.smartMode}
                    onChange={(event) =>
                      setLighting((current) => ({ ...current, smartMode: event.target.checked }))
                    }
                  />
                  智能描述
                </label>
                <textarea
                  aria-label="智能打光描述"
                  className="min-h-16 w-full rounded-md border bg-background p-2 text-xs"
                  value={smartDescription}
                  onChange={(event) => setSmartDescription(event.target.value)}
                />
                <Button variant="outline" size="sm" onClick={() => setShowTemplate(!showTemplate)}>
                  设置提示词模板
                </Button>
                {showTemplate && (
                  <label className="grid gap-1 text-xs">
                    提示词模板（即时生效）
                    <textarea
                      aria-label="打光提示词模板"
                      className="min-h-24 w-full rounded-sm border bg-background p-2"
                      value={template}
                      maxLength={16000}
                      onChange={(event) => setTemplate(event.target.value)}
                    />
                    <span className="text-muted-foreground">
                      支持{' '}
                      {
                        '{{consistencyPrompt}} {{presetPrompt}} {{smartDesc}} {{lightDirectionPrompt}} {{brightnessPrompt}} {{rimLightPrompt}} {{lightColorPrompt}} {{lightingMeta}}'
                      }
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setTemplate(defaultLightingTemplate)}
                    >
                      恢复默认模板
                    </Button>
                  </label>
                )}
                <p className="text-xs text-muted-foreground">
                  {buildLightingPrompt(lighting, smartDescription, template)}
                </p>
              </>
            )}
            {activeModel?.capability.kind !== 'image' && (
              <p role="alert" className="text-xs text-destructive">
                请选择图片编辑模型
              </p>
            )}
            {issue && (
              <p role="alert" className="text-xs text-destructive">
                {issue}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() =>
                  tool === 'angle'
                    ? setAngle(defaultAngleParameters)
                    : setLighting(defaultLightingParameters)
                }
              >
                重置参数
              </Button>
              <Button variant="outline" onClick={() => setTool(null)}>
                取消
              </Button>
              <Button disabled={disabled} onClick={() => createChild(tool)}>
                确认
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function AngleRange({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="grid grid-cols-[5rem_1fr_3.5rem] items-center gap-2 text-xs">
      {label}
      <input
        aria-label={label}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <output className="text-right tabular-nums">{value}</output>
    </label>
  );
}
