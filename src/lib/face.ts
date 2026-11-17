/**
 * Face recognition helpers (face-api / TensorFlow.js, runs fully in the browser).
 * The heavy library + models (~7 MB, cached by the browser) load only when a
 * face scan is actually needed.
 */
import type * as FaceApiNS from '@vladmandic/face-api';

export type FaceApi = typeof FaceApiNS;
type Pt = { x: number; y: number };

let loading: Promise<FaceApi> | null = null;

export function loadFaceApi(): Promise<FaceApi> {
  loading ??= (async () => {
    const faceapi = (await import('@vladmandic/face-api')) as unknown as FaceApi;
    const tf = faceapi.tf as unknown as { setBackend(b: string): Promise<boolean>; ready(): Promise<void> };
    try {
      await tf.setBackend('webgl');
    } catch {
      /* falls back to cpu/wasm */
    }
    await tf.ready();
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri('/models'),
      faceapi.nets.faceLandmark68Net.loadFromUri('/models'),
      faceapi.nets.faceRecognitionNet.loadFromUri('/models'),
    ]);
    return faceapi;
  })().catch((e) => {
    loading = null; // allow retry
    throw e;
  });
  return loading;
}

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

/** Eye aspect ratio — drops sharply when the eye closes (blink). */
export function eyeAspectRatio(eye: Pt[]): number {
  if (eye.length < 6) return 0;
  return (dist(eye[1]!, eye[5]!) + dist(eye[2]!, eye[4]!)) / (2 * dist(eye[0]!, eye[3]!));
}

/** Average several descriptors (more stable than a single frame), rounded for a compact payload. */
export function averageDescriptor(list: Float32Array[]): number[] {
  const out = new Array<number>(128).fill(0);
  for (const d of list) for (let i = 0; i < 128; i++) out[i]! += d[i]! / list.length;
  return out.map((v) => Math.round(v * 1e5) / 1e5);
}
