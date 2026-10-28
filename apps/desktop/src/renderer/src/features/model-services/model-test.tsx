import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  MediaFile,
  SemanticRequest,
  VIDEO_MODE_LABELS,
  effectiveVideoParams,
  getProtocol,
  type SemanticInput,
  type SemanticParams,
} from '@frame-loom/contracts';
import { ModelCheck, GenerationJob, type Model } from '@frame-loom/contracts/model-service';
import { Button } from '@frame-loom/ui/components/button';
import { Textarea } from '@frame-loom/ui/components/textarea';
import { Input } from '@frame-loom/ui/components/input';
import { NativeSelect } from '@frame-loom/ui/components/native-select';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@frame-loom/ui/components/dialog';
import type { EngineClient } from '@/lib/engine-client';
import { VoicePicker } from './voice-picker';
import { Field, ErrorMessage, ConfirmDialog } from './form-fields';

export function ModelTest({
  client,
  model,
  onClose,
}: {
  client: EngineClient;
  model: Model;
  onClose: () => void;
}) {
  const cap = model.capability;
  const [confirmed, setConfirmed] = useState(model.kind === 'chat');
  const [prompt, setPrompt] = useState('请生成一个简单的测试结果');
  const [mode, setMode] = useState(cap.kind === 'video' ? cap.defaultMode : undefined);
  const [params, setParams] = useState<SemanticParams>({});
  const [inputs, setInputs] = useState<SemanticInput[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [check, setCheck] = useState<ModelCheck>();
  const [jobId, setJobId] = useState<string>();
  const queries = useQueryClient();
  const job = useQuery({
    queryKey: ['generation-job', jobId],
    enabled: !!jobId,
    queryFn: ({ signal }) => client.request(`/generation-jobs/${jobId}`, GenerationJob, { signal }),
    refetchInterval: (query) =>
      query.state.data &&
      ['succeeded', 'failed', 'cancelled', 'submit_unknown', 'download_failed', 'paused'].includes(
        query.state.data.status,
      )
        ? false
        : 500,
  });
  const status = job.data?.status;
  useEffect(() => {
    if (status === 'succeeded' || status === 'failed')
      void queries.invalidateQueries({ queryKey: ['models'] });
  }, [status, queries]);
  async function run() {
    setBusy(true);
    setError('');
    try {
      if (model.kind === 'chat') {
        setCheck(
          await client.request(`/models/${model.id}/check`, ModelCheck, {
            method: 'POST',
            timeoutMs: 65000,
          }),
        );
        await queries.invalidateQueries({ queryKey: ['models'] });
      } else {
        const body = SemanticRequest.parse({
          modelId: model.id,
          prompt,
          mode,
          params,
          inputs,
          source: 'test',
        });
        const result = await client.request('/generation-jobs', GenerationJob, {
          method: 'POST',
          body,
          timeoutMs: 120000,
        });
        setJobId(result.id);
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '测试失败');
    } finally {
      setBusy(false);
    }
  }
  async function upload(file?: File) {
    if (!file) return;
    setBusy(true);
    try {
      const media = await client.request('/media', MediaFile, {
        method: 'POST',
        body: file,
        timeoutMs: 120000,
      });
      const kind = media.mime.startsWith('video/')
        ? 'video'
        : media.mime.startsWith('audio/')
          ? 'audio'
          : 'image';
      const role =
        mode === 'first' || mode === 'first_last'
          ? 'first_frame'
          : mode === 'last'
            ? 'last_frame'
            : mode === 'keyframes'
              ? 'keyframe'
              : mode === 'edit' || mode === 'extend'
                ? 'base_video'
                : 'reference';
      setInputs([...inputs, { sha256: media.sha256, kind, role, order: inputs.length }]);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '上传失败');
    } finally {
      setBusy(false);
    }
  }
  if (!confirmed)
    return (
      <ConfirmDialog
        title="确认生成测试"
        description="此测试会向服务商发起一次真实生成请求，可能产生费用"
        onClose={onClose}
        confirmLabel="确认并打开测试"
        onConfirm={() => setConfirmed(true)}
      />
    );
  const pending =
    jobId &&
    !['succeeded', 'failed', 'cancelled', 'submit_unknown', 'download_failed', 'paused'].includes(
      status ?? '',
    );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
        <DialogTitle>生成测试 · {model.displayName}</DialogTitle>
        <DialogDescription>
          {model.lastCheck ? '配置修改后旧测试结果自动失效。' : '此结果只验证当前配置与所选方式。'}
        </DialogDescription>
        {cap.kind === 'video' && (
          <Field label="生成方式">
            <NativeSelect
              value={mode}
              onChange={(event) => {
                setMode(event.target.value as typeof mode);
                setInputs([]);
              }}
            >
              {cap.modes.map((item) => (
                <option key={item.id} value={item.id}>
                  {VIDEO_MODE_LABELS[item.id]}
                </option>
              ))}
            </NativeSelect>
          </Field>
        )}
        {model.kind !== 'chat' && (
          <>
            <TestParams model={model} mode={mode} params={params} onChange={setParams} />
            <Field label={model.kind === 'tts' ? '朗读文本' : '提示词'}>
              <Textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} />
            </Field>
            {cap.kind === 'tts' ? (
              <>
                <VoicePicker
                  key={model.id}
                  client={client}
                  modelId={model.id}
                  value={params.voice ?? cap.voices.default ?? ''}
                  onChange={(_, voice) => setParams({ ...params, voice })}
                />
                {(['speed', 'pitch', 'volume'] as const)
                  .filter((key) => cap[key])
                  .map((key) => (
                    <Field key={key} label={{ speed: '语速', pitch: '音调', volume: '音量' }[key]}>
                      <Input
                        type="number"
                        min={cap[key]?.min}
                        max={cap[key]?.max}
                        step="any"
                        value={params[key] ?? cap[key]?.default}
                        onChange={(event) =>
                          setParams({ ...params, [key]: Number(event.target.value) })
                        }
                      />
                    </Field>
                  ))}
              </>
            ) : (
              <>
                <Field label="上传测试素材（可选）">
                  <Input
                    type="file"
                    accept="image/*,video/*,audio/*"
                    disabled={busy}
                    onChange={(event) => void upload(event.target.files?.[0])}
                  />
                </Field>
                {inputs.map((input, index) => (
                  <div key={index} className="flex items-center gap-2 text-xs">
                    <span>
                      {{ image: '图片', video: '视频', audio: '音频' }[input.kind]} {index + 1}
                    </span>
                    <NativeSelect
                      aria-label={`素材 ${index + 1} 角色`}
                      value={input.role}
                      onChange={(event) =>
                        setInputs(
                          inputs.map((item, i) =>
                            i === index
                              ? { ...item, role: event.target.value as SemanticInput['role'] }
                              : item,
                          ),
                        )
                      }
                    >
                      {['reference', 'first_frame', 'last_frame', 'keyframe', 'base_video'].map(
                        (role) => (
                          <option key={role} value={role}>
                            {
                              {
                                reference: '参考素材',
                                first_frame: '首帧',
                                last_frame: '尾帧',
                                keyframe: '关键帧',
                                base_video: '待编辑视频',
                              }[role]
                            }
                          </option>
                        ),
                      )}
                    </NativeSelect>
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => setInputs(inputs.filter((_, i) => i !== index))}
                    >
                      移除
                    </Button>
                  </div>
                ))}
              </>
            )}
          </>
        )}
        <ErrorMessage error={error || job.error || job.data?.errorMessage} />
        <Button disabled={busy || !!pending} onClick={() => void run()}>
          {busy || pending ? '测试进行中…' : '开始测试'}
        </Button>
        {check && (
          <div role="status" className="space-y-2 text-sm">
            <p>
              连接：
              {check.steps?.connection === true || check.ok
                ? '通过'
                : check.steps?.connection === false
                  ? '失败'
                  : '未确认'}
            </p>
            <p>文本回复：{check.ok ? '通过' : check.steps?.reply === false ? '失败' : '未完成'}</p>
            <p>{check.message}</p>
          </div>
        )}
        {job.data && (
          <div className="space-y-3">
            <p role="status">状态：{job.data.status}</p>
            <p className="text-xs text-muted-foreground">
              仅验证当前模式：{mode ? VIDEO_MODE_LABELS[mode] : '默认'}
            </p>
            {job.data.outputs.map((media) =>
              media.mime.startsWith('audio/') ? (
                <audio
                  key={media.sha256}
                  controls
                  aria-label="TTS 测试结果"
                  className="w-full"
                  src={`frame-media://${media.sha256}`}
                />
              ) : media.mime.startsWith('video/') ? (
                <video
                  key={media.sha256}
                  controls
                  aria-label="视频测试结果"
                  className="max-h-64 w-full"
                  src={`frame-media://${media.sha256}`}
                />
              ) : (
                <img
                  key={media.sha256}
                  alt="图像测试结果"
                  className="max-h-64 rounded-lg object-contain"
                  src={`frame-media://${media.sha256}`}
                />
              ),
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function TestParams({
  model,
  mode,
  params,
  onChange,
}: {
  model: Model;
  mode: SemanticRequest['mode'];
  params: SemanticParams;
  onChange: (params: SemanticParams) => void;
}) {
  const cap = model.capability;
  const select = (
    key: keyof SemanticParams,
    label: string,
    values: (string | number | { value: string; disabled: boolean; reason?: string })[],
    fallback?: string | number,
  ) =>
    values.length > 0 && (
      <Field key={key} label={label}>
        <NativeSelect
          value={String(params[key] ?? fallback ?? '')}
          onChange={(event) =>
            onChange({
              ...params,
              [key]:
                event.target.value === ''
                  ? undefined
                  : typeof values[0] === 'number'
                    ? Number(event.target.value)
                    : event.target.value,
            })
          }
        >
          <option value="">协议默认</option>
          {values.map((option) => {
            const value = typeof option === 'object' ? option.value : option;
            return (
              <option
                key={value}
                value={value}
                disabled={typeof option === 'object' && option.disabled}
                title={typeof option === 'object' ? option.reason : undefined}
              >
                {value}
              </option>
            );
          })}
        </NativeSelect>
      </Field>
    );
  const number = (
    key: keyof SemanticParams,
    label: string,
    min?: number,
    max?: number,
    step = 1,
  ) => (
    <Field key={key} label={label}>
      <Input
        type="number"
        min={min}
        max={max}
        step={step}
        value={String(params[key] ?? '')}
        placeholder="协议默认"
        onChange={(event) =>
          onChange({
            ...params,
            [key]: event.target.value === '' ? undefined : Number(event.target.value),
          })
        }
      />
    </Field>
  );
  const toggle = (key: 'audio' | 'watermark', label: string) => (
    <Field key={key} label={label}>
      <NativeSelect
        value={params[key] === undefined ? '' : String(params[key])}
        onChange={(event) =>
          onChange({
            ...params,
            [key]: event.target.value === '' ? undefined : event.target.value === 'true',
          })
        }
      >
        <option value="">协议默认</option>
        <option value="true">开启</option>
        <option value="false">关闭</option>
      </NativeSelect>
    </Field>
  );
  const video =
    cap.kind === 'video' && model.protocolId && mode
      ? effectiveVideoParams(cap, getProtocol(model.protocolId)!, mode, [])
      : undefined;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {cap.kind === 'image' && (
        <>
          {select(
            'tier',
            '尺寸档位',
            cap.size.tiers.filter((tier) => tier.enabled).map((tier) => tier.name),
            cap.size.default.tier,
          )}
          {select(
            'aspectRatio',
            '画面比例',
            cap.size.tiers
              .find((tier) => tier.name === (params.tier ?? cap.size.default.tier))
              ?.ratios.map((ratio) => ratio.ratio) ?? [],
            cap.size.default.ratio,
          )}
          {cap.quality && select('quality', '质量', cap.quality.values, cap.quality.default)}
          {cap.background?.transparent &&
            select('background', '背景', ['auto', 'opaque', 'transparent'], cap.background.default)}
          {select('outputFormat', '输出格式', cap.outputFormats)}
          {number('count', '生成数量', 1, cap.count.max)}
          {cap.size.custom && (
            <>
              {number('width', '宽度', cap.size.custom.minEdge, cap.size.custom.maxEdge)}
              {number('height', '高度', cap.size.custom.minEdge, cap.size.custom.maxEdge)}
            </>
          )}
          {cap.seed && number('seed', '随机种子', 0)}
          {cap.negativePrompt && (
            <Field label="负向提示词">
              <Input
                value={params.negativePrompt ?? ''}
                onChange={(event) => onChange({ ...params, negativePrompt: event.target.value })}
              />
            </Field>
          )}
        </>
      )}
      {cap.kind === 'video' && (
        <>
          {select(
            'aspectRatio',
            '画面比例',
            video?.aspectRatios ?? cap.aspectRatios,
            cap.defaultAspectRatio,
          )}
          {select(
            'resolution',
            '输出分辨率',
            video?.resolutions ?? cap.resolutions,
            cap.defaultResolution,
          )}
          {cap.duration.kind === 'range'
            ? number(
                'duration',
                '时长（秒）',
                cap.duration.min,
                cap.duration.max,
                cap.duration.step,
              )
            : cap.duration.kind === 'values'
              ? select('duration', '时长（秒）', cap.duration.values, cap.duration.default)
              : null}
          {cap.audio.mode === 'optional' && toggle('audio', '声音')}
          {cap.watermark && toggle('watermark', '水印')}
          {cap.seed && number('seed', '随机种子', 0)}
        </>
      )}
      {cap.kind === 'tts' && (
        <>
          {select('format', '输出格式', cap.formats, cap.defaultFormat)}
          {select('sampleRate', '采样率', cap.sampleRates, cap.defaultSampleRate)}
          {cap.instructions && (
            <Field label="朗读指令">
              <Input
                value={params.instructions ?? ''}
                onChange={(event) => onChange({ ...params, instructions: event.target.value })}
              />
            </Field>
          )}
        </>
      )}
    </div>
  );
}
