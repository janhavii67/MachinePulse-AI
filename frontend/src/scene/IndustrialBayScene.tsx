import React, { useEffect, useState, useRef, Suspense } from 'react';
import * as THREE from 'three';
import { Canvas } from '@react-three/fiber';
import { RoboticArm } from './RoboticArm';
import { GearAssembly } from './GearAssembly';
import { AtmosphereAndLighting } from './AtmosphereAndLighting';
import { CameraController } from './CameraController';
import { detectWebGLSupport, getDeviceQualitySettings, type QualitySettings } from './WebGLSupport';
import { SceneErrorBoundary } from './SceneErrorBoundary';
import { StaticFallbackHero } from './StaticFallbackHero';

export interface IndustrialBaySceneProps {
  simulatorStatus?: 'running' | 'paused' | 'stopped';
  rotationalSpeedRpm?: number;
  riskTier?: string;
  failureProbability?: number;
  isOnline?: boolean;
}

export const IndustrialBayScene: React.FC<IndustrialBaySceneProps> = ({
  simulatorStatus = 'stopped',
  rotationalSpeedRpm = 1500,
  riskTier = 'NORMAL',
  failureProbability = 0,
  isOnline = true,
}) => {
  const [hasWebGL, setHasWebGL] = useState<boolean>(true);
  const [quality, setQuality] = useState<QualitySettings | null>(null);
  const [isIntersecting, setIsIntersecting] = useState<boolean>(true);
  const [reducedMotion, setReducedMotion] = useState<boolean>(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // 1. WebGL Support verification
    const supported = detectWebGLSupport();
    setHasWebGL(supported);
    if (!supported) return;

    // 2. Hardware Quality Tier Detection
    const q = getDeviceQualitySettings();
    setQuality(q);

    // 3. Check prefers-reduced-motion media query
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(mediaQuery.matches);
    const handleMotionChange = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mediaQuery.addEventListener('change', handleMotionChange);

    // 4. IntersectionObserver: pause frameloop when canvas scrolls off screen
    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsIntersecting(entry.isIntersecting);
      },
      { threshold: 0.05 }
    );

    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    // 5. Page Visibility: pause when browser tab is inactive/hidden
    const handleVisibilityChange = () => {
      if (document.hidden) {
        setIsIntersecting(false);
      } else if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        setIsIntersecting(rect.bottom > 0 && rect.top < window.innerHeight);
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      mediaQuery.removeEventListener('change', handleMotionChange);
      observer.disconnect();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  // WebGL Fallback if device lacks hardware acceleration
  if (!hasWebGL) {
    return (
      <StaticFallbackHero
        simulatorStatus={simulatorStatus}
        failureProbability={failureProbability}
        riskTier={riskTier}
        message="WebGL hardware acceleration unavailable on this device. Displaying 2D telemetry schematic."
      />
    );
  }

  const isRunning = simulatorStatus === 'running';

  return (
    <SceneErrorBoundary
      fallbackProps={{
        simulatorStatus,
        failureProbability,
        riskTier,
      }}
    >
      <div
        ref={containerRef}
        style={{
          position: 'relative',
          width: '100%',
          height: '100%',
          minHeight: '420px',
          overflow: 'hidden',
          borderRadius: 'var(--radius-xl)',
          background: '#04060a',
          border: '1px solid var(--color-border-glass)',
          boxShadow: 'var(--shadow-lg)',
        }}
        role="region"
        aria-label="3D Industrial Robotic Arm and Precision Digital Twin Scene"
      >
        <Canvas
          shadows={quality?.shadows ?? true}
          dpr={quality?.dpr ?? 1.5}
          frameloop={isIntersecting ? 'always' : 'never'} // Energy saver: pause when offscreen
          camera={{
            position: [0.95, 2.40, 5.6],
            fov: 40,
            near: 0.1,
            far: 40,
          }}
          gl={{
            antialias: quality?.antialias ?? true,
            powerPreference: 'high-performance',
            toneMapping: THREE.ACESFilmicToneMapping,
            toneMappingExposure: 1.25,
            outputColorSpace: THREE.SRGBColorSpace,
          }}
          onCreated={({ gl }) => {
            gl.setClearColor('#04060a');
            const canvasEl = gl.domElement;
            const handleContextLost = (e: Event) => {
              e.preventDefault();
              console.warn('WebGL Context Lost in Machine Bay Scene.');
            };
            canvasEl.addEventListener('webglcontextlost', handleContextLost, false);
          }}
        >
          <Suspense fallback={null}>
            {/* Cinematic Camera Controller */}
            <CameraController reducedMotion={reducedMotion} />

            {/* Atmosphere, Lights, Fog & Micro-Dust */}
            <AtmosphereAndLighting
              shadows={quality?.shadows ?? true}
              shadowMapSize={quality?.shadowMapSize ?? 1024}
              particleCount={quality?.particleCount ?? 60}
              reducedMotion={reducedMotion}
            />

            {/* Photorealistic 6-Axis Robotic Arm with Workpiece & Workstation */}
            <RoboticArm
              simulatorStatus={simulatorStatus}
              rotationalSpeedRpm={rotationalSpeedRpm}
              riskTier={riskTier}
              isOnline={isOnline}
              reducedMotion={reducedMotion}
            />

            {/* Meshing Precision Gear Assembly */}
            <GearAssembly isRunning={isRunning} reducedMotion={reducedMotion} />
          </Suspense>
        </Canvas>

        {/* Small Discreet Machine Legend Caption */}
        <div
          style={{
            position: 'absolute',
            bottom: '12px',
            right: '16px',
            zIndex: 10,
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            padding: '6px 14px',
            borderRadius: 'var(--radius-full)',
            background: 'rgba(4, 6, 10, 0.82)',
            backdropFilter: 'blur(12px)',
            border: '1px solid var(--color-border-glass)',
            fontSize: '0.78rem',
            color: 'var(--color-text-secondary)',
            pointerEvents: 'none',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#00b4d8' }} />
            <span>Decorative mechanical animation</span>
          </div>
          <span style={{ color: 'var(--color-border-metal)' }}>|</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background:
                  !isOnline ? '#ef4444' :
                  simulatorStatus === 'stopped' ? '#64748b' :
                  riskTier === 'CRITICAL' ? '#ef4444' :
                  riskTier === 'HIGH' ? '#f97316' :
                  riskTier === 'WATCH' ? '#f59e0b' : '#00b4d8',
                boxShadow: `0 0 8px ${
                  !isOnline ? '#ef4444' :
                  simulatorStatus === 'stopped' ? '#64748b' :
                  riskTier === 'CRITICAL' ? '#ef4444' :
                  riskTier === 'HIGH' ? '#f97316' :
                  riskTier === 'WATCH' ? '#f59e0b' : '#00b4d8'
                }`,
              }}
            />
            <span>Data-driven status indicators ({simulatorStatus.toUpperCase()})</span>
          </div>
        </div>
      </div>
    </SceneErrorBoundary>
  );
};

export default IndustrialBayScene;
