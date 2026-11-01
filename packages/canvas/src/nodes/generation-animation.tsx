import { useEffect, useRef } from 'react';
import { GenerationAudioAnimation } from './generation-audio-animation';

function GenerationVideoAnimation() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = ref.current!;
    const animations: Animation[] = [];
    let width = 0;
    let height = 0;
    const clear = () => {
      animations.forEach((animation) => animation.cancel());
      animations.length = 0;
      host.replaceChildren();
    };
    const spawn = () => {
      const W = host.clientWidth;
      const H = host.clientHeight;
      if (!W || !H || (W === width && H === height)) return;
      width = W;
      height = H;
      clear();
      const maxR = Math.hypot(W, H) / 2;
      for (let i = 0; i < 72; i++) {
        const p = document.createElement('i');
        p.className = 'canvas-generation-streak';
        const angle = Math.random() * Math.PI * 2;
        const dirX = Math.cos(angle);
        const dirY = Math.sin(angle);
        const startR = maxR * (0.9 + Math.random() * 0.35);
        const endR = Math.random() * 10;
        const sx = dirX * startR;
        const sy = dirY * startR;
        const ex = dirX * endR;
        const ey = dirY * endR;
        const w = 1.5 + Math.random() * 1.5;
        const h = 8 + Math.random() * 16;
        p.style.width = `${w}px`;
        p.style.height = `${h}px`;
        p.style.marginLeft = `${-w / 2}px`;
        p.style.marginTop = `${-h / 2}px`;
        const inner = document.createElement('b');
        inner.style.transform = `rotate(${((angle * 180) / Math.PI + 90).toFixed(1)}deg)`;
        p.appendChild(inner);
        const duration = 1800 + Math.random() * 1600;
        animations.push(
          p.animate(
            [
              {
                transform: `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px) scale(1.25)`,
                opacity: 0,
              },
              {
                transform: `translate(${(sx * 0.88).toFixed(1)}px, ${(sy * 0.88).toFixed(1)}px) scale(1)`,
                opacity: 1,
                offset: 0.12,
              },
              {
                transform: `translate(${ex.toFixed(1)}px, ${ey.toFixed(1)}px) scale(0.03)`,
                opacity: 0,
              },
            ],
            {
              duration,
              delay: -Math.random() * duration,
              iterations: Infinity,
              easing: 'cubic-bezier(0.45, 0, 0.9, 0.5)',
              fill: 'both',
            },
          ),
        );
        host.appendChild(p);
      }
    };
    const frame = requestAnimationFrame(spawn);
    const observer = new ResizeObserver(spawn);
    observer.observe(host);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      clear();
    };
  }, []);
  return <div ref={ref} className="canvas-generation-tunnel" />;
}

function GenerationImageAnimation() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = ref.current!;
    for (let i = 0; i < 15; i++) {
      const line = document.createElement('i');
      const drop = document.createElement('div');
      drop.className = 'canvas-generation-drop';
      drop.style.animationDelay = `${(Math.random() * 2).toFixed(2)}s`;
      drop.style.animationDuration = `${(2 + Math.random() * 1.5).toFixed(2)}s`;
      line.appendChild(drop);
      host.appendChild(line);
    }
    return () => host.replaceChildren();
  }, []);
  return <div ref={ref} className="canvas-generation-rain" />;
}

export function GenerationAnimation({ kind }: { kind: 'image' | 'video' | 'audio' }) {
  return (
    <div aria-hidden="true" className="canvas-generation-animation">
      <div className="canvas-generation-ambient">
        <div className="canvas-generation-aura" />
        <div className="canvas-generation-blob canvas-generation-blob-one" />
        <div className="canvas-generation-blob canvas-generation-blob-two" />
        <div className="canvas-generation-sheen" />
      </div>
      {kind === 'video' ? (
        <GenerationVideoAnimation />
      ) : kind === 'audio' ? (
        <div className="canvas-generation-spectrum">
          <GenerationAudioAnimation />
        </div>
      ) : (
        <GenerationImageAnimation />
      )}
      <div className="canvas-generation-noise" />
    </div>
  );
}
