import { useState, useEffect, useRef } from 'react';
import { StarryBackground } from './StarryBackground';

type TimePeriod = '深夜' | '凌晨' | '早晨' | '上午' | '中午' | '下午' | '傍晚' | '晚上';

interface TimeTheme {
  period: TimePeriod;
  /** 径向光晕 1 — 右上角 */
  radial1: string;
  /** 径向光晕 2 — 左下角 */
  radial2: string;
  /** 星点/粒子透明度 */
  starOpacity: number;
}

const THEMES: Record<TimePeriod, TimeTheme> = {
  '深夜': {
    period: '深夜',
    radial1: 'rgba(30,20,80,0.6)',   // 深紫黑
    radial2: 'rgba(80,20,60,0.4)',   // 深玫红
    starOpacity: 0.9,
  },
  '凌晨': {
    period: '凌晨',
    radial1: 'rgba(40,25,90,0.5)',
    radial2: 'rgba(100,30,80,0.3)',
    starOpacity: 0.8,
  },
  '早晨': {
    period: '早晨',
    radial1: 'rgba(80,50,160,0.4)',   // 淡紫晨光
    radial2: 'rgba(180,100,140,0.25)',
    starOpacity: 0.5,
  },
  '上午': {
    period: '上午',
    radial1: 'rgba(100,60,180,0.3)',
    radial2: 'rgba(200,120,160,0.2)',
    starOpacity: 0.3,
  },
  '中午': {
    period: '中午',
    radial1: 'rgba(120,80,200,0.25)',
    radial2: 'rgba(220,140,180,0.15)',
    starOpacity: 0.15,
  },
  '下午': {
    period: '下午',
    radial1: 'rgba(90,50,160,0.3)',
    radial2: 'rgba(180,90,140,0.2)',
    starOpacity: 0.25,
  },
  '傍晚': {
    period: '傍晚',
    radial1: 'rgba(60,20,100,0.5)',
    radial2: 'rgba(160,40,100,0.35)',
    starOpacity: 0.5,
  },
  '晚上': {
    period: '晚上',
    radial1: 'rgba(40,15,80,0.55)',
    radial2: 'rgba(100,25,80,0.4)',
    starOpacity: 0.7,
  },
};

function getTimePeriod(hour: number): TimePeriod {
  if (hour >= 23 || hour < 4)  return '深夜';
  if (hour >= 4  && hour < 6)  return '凌晨';
  if (hour >= 6  && hour < 8)  return '早晨';
  if (hour >= 8  && hour < 11) return '上午';
  if (hour >= 11 && hour < 13) return '中午';
  if (hour >= 13 && hour < 17) return '下午';
  if (hour >= 17 && hour < 19) return '傍晚';
  return '晚上';
}

/** 崽崽小屋 — 日夜渐变背景 + 扫描线质感层 */
export function TimeAwareBackground() {
  const [theme, setTheme] = useState<TimeTheme>(() => {
    const period = getTimePeriod(new Date().getHours());
    return THEMES[period];
  });

  useEffect(() => {
    // 每分钟检查一次时间是否跨时段
    const timer = setInterval(() => {
      const period = getTimePeriod(new Date().getHours());
      setTheme(THEMES[period]);
    }, 60_000);
    return () => clearInterval(timer);
  }, []);

  return (
    <>
      {/* 基础渐变底色 — 始终深色 */}
      <div
        className="fixed inset-0 pointer-events-none z-0 transition-all duration-2000"
        style={{ background: 'linear-gradient(135deg, #0d0d1a 0%, #13132a 50%, #0d0d1a 100%)' }}
      />

      {/* 右上角径向光晕 */}
      <div
        className="fixed pointer-events-none z-0 transition-all duration-2000"
        style={{
          inset: 0,
          background: `radial-gradient(ellipse_at_top_right, ${theme.radial1} 0%, transparent 65%)`,
        }}
      />

      {/* 左下角径向光晕 */}
      <div
        className="fixed pointer-events-none z-0 transition-all duration-2000"
        style={{
          inset: 0,
          background: `radial-gradient(ellipse_at_bottom_left, ${theme.radial2} 0%, transparent 55%)`,
        }}
      />

      {/* 星空粒子 — 透明度随时间段变化 */}
      <div
        className="fixed inset-0 pointer-events-none z-[1]"
        style={{ opacity: theme.starOpacity }}
      >
        <StarryBackground />
      </div>

      {/* 扫描线质感层 */}
      <div
        className="fixed inset-0 pointer-events-none z-[2] opacity-[0.025]"
        style={{
          backgroundImage:
            'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(255,255,255,0.4) 2px, rgba(255,255,255,0.4) 3px)',
        }}
      />

      {/* 噪点纹理层 */}
      <NoiseTexture />
    </>
  );
}

/** 噪点 Canvas 层 */
function NoiseTexture() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // 生成静态噪点图（200x200），然后平铺
    const SIZE = 200;
    canvas.width = SIZE;
    canvas.height = SIZE;
    const imageData = ctx.createImageData(SIZE, SIZE);
    const buf = imageData.data;
    for (let i = 0; i < buf.length; i += 4) {
      const v = Math.random() * 255;
      buf[i] = v;     // R
      buf[i + 1] = v; // G
      buf[i + 2] = v; // B
      buf[i + 3] = 18; // A — 极淡噪点
    }
    ctx.putImageData(imageData, 0, 0);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 pointer-events-none z-[1] opacity-[0.04]"
      style={{ width: '100%', height: '100%', objectFit: 'cover', mixBlendMode: 'overlay' }}
    />
  );
}
