/**
 * WebGL feature and quality detection utility.
 */

export type QualityTier = 'high' | 'medium' | 'low';

export interface QualitySettings {
  tier: QualityTier;
  dpr: number;
  shadows: boolean;
  shadowMapSize: number;
  particleCount: number;
  postProcessing: boolean;
  reflections: boolean;
  antialias: boolean;
}

export function detectWebGLSupport(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    return Boolean(gl);
  } catch {
    return false;
  }
}

export function getDeviceQualitySettings(): QualitySettings {
  if (typeof window === 'undefined') {
    return {
      tier: 'medium',
      dpr: 1,
      shadows: false,
      shadowMapSize: 512,
      particleCount: 50,
      postProcessing: false,
      reflections: false,
      antialias: true,
    };
  }

  const isCoarsePointer = window.matchMedia?.('(pointer: coarse)').matches;
  const isMobileScreen = window.innerWidth < 768;
  const logicalProcessors = navigator.hardwareConcurrency || 4;
  const isLowPower = logicalProcessors <= 4 || isMobileScreen || isCoarsePointer;

  if (isLowPower) {
    return {
      tier: 'low',
      dpr: Math.min(window.devicePixelRatio || 1, 1.25),
      shadows: false,
      shadowMapSize: 512,
      particleCount: 40,
      postProcessing: false,
      reflections: false,
      antialias: true,
    };
  }

  if (window.innerWidth < 1200 || logicalProcessors <= 8) {
    return {
      tier: 'medium',
      dpr: Math.min(window.devicePixelRatio || 1, 1.5),
      shadows: true,
      shadowMapSize: 1024,
      particleCount: 80,
      postProcessing: false,
      reflections: false,
      antialias: true,
    };
  }

  return {
    tier: 'high',
    dpr: Math.min(window.devicePixelRatio || 1, 1.75),
    shadows: true,
    shadowMapSize: 2048,
    particleCount: 140,
    postProcessing: false,
    reflections: true,
    antialias: true,
  };
}
