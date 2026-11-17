import { useCallback, useEffect, useRef, useState } from 'react';
import { Coins, CreditCard, Heart, Receipt, ScanBarcode, ShoppingBag, Sparkles, Tag } from 'lucide-react';
import { BRAND } from '../lib/format';
import trolleyData from '../assets/trolley.json';
import './intro.css';

/**
 * TapBenta intro (~5 s)
 *   pastel aurora wakes up → the trolley rolls in → glass chips (tags, coins,
 *   receipts…) pop around it → confetti burst → "TapBenta" springs up →
 *   the trolley dashes off and a circle wipe reveals the sign-in page.
 * Click / tap / any key skips straight to the exit.
 */
const AUTO_EXIT = 4300; // ms after start → exit begins
const EXIT_MS = 650;

const CHIPS = [
  { Icon: Tag, x: -250, y: -120, c: '#ff7eb8', d: 0.95, depth: 1.2 },
  { Icon: Coins, x: 250, y: -140, c: '#f4c95d', d: 1.05, depth: 0.8 },
  { Icon: ScanBarcode, x: -300, y: 40, c: '#6583fe', d: 1.15, depth: 1.5 },
  { Icon: Receipt, x: 300, y: 30, c: '#00d890', d: 1.25, depth: 1.1 },
  { Icon: CreditCard, x: -215, y: 140, c: '#8f86f0', d: 1.35, depth: 0.7 },
  { Icon: ShoppingBag, x: 225, y: 145, c: '#ff5ba8', d: 1.45, depth: 1.3 },
  { Icon: Heart, x: -95, y: -200, c: '#ff7eb8', d: 1.55, depth: 0.6, small: true },
  { Icon: Sparkles, x: 110, y: -205, c: '#c9b400', d: 1.6, depth: 0.9, small: true },
];

const CONFETTI = Array.from({ length: 26 }, (_, i) => {
  const a = (i / 26) * Math.PI * 2;
  const r = 150 + ((i * 37) % 90);
  return {
    x: Math.cos(a) * r,
    y: Math.sin(a) * r * 0.75 - 40,
    rot: (i * 47) % 360,
    c: ['#ff7eb8', '#6583fe', '#00d890', '#f4c95d', '#cbc6f8', '#d6e26b'][i % 6],
    shape: i % 3,
    delay: 1.75 + (i % 5) * 0.03,
  };
});

