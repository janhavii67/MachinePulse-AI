import React, { useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';

interface ConveyorSystemProps {
  isRunning?: boolean;
  reducedMotion?: boolean;
}

export const ConveyorSystem: React.FC<ConveyorSystemProps> = ({
  isRunning = false,
  reducedMotion = false,
}) => {
  const partsGroupRef = useRef<THREE.Group>(null);
  const roller1Ref = useRef<THREE.Mesh>(null);
  const roller2Ref = useRef<THREE.Mesh>(null);

  // Smooth item progression along conveyor: length is 7 units (-3.5 to +3.5)
  const partOffsets = useRef([0, 1.75, 3.5, 5.25]);

  useFrame((_, delta) => {
    if (reducedMotion) return;
    const speed = isRunning ? 1.4 : 0.3;

    // Rollers rotation
    if (roller1Ref.current) roller1Ref.current.rotation.x += delta * speed * 3;
    if (roller2Ref.current) roller2Ref.current.rotation.x += delta * speed * 3;

    // Advance part positions and wrap around
    for (let i = 0; i < partOffsets.current.length; i++) {
      partOffsets.current[i] += delta * speed;
      if (partOffsets.current[i] > 7.0) {
        partOffsets.current[i] -= 7.0;
      }
    }

    if (partsGroupRef.current) {
      partsGroupRef.current.children.forEach((child, index) => {
        const localX = -3.5 + partOffsets.current[index];
        child.position.x = localX;
      });
    }
  });

  return (
    <group position={[0, 0, 2.2]}>
      {/* Conveyor Bed & Frame */}
      <mesh position={[0, 0.45, 0]} castShadow receiveShadow>
        <boxGeometry args={[7.2, 0.18, 0.9]} />
        <meshStandardMaterial color="#0f172a" roughness={0.5} metalness={0.7} />
      </mesh>

      {/* Low-Friction Belt Surface */}
      <mesh position={[0, 0.55, 0]} receiveShadow>
        <boxGeometry args={[7.0, 0.04, 0.74]} />
        <meshStandardMaterial color="#090d16" roughness={0.8} metalness={0.2} />
      </mesh>

      {/* Guide Side Rails */}
      <mesh position={[0, 0.65, 0.42]} castShadow>
        <boxGeometry args={[7.2, 0.16, 0.04]} />
        <meshStandardMaterial color="#38bdf8" metalness={0.8} roughness={0.25} />
      </mesh>
      <mesh position={[0, 0.65, -0.42]} castShadow>
        <boxGeometry args={[7.2, 0.16, 0.04]} />
        <meshStandardMaterial color="#38bdf8" metalness={0.8} roughness={0.25} />
      </mesh>

      {/* Left End Drum / Roller */}
      <mesh ref={roller1Ref} position={[-3.5, 0.45, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.15, 0.15, 0.8, 16]} />
        <meshStandardMaterial color="#cbd5e1" metalness={0.95} roughness={0.15} />
      </mesh>

      {/* Right End Drum / Roller */}
      <mesh ref={roller2Ref} position={[3.5, 0.45, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.15, 0.15, 0.8, 16]} />
        <meshStandardMaterial color="#cbd5e1" metalness={0.95} roughness={0.15} />
      </mesh>

      {/* Support Stanchions / Floor Legs */}
      {[-2.5, 0, 2.5].map((x) => (
        <group key={x} position={[x, 0.22, 0]}>
          <mesh castShadow>
            <cylinderGeometry args={[0.06, 0.08, 0.44, 12]} />
            <meshStandardMaterial color="#1e293b" metalness={0.8} roughness={0.3} />
          </mesh>
          <mesh position={[0, -0.2, 0]}>
            <boxGeometry args={[0.25, 0.04, 0.8]} />
            <meshStandardMaterial color="#0f172a" metalness={0.8} roughness={0.4} />
          </mesh>
        </group>
      ))}

      {/* ── Moving Machined Billets / Manufactured Parts ── */}
      <group ref={partsGroupRef} position={[0, 0.68, 0]}>
        {[0, 1, 2, 3].map((i) => (
          <group key={i} position={[-3.5 + i * 1.75, 0, 0]}>
            {/* Hexagonal Machined Billet */}
            <mesh castShadow>
              <cylinderGeometry args={[0.18, 0.18, 0.2, 6]} />
              <meshStandardMaterial color="#cbd5e1" metalness={0.95} roughness={0.18} />
            </mesh>
            {/* Machined Bore Core */}
            <mesh position={[0, 0.11, 0]}>
              <cylinderGeometry args={[0.08, 0.08, 0.04, 16]} />
              <meshStandardMaterial color="#0ea5e9" metalness={0.8} roughness={0.3} />
            </mesh>
          </group>
        ))}
      </group>
    </group>
  );
};
