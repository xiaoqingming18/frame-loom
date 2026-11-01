import { useEffect, useRef } from 'react';

const TAU = Math.PI * 2;
const BUCKETS = 8;

function makeParticle() {
  const r = Math.random();
  const yOffset =
    r < 0.6
      ? (Math.random() * 2 - 1) * 0.4
      : r < 0.86
        ? (Math.random() * 2 - 1) * 0.75
        : Math.random() * 2 - 1;
  return {
    x: Math.random(),
    yOffset,
    speed: 0.03 + Math.random() * 0.048,
    size: 0.38 + Math.random() * 0.55,
    alpha: 0.24 + Math.random() * 0.66,
    twinkle: Math.random() * TAU,
    twinkleSpeed: 0.6 + Math.random() * 1.6,
    escape: Math.random() < 0.05 ? 1.15 + Math.random() * 0.4 : 1,
  };
}

function bandThickness(nx: number, t: number) {
  return (
    0.72 +
    0.26 * Math.sin(nx * 2.6 + t * 0.8 + 0.4) +
    0.15 * Math.sin(nx * 6.1 - t * 1.3 + 1.9) +
    0.08 * Math.sin(nx * 11.7 + t * 2.1 + 3.4)
  );
}

export function GenerationAudioAnimation() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const host = canvas.parentElement!;
    const theme = window.matchMedia('(prefers-color-scheme: dark)');
    const particles = Array.from({ length: 680 }, makeParticle);
    const buckets = Array.from({ length: BUCKETS }, () => [] as number[]);
    let rgb = '';
    const updateTheme = () => {
      rgb = getComputedStyle(canvas).getPropertyValue('--canvas-generation-audio-rgb').trim();
    };
    updateTheme();
    theme.addEventListener('change', updateTheme);
    let width = 0;
    let height = 0;
    let last = 0;
    let startTime = 0;
    let visible = true;
    let frame = 0;
    const resize = () => {
      // 使用布局尺寸，避免画布缩放改变粒子的密度和速度。
      const w = host.clientWidth;
      const h = host.clientHeight;
      if (!w || !h) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      width = w;
      height = h;
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    const visibility = new IntersectionObserver((entries) => {
      visible = entries[0].isIntersecting;
    });
    visibility.observe(host);

    const draw = (now: number) => {
      frame = requestAnimationFrame(draw);
      const W = width;
      const H = height;
      if (!visible || !W || !H) return;
      if (!startTime) startTime = now;
      const elapsed = (now - startTime) / 1000;
      const introRaw = Math.min(1, elapsed / 1.5);
      const intro = introRaw * introRaw * (3 - 2 * introRaw);
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 0.016;
      last = now;
      ctx.clearRect(0, 0, W, H);
      const t = now * 0.001;
      const cy = H / 2 + Math.sin(t * 0.32) * 2.5;
      const breathe = 1 + Math.sin(t * 0.55) * 0.05;
      const pad = W * 0.04;
      const span = W - pad * 2;
      const baseAmp = H * 0.24;
      const hlPos = (t * 0.13) % 1.25;
      for (const bucket of buckets) bucket.length = 0;
      for (const p of particles) {
        const centerFactor = Math.pow(1 - Math.abs(p.yOffset), 0.85);
        const speedMul = 0.55 + centerFactor * 0.85;
        p.x += p.speed * speedMul * dt;
        if (p.x > 1.03) p.x -= 1.06;
        if (p.x < -0.02) continue;
        const nx = p.x;
        if (nx < 0 || nx > 1) continue;
        const edge = Math.pow(Math.sin(nx * Math.PI), 0.35);
        if (edge < 0.05) continue;
        const thick = bandThickness(nx, t) * edge * baseAmp * breathe;
        if (thick < 1) continue;
        const x = pad + nx * span;
        const y = cy + p.yOffset * p.escape * thick * intro;
        const twinkle = 0.82 + Math.sin(t * p.twinkleSpeed + p.twinkle) * 0.18;
        const d = nx - hlPos;
        const hl = Math.exp(-(d * d) / 0.014);
        let alpha = p.alpha * edge * (0.3 + centerFactor * 0.7) * twinkle * (0.55 + hl * 0.9);
        if (p.escape > 1) alpha *= 0.4;
        if (alpha > 1) alpha = 1;
        if (alpha < 0.03) continue;
        let size = p.size * (0.55 + centerFactor * 0.75) * (1 + hl * 0.8);
        if (Math.abs(p.yOffset) < 0.14) size *= 1.18;
        if (p.escape > 1) size *= 0.65;
        if (size < 0.25) continue;
        const idx = Math.min(BUCKETS - 1, Math.floor(alpha * BUCKETS));
        buckets[idx].push(x, y, size);
      }
      ctx.globalCompositeOperation = theme.matches ? 'lighter' : 'source-over';
      for (let k = 0; k < BUCKETS; k++) {
        const arr = buckets[k];
        if (!arr.length) continue;
        if (k >= BUCKETS - 2) {
          ctx.fillStyle = `rgba(${rgb},${theme.matches ? '0.045' : '0.035'})`;
          ctx.beginPath();
          for (let m = 0; m < arr.length; m += 3) {
            const px = arr[m];
            const py = arr[m + 1];
            const sz = arr[m + 2] * 1.9;
            ctx.moveTo(px + sz, py);
            ctx.arc(px, py, sz, 0, TAU);
          }
          ctx.fill();
        }
        ctx.fillStyle = `rgba(${rgb},${((k + 0.5) / BUCKETS).toFixed(2)})`;
        ctx.beginPath();
        for (let m = 0; m < arr.length; m += 3) {
          const px = arr[m];
          const py = arr[m + 1];
          const sz = arr[m + 2];
          ctx.moveTo(px + sz, py);
          ctx.arc(px, py, sz, 0, TAU);
        }
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
    };
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      visibility.disconnect();
      theme.removeEventListener('change', updateTheme);
    };
  }, []);
  return <canvas ref={ref} />;
}
