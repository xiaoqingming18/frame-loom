import { useEffect, useRef, useState } from 'react';
import { Camera } from 'lucide-react';
import { Button } from '@frame-loom/ui/components/button';
import type { AngleParameters, LightingParameters } from './image-edit-parameters';

export function AnglePreview({
  imageUrl,
  value,
  onChange,
}: {
  imageUrl: string;
  value: AngleParameters;
  onChange: (value: AngleParameters) => void;
}) {
  const [mode, setMode] = useState<'camera' | 'skybox'>('camera');
  const drag = useRef<{ x: number; y: number; value: AngleParameters } | null>(null);
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          aria-pressed={mode === 'camera'}
          onClick={() => setMode('camera')}
        >
          摄像头
        </Button>
        <Button
          size="sm"
          variant="outline"
          aria-pressed={mode === 'skybox'}
          onClick={() => setMode('skybox')}
        >
          天空盒
        </Button>
      </div>
      <div
        aria-label="摄像机预览"
        className="relative grid h-48 touch-none place-items-center overflow-hidden rounded-sm border bg-muted"
        style={{ perspective: '500px' }}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = { x: event.clientX, y: event.clientY, value };
        }}
        onPointerMove={(event) => {
          const start = drag.current;
          if (!start) return;
          onChange({
            ...value,
            horizontalAngle: Math.round(
              Math.max(
                -180,
                Math.min(180, start.value.horizontalAngle + (event.clientX - start.x)),
              ),
            ),
            pitchAngle: Math.round(
              Math.max(-60, Math.min(60, start.value.pitchAngle - (event.clientY - start.y))),
            ),
          });
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
      >
        <div
          className="relative grid size-32 place-items-center"
          style={{
            transformStyle: 'preserve-3d',
            transform:
              mode === 'skybox'
                ? `rotateX(${-value.pitchAngle}deg) rotateY(${-value.horizontalAngle}deg)`
                : 'rotateX(-12deg)',
          }}
        >
          {[0, 60, 120].map((rotation) => (
            <div
              key={rotation}
              className="absolute inset-0 rounded-full border border-border"
              style={{ transform: `rotateY(${rotation}deg)`, transformStyle: 'preserve-3d' }}
            />
          ))}
          <img
            src={imageUrl}
            alt="源图角度预览"
            draggable={false}
            className="max-h-20 max-w-20 object-contain"
            style={{ transform: `scale(${1.15 - value.cameraDistance / 40})` }}
          />
          <div
            className="absolute inset-0 grid place-items-center"
            style={{
              transformStyle: 'preserve-3d',
              transform: `rotateY(${value.horizontalAngle}deg) rotateX(${-value.pitchAngle}deg) translateZ(75px)`,
            }}
          >
            <Camera
              aria-hidden="true"
              className="size-6 rounded-sm border bg-popover p-1 text-primary"
            />
          </div>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        拖动预览或使用角度滑杆调整；此预览仅示意视角。
      </p>
    </div>
  );
}

export function LightingPreview({
  imageUrl,
  value,
  onChange,
}: {
  imageUrl: string;
  value: LightingParameters;
  onChange: (value: LightingParameters) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ x: number; y: number; value: LightingParameters } | null>(null);
  const [front, setFront] = useState(false);
  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    let alive = true;
    const image = new Image();
    const draw = () => {
      if (!alive) return;
      const styles = getComputedStyle(canvas);
      const color = (token: string) => styles.getPropertyValue(token).trim();
      context.clearRect(0, 0, 220, 220);
      context.save();
      context.beginPath();
      context.arc(110, 110, 104, 0, 2 * Math.PI);
      context.clip();
      context.fillStyle = color('--muted');
      context.fillRect(0, 0, 220, 220);
      context.strokeStyle = color('--border');
      for (let i = -3; i <= 3; i++) {
        context.beginPath();
        context.ellipse(
          110,
          110 + i * 26,
          Math.sqrt(Math.max(0, 104 ** 2 - (i * 26) ** 2)),
          front ? 1 : 12,
          0,
          0,
          2 * Math.PI,
        );
        context.stroke();
        context.beginPath();
        context.ellipse(110, 110, Math.max(1, Math.abs(i) * 34), 104, 0, 0, 2 * Math.PI);
        context.stroke();
      }
      if (image.complete && image.naturalWidth) {
        const scale = Math.min(90 / image.naturalWidth, 100 / image.naturalHeight);
        const width = image.naturalWidth * scale;
        const height = image.naturalHeight * scale;
        context.drawImage(image, 110 - width / 2, 110 - height / 2, width, height);
      }
      const azimuth = (value.azimuth * Math.PI) / 180;
      const elevation = (value.elevation * Math.PI) / 180;
      const x = 110 + 96 * Math.sin(azimuth) * (front ? 0.85 : Math.cos(elevation));
      const y = 110 - 96 * Math.sin(elevation);
      const glow = context.createRadialGradient(x, y, 0, x, y, 100);
      glow.addColorStop(0, value.lightColor);
      glow.addColorStop(1, 'transparent');
      context.globalAlpha = value.brightness / 150;
      context.fillStyle = glow;
      context.fillRect(0, 0, 220, 220);
      context.globalAlpha = 1;
      context.fillStyle = color('--primary');
      context.beginPath();
      context.arc(x, y, 5, 0, 2 * Math.PI);
      context.fill();
      context.restore();
    };
    image.onload = draw;
    image.src = imageUrl;
    draw();
    const theme = window.matchMedia('(prefers-color-scheme: dark)');
    theme.addEventListener('change', draw);
    return () => {
      alive = false;
      image.onload = null;
      theme.removeEventListener('change', draw);
    };
  }, [front, imageUrl, value]);
  return (
    <div className="space-y-2">
      <Button variant="outline" size="sm" onClick={() => setFront(!front)}>
        {front ? '切换透视预览' : '切换正面预览'}
      </Button>
      <canvas
        ref={canvasRef}
        width={220}
        height={220}
        aria-label="拖动调整主光源方向"
        className="mx-auto touch-none rounded-sm border bg-muted"
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = { x: event.clientX, y: event.clientY, value };
        }}
        onPointerMove={(event) => {
          const start = drag.current;
          if (!start) return;
          onChange({
            ...value,
            azimuth: Math.round(
              (((start.value.azimuth + (event.clientX - start.x) * 1.5) % 360) + 360) % 360,
            ),
            elevation: Math.round(
              Math.max(-80, Math.min(80, start.value.elevation - (event.clientY - start.y))),
            ),
          });
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
      />
      <p className="text-xs text-muted-foreground">拖动光源球或使用方向滑杆调整主光。</p>
    </div>
  );
}
