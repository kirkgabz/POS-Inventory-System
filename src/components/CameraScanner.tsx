import { useEffect, useRef, useState } from 'react';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import { CameraOff, RefreshCw, SwitchCamera } from 'lucide-react';
import { normaliseCode } from '../lib/codes';

const FORMATS = [
  Html5QrcodeSupportedFormats.QR_CODE,
  Html5QrcodeSupportedFormats.CODE_128,
  Html5QrcodeSupportedFormats.CODE_39,
  Html5QrcodeSupportedFormats.EAN_13,
  Html5QrcodeSupportedFormats.EAN_8,
  Html5QrcodeSupportedFormats.UPC_A,
  Html5QrcodeSupportedFormats.UPC_E,
  Html5QrcodeSupportedFormats.ITF,
];

let audioCtx: AudioContext | null = null;
export function beep(ok = true) {
  try {
    audioCtx ??= new AudioContext();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.frequency.value = ok ? 1320 : 260;
    o.type = 'sine';
    g.gain.setValueAtTime(0.12, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.14);
    o.connect(g).connect(audioCtx.destination);
    o.start();
    o.stop(audioCtx.currentTime + 0.15);
  } catch {
    /* audio not available */
  }
  if (navigator.vibrate) navigator.vibrate(ok ? 40 : [60, 40, 60]);
}

interface Props {
  onScan: (code: string) => void;
  /** Keep scanning after a hit (POS) or stop after first hit (forms). */
  continuous?: boolean;
  /** Same code is ignored for this many ms (prevents double-adds). */
  cooldownMs?: number;
}

let instanceId = 0;

export default function CameraScanner({ onScan, continuous = true, cooldownMs = 1600 }: Props) {
  const [elId] = useState(() => `cam-${++instanceId}`);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const lastRef = useRef<{ code: string; at: number }>({ code: '', at: 0 });
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  const [cameras, setCameras] = useState<{ id: string; label: string }[]>([]);
  const [camIndex, setCamIndex] = useState<number>(-1); // -1 = rear camera by facingMode
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState(false);
  const [attempt, setAttempt] = useState(0);

  // start/stop calls are chained so they never overlap (StrictMode, fast toggling)
  const chainRef = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => {
    let cancelled = false;
    setError(null);
    const camera = camIndex >= 0 && cameras[camIndex] ? cameras[camIndex]!.id : { facingMode: 'environment' };

    chainRef.current = chainRef.current.then(() => {
      if (cancelled) return;
      const scanner = new Html5Qrcode(elId, { formatsToSupport: FORMATS, verbose: false });
      scannerRef.current = scanner;
      return scanner
      .start(
        camera,
        {
          fps: 12,
          qrbox: (w, h) => ({ width: Math.min(w * 0.85, 420), height: Math.min(h * 0.6, 220) }),
          aspectRatio: 1.6,
        },
        (text) => {
          const code = normaliseCode(text);
          const now = Date.now();
          if (code === lastRef.current.code && now - lastRef.current.at < cooldownMs) return;
          lastRef.current = { code, at: now };
          setFlash(true);
          setTimeout(() => setFlash(false), 350);
          onScanRef.current(code);
          if (!continuous) scanner.stop().catch(() => {});
        },
        () => {
          /* per-frame "not found" — ignore */
        },
      )
      .then(async () => {
        if (cancelled) return;
        if (!cameras.length) {
          try {
            const list = await Html5Qrcode.getCameras();
            if (!cancelled) setCameras(list);
          } catch {
            /* ignore */
          }
        }
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const msg = String((e as Error)?.message ?? e);
        setError(
          /permission|notallowed/i.test(msg)
            ? 'Camera permission was denied. Allow camera access in your browser settings.'
            : /secure|https/i.test(msg)
              ? 'The camera only works on HTTPS (or localhost).'
              : 'No camera found or it is being used by another app.',
        );
      });
    });

    return () => {
      cancelled = true;
      chainRef.current = chainRef.current.then(async () => {
        const s = scannerRef.current;
        scannerRef.current = null;
        if (!s) return;
        try {
          if (s.isScanning) await s.stop();
          s.clear();
        } catch {
          /* already stopped */
        }
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elId, camIndex, attempt, continuous, cooldownMs]);

  return (
    <div className={`scanner ${flash ? 'scanner-hit' : ''}`}>
      <div id={elId} className="scanner-view" />
      {!error && (
        <>
          <div className="scanner-frame" aria-hidden>
            <span /><span /><span /><span />
            <i className="scanner-laser" />
          </div>
          {cameras.length > 1 && (
            <button
              type="button"
              className="icon-btn scanner-switch"
              title="Switch camera"
              onClick={() => setCamIndex((i) => (i + 1) % cameras.length)}
            >
              <SwitchCamera size={18} />
            </button>
          )}
        </>
      )}
      {error && (
        <div className="scanner-error">
          <CameraOff size={28} strokeWidth={1.4} />
          <p>{error}</p>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAttempt((a) => a + 1)}>
            <RefreshCw size={14} /> Try again
          </button>
        </div>
      )}
    </div>
  );
}
