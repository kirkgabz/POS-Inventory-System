import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CameraOff, Eye, Loader2, RefreshCw, ScanFace, ShieldCheck, X } from 'lucide-react';
import { averageDescriptor, eyeAspectRatio, loadFaceApi, type FaceApi } from '../lib/face';

type Step = 'loading' | 'position' | 'blink' | 'capture' | 'done' | 'error' | 'timeout';

interface Props {
  mode: 'enroll' | 'verify';
  title: string;
  subtitle?: string;
  onResult: (descriptor: number[]) => void;
  onCancel: () => void;
}

const TIMEOUT_MS = 40000;

/**
 * Live face scan with a simple liveness check (the person must blink),
 * so a printed photo or a still picture on a phone is not enough.
 */
export default function FaceScanner({ mode, title, subtitle, onResult, onCancel }: Props) {
  const video = useRef<HTMLVideoElement>(null);
  const [step, setStep] = useState<Step>('loading');
  const [hint, setHint] = useState('Starting camera…');
  const [progress, setProgress] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState('');

  useEffect(() => {
    let stream: MediaStream | null = null;
    let stopped = false;
    let faceapi: FaceApi;
    const started = Date.now();
    setStep('loading');
    setProgress(0);
    setHint('Starting camera…');

    const stop = () => {
      stopped = true;
      stream?.getTracks().forEach((t) => t.stop());
    };

    (async () => {
      try {
        const [api, s] = await Promise.all([
          loadFaceApi(),
          navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false }),
        ]);
        faceapi = api;
        stream = s;
        if (stopped) return stop();
        const v = video.current!;
        v.srcObject = s;
        await v.play();
      } catch (e) {
        if (stopped) return;
        const msg = String((e as Error)?.message ?? e);
        setError(
          /permission|notallowed/i.test(msg)
            ? 'Camera permission was denied. Allow camera access for this site and try again.'
            : /secure|https/i.test(msg)
              ? 'The camera only works on HTTPS (or localhost).'
              : /fetch|load|model/i.test(msg)
                ? 'Could not load the face recognition files. Check your internet connection.'
                : 'No camera found, or it is being used by another app.',
        );
        setStep('error');
        return;
      }

      const opts = new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 });
      let openEar = 0;
      let frames = 0;
      let closed = false;
      let blinked = false;
      const samples: Float32Array[] = [];
      const need = mode === 'enroll' ? 6 : 3;

      setStep('position');
      setHint('Center your face in the circle');

      const loop = async () => {
        if (stopped) return;
        if (Date.now() - started > TIMEOUT_MS) {
          setStep('timeout');
          return stop();
        }
        const v = video.current;
        if (!v || v.readyState < 2) return void setTimeout(loop, 120);

        try {
          if (!blinked) {
            const faces = await faceapi.detectAllFaces(v, opts).withFaceLandmarks();
            if (faces.length !== 1) {
              setStep('position');
              setHint(faces.length === 0 ? 'Center your face in the circle' : 'Only one person in front of the camera, please');
              frames = 0;
              return void setTimeout(loop, 90);
            }
            const f = faces[0]!;
            const box = f.detection.box;
            const cx = (box.x + box.width / 2) / v.videoWidth;
            const cy = (box.y + box.height / 2) / v.videoHeight;
            const size = box.width / v.videoWidth;
            if (size < 0.2) {
              setStep('position');
              setHint('Come a little closer');
              return void setTimeout(loop, 90);
            }
            if (Math.abs(cx - 0.5) > 0.18 || Math.abs(cy - 0.5) > 0.2) {
              setStep('position');
              setHint('Move your face to the center');
              return void setTimeout(loop, 90);
            }
            const ear = (eyeAspectRatio(f.landmarks.getLeftEye()) + eyeAspectRatio(f.landmarks.getRightEye())) / 2;
            frames++;
            if (!closed) openEar = frames === 1 ? ear : Math.max(openEar * 0.97, ear * 0.3 + openEar * 0.7);
            if (frames < 4) {
              setStep('blink');
              setHint('Look at the camera…');
              setProgress(0.15);
              return void setTimeout(loop, 70);
            }
            setStep('blink');
            setHint('Now blink once');
            setProgress(0.3);
            if (!closed && ear < openEar * 0.72) closed = true;
            else if (closed && ear > openEar * 0.88) {
              blinked = true;
              setStep('capture');
              setHint(mode === 'enroll' ? 'Hold still — saving your face' : 'Hold still — checking…');
            }
            return void setTimeout(loop, 50);
          }

          // collect descriptors after the liveness check
          const r = await faceapi.detectSingleFace(v, opts).withFaceLandmarks().withFaceDescriptor();
          if (r && r.detection.box.width / v.videoWidth >= 0.18) {
            samples.push(r.descriptor);
            setProgress(0.3 + 0.7 * (samples.length / need));
          }
          if (samples.length >= need) {
            setStep('done');
            setHint(mode === 'enroll' ? 'Face saved' : 'Face captured');
            stop();
            setTimeout(() => onResult(averageDescriptor(samples)), 450);
            return;
          }
          setTimeout(loop, 110);
        } catch {
          setTimeout(loop, 200);
        }
      };
      loop();
    })();

    return stop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt, mode]);

  const ring = Math.round(progress * 100);
  const stepIndex = { loading: 0, position: 0, blink: 1, capture: 2, done: 3, error: 0, timeout: 0 }[step];

  return createPortal(
    <div className="face-backdrop">
      <div className={`face-card face-${step}`} role="dialog" aria-modal="true">
        <button className="icon-btn face-close" onClick={onCancel} aria-label="Cancel">
          <X size={18} />
        </button>
        <h2 className="display">{title}</h2>
        {subtitle && <p className="muted small">{subtitle}</p>}

        <div className="face-stage" style={{ '--p': `${ring}%` } as React.CSSProperties}>
          <div className="face-ring" />
          <div className="face-circle">
            <video ref={video} playsInline muted />
            {step === 'loading' && (
              <div className="face-overlay">
                <Loader2 size={30} className="spin" />
              </div>
            )}
            {(step === 'error' || step === 'timeout') && (
              <div className="face-overlay">
                <CameraOff size={30} strokeWidth={1.4} />
              </div>
            )}
            {step === 'done' && (
              <div className="face-overlay ok">
                <ShieldCheck size={44} />
              </div>
            )}
            <span className="face-scanline" />
          </div>
        </div>

        <p className="face-hint" key={hint}>
          {step === 'error' ? error : step === 'timeout' ? "We couldn't finish the scan. Make sure your face is well lit and blink once." : hint}
        </p>

        <ol className="face-steps">
          {[
            { icon: <ScanFace size={14} />, label: 'Face' },
            { icon: <Eye size={14} />, label: 'Blink' },
            { icon: <ShieldCheck size={14} />, label: mode === 'enroll' ? 'Save' : 'Match' },
          ].map((s, i) => (
            <li key={s.label} className={i < stepIndex ? 'done' : i === stepIndex ? 'on' : ''}>
              {s.icon} {s.label}
            </li>
          ))}
        </ol>

        {(step === 'error' || step === 'timeout') && (
          <button className="btn btn-primary" onClick={() => setAttempt((a) => a + 1)}>
            <RefreshCw size={15} /> Try again
          </button>
        )}
      </div>
    </div>,
    document.body,
  );
}