export default function StoreIntro({ onDone }: { onDone: () => void }) {
  const [leaving, setLeaving] = useState(false);
  const done = useRef(false);
  const root = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);

  const finish = useCallback(() => {
    if (done.current) return;
    done.current = true;
    setLeaving(true);
    setTimeout(onDone, EXIT_MS);
  }, [onDone]);

  // Trolley (Lottie, SVG renderer) — loaded lazily so it never weighs on the app itself
  useEffect(() => {
    let anim: { destroy: () => void } | null = null;
    let cancelled = false;
    import('lottie-web/build/player/lottie_light').then(({ default: lottie }) => {
      if (cancelled || !stage.current) return;
      anim = lottie.loadAnimation({
        container: stage.current,
        renderer: 'svg',
        loop: true,
        autoplay: true,
        animationData: trolleyData,
        rendererSettings: { preserveAspectRatio: 'xMidYMid meet', progressiveLoad: false },
      });
    });
    return () => {
      cancelled = true;
      anim?.destroy();
    };
  }, []);

  useEffect(() => {
    const t = setTimeout(finish, AUTO_EXIT);
    const onKey = () => finish();
    window.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener('keydown', onKey);
    };
  }, [finish]);

  // Pointer / tilt parallax
  useEffect(() => {
    const set = (x: number, y: number) => {
      root.current?.style.setProperty('--px', x.toFixed(3));
      root.current?.style.setProperty('--py', y.toFixed(3));
    };
    const onMove = (e: PointerEvent) => set((e.clientX / window.innerWidth) * 2 - 1, (e.clientY / window.innerHeight) * 2 - 1);
    const onTilt = (e: DeviceOrientationEvent) => {
      if (e.gamma == null || e.beta == null) return;
      set(Math.max(-1, Math.min(1, e.gamma / 25)), Math.max(-1, Math.min(1, (e.beta - 45) / 25)));
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('deviceorientation', onTilt);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('deviceorientation', onTilt);
    };
  }, []);

  const second = BRAND.second.split('');

  return (
    <div
      ref={root}
      className={`tb ${leaving ? 'leave' : ''}`}
      onPointerDown={finish}
      role="presentation"
      aria-label={`${BRAND.first}${BRAND.second} intro — click anywhere to skip`}
    >
      {/* aurora background */}
      <div className="tb-aurora" aria-hidden>
        <span className="au a1" />
        <span className="au a2" />
        <span className="au a3" />
        <span className="au a4" />
      </div>
      <div className="tb-grid" aria-hidden />
      <div className="tb-grain" aria-hidden />

      <div className="tb-center">
        {/* stage: rings, speed lines, chips, trolley */}
        <div className="tb-stage-wrap">
          <div className="tb-rings" aria-hidden>
            <i />
            <i />
            <i />
          </div>
          <div className="tb-speed" aria-hidden>
            {[0, 1, 2, 3, 4].map((i) => (
              <i key={i} style={{ top: `${28 + i * 11}%`, animationDelay: `${i * 0.06}s` }} />
            ))}
          </div>

          {CHIPS.map(({ Icon, x, y, c, d, depth, small }, i) => (
            <div
              key={i}
              className={`tb-chip ${small ? 'sm' : ''}`}
              style={
                {
                  '--x': `${x}px`,
                  '--y': `${y}px`,
                  '--c': c,
                  '--depth': depth,
                  animationDelay: `${d}s`,
                } as React.CSSProperties
              }
            >
              <span style={{ animationDelay: `${(i % 4) * 0.4}s` }}>
                <Icon size={small ? 16 : 22} strokeWidth={2} />
              </span>
            </div>
          ))}

          <div className="tb-confetti" aria-hidden>
            {CONFETTI.map((p, i) => (
              <i
                key={i}
                className={`s${p.shape}`}
                style={{ '--x': `${p.x}px`, '--y': `${p.y}px`, '--r': `${p.rot}deg`, background: p.c, animationDelay: `${p.delay}s` } as React.CSSProperties}
              />
            ))}
          </div>

          <div className="tb-trolley">
            <div className="tb-shadow" />
            <div ref={stage} className="tb-lottie" />
          </div>
        </div>

        {/* wordmark */}
        <h1 className="tb-title" aria-label={`${BRAND.first}${BRAND.second}`}>
          <span className="tb-first">
            {BRAND.first.split('').map((ch, i) => (
              <span key={i} style={{ animationDelay: `${2.05 + i * 0.06}s` }}>
                {ch}
              </span>
            ))}
          </span>
          <span className="tb-second">
            {second.map((ch, i) => (
              <span key={i} style={{ animationDelay: `${2.25 + i * 0.06}s` }}>
                {ch}
              </span>
            ))}
          </span>
          <svg className="tb-swoosh" viewBox="0 0 300 30" preserveAspectRatio="none" aria-hidden>
            <defs>
              <linearGradient id="tb-sw" x1="0" x2="1">
                <stop offset="0" stopColor="#00d890" />
                <stop offset="0.5" stopColor="#6583fe" />
                <stop offset="1" stopColor="#ff7eb8" />
              </linearGradient>
            </defs>
            <path d="M6 20 C 70 6, 150 4, 294 14" />
          </svg>
        </h1>
        <p className="tb-tagline">
          <span>Tap.</span> <span>Scan.</span> <span>Benta.</span>
        </p>
      </div>

      <div className="tb-ui">
        <span className="tb-skip">Click anywhere to skip</span>
        <div className="tb-progress">
          <i style={{ animationDuration: `${AUTO_EXIT}ms` }} />
        </div>
      </div>
    </div>
  );
}
