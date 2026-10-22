import React, { useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';

interface GearAssemblyProps {
  isRunning?: boolean;
  reducedMotion?: boolean;
}

export const GearAssembly: React.FC<GearAssemblyProps> = ({
  isRunning = false,
  reducedMotion = false,
}) => {
  const driverGearRef = useRef<THREE.Group>(null);
  const drivenGearRef = useRef<THREE.Group>(null);
  const flywheelRef = useRef<THREE.Group>(null);

  // Exact 2:1 gear ratio: Driver (16 teeth, radius 0.52) meshes with Driven (8 teeth, radius 0.26)
  useFrame((_, delta) => {
    if (reducedMotion) return;
    const baseSpeed = isRunning ? 2.2 : 0.4;

    if (driverGearRef.current) {
      driverGearRef.current.rotation.z += delta * baseSpeed;
    }
    if (drivenGearRef.current) {
      drivenGearRef.current.rotation.z -= delta * (baseSpeed * 2.0); // Exact 2:1 counter-rotation
    }
    if (flywheelRef.current) {
      flywheelRef.current.rotation.x += delta * (baseSpeed * 1.5);
    }
  });

  return (
    // Positioned neatly to the right edge of the worktable
    <group position={[3.6, 0.44, 0.1]}>
      {/* Precision Machined Aluminum Gearbox Mount Plate */}
      <mesh position={[0, 0.12, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.5, 0.24, 1.2]} />
        <meshStandardMaterial color="#1e2634" roughness={0.35} metalness={0.9} />
      </mesh>

      {/* Main Drive Shaft Bearing Block */}
      <mesh position={[-0.32, 0.35, 0]} castShadow>
        <boxGeometry args={[0.22, 0.46, 0.32]} />
        <meshStandardMaterial color="#2d3748" roughness={0.28} metalness={0.92} />
      </mesh>

      {/* Secondary High-Speed Bearing Block */}
      <mesh position={[0.46, 0.35, 0]} castShadow>
        <boxGeometry args={[0.22, 0.38, 0.32]} />
        <meshStandardMaterial color="#2d3748" roughness={0.28} metalness={0.92} />
      </mesh>

      {/* ── Gear 1: Driver Gear (16 Teeth, Radius 0.52) ── */}
      <group ref={driverGearRef} position={[-0.32, 0.35, 0.22]}>
        {/* Central Hub & Web Disc */}
        <mesh rotation={[Math.PI / 2, 0, 0]} castShadow>
          <cylinderGeometry args={[0.52, 0.52, 0.1, 32]} />
          <meshStandardMaterial color="#38bdf8" metalness={0.94} roughness={0.16} />
        </mesh>
        <mesh position={[0, 0, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.24, 0.24, 0.14, 24]} />
          <meshStandardMaterial color="#cbd5e1" metalness={0.98} roughness={0.1} />
        </mesh>

        {/* 16 Teeth around perimeter */}
        {Array.from({ length: 16 }).map((_, i) => {
          const angle = (i * 2 * Math.PI) / 16;
          const tx = Math.cos(angle) * 0.55;
          const ty = Math.sin(angle) * 0.55;
          return (
            <mesh key={i} position={[tx, ty, 0]} rotation={[0, 0, angle]} castShadow>
              <boxGeometry args={[0.09, 0.08, 0.1]} />
              <meshStandardMaterial color="#0284c7" metalness={0.92} roughness={0.2} />
            </mesh>
          );
        })}
      </group>

      {/* ── Gear 2: Driven Gear (8 Teeth, Radius 0.26) ── */}
      {/* Placed at distance = 0.52 + 0.26 = 0.78 in X axis */}
      <group ref={drivenGearRef} position={[0.46, 0.35, 0.22]}>
        {/* Hub Disc */}
        <mesh rotation={[Math.PI / 2, 0, 0]} castShadow>
          <cylinderGeometry args={[0.26, 0.26, 0.1, 24]} />
          <meshStandardMaterial color="#cbd5e1" metalness={0.96} roughness={0.12} />
        </mesh>

        {/* 8 Teeth around perimeter */}
        {Array.from({ length: 8 }).map((_, i) => {
          const angle = (i * 2 * Math.PI) / 8 + Math.PI / 16; // Interlocking tooth phase
          const tx = Math.cos(angle) * 0.285;
          const ty = Math.sin(angle) * 0.285;
          return (
            <mesh key={i} position={[tx, ty, 0]} rotation={[0, 0, angle]} castShadow>
              <boxGeometry args={[0.08, 0.07, 0.1]} />
              <meshStandardMaterial color="#94a3b8" metalness={0.95} roughness={0.18} />
            </mesh>
          );
        })}
      </group>

      {/* ── Precision Flywheel / Coupling on Rear Shaft ── */}
      <group ref={flywheelRef} position={[-0.32, 0.35, -0.24]}>
        <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[0.42, 0.42, 0.12, 32]} />
          <meshStandardMaterial color="#1e293b" metalness={0.92} roughness={0.22} />
        </mesh>
        <mesh rotation={[0, 0, Math.PI / 2]}>
          <torusGeometry args={[0.38, 0.03, 12, 24]} />
          <meshStandardMaterial color="#0099ff" emissive="#0088ff" emissiveIntensity={0.6} metalness={0.8} />
        </mesh>
      </group>
    </group>
  );
};
