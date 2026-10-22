import React, { useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';

interface CentralMachineProps {
  rotationalSpeedRpm?: number;
  isRunning?: boolean;
  reducedMotion?: boolean;
}

export const CentralMachine: React.FC<CentralMachineProps> = ({
  rotationalSpeedRpm = 1500,
  isRunning = false,
  reducedMotion = false,
}) => {
  const spindleRef = useRef<THREE.Group>(null);
  const toolChuckRef = useRef<THREE.Mesh>(null);
  const coolingTurbineRef = useRef<THREE.Group>(null);

  // Mechanical rotation driven strictly by delta time
  useFrame((_, delta) => {
    if (reducedMotion) return;
    const speedFactor = isRunning ? Math.min(Math.max(rotationalSpeedRpm / 600, 1.2), 4.5) : 0.4;
    
    if (spindleRef.current) {
      spindleRef.current.rotation.y += delta * speedFactor * 3.5;
    }
    if (coolingTurbineRef.current) {
      coolingTurbineRef.current.rotation.y -= delta * speedFactor * 5.0;
    }
  });

  return (
    <group position={[0, 0, 0]}>
      {/* Heavy Industrial Cast Base / Plinth */}
      <mesh position={[0, 0.4, 0]} castShadow receiveShadow>
        <boxGeometry args={[4.2, 0.8, 3.4]} />
        <meshStandardMaterial color="#171b24" roughness={0.4} metalness={0.8} />
      </mesh>

      {/* Base Bevel Frame / Floor Mount Plate */}
      <mesh position={[0, 0.05, 0]} receiveShadow>
        <boxGeometry args={[4.8, 0.1, 4.0]} />
        <meshStandardMaterial color="#0f131a" roughness={0.6} metalness={0.65} />
      </mesh>

      {/* Vibration Dampening Anchor Bolts (Instanced/Repeated at corners) */}
      {[
        [-2.1, 0.15, -1.7],
        [2.1, 0.15, -1.7],
        [-2.1, 0.15, 1.7],
        [2.1, 0.15, 1.7],
      ].map(([x, y, z], i) => (
        <group key={i} position={[x, y, z]}>
          <mesh castShadow>
            <cylinderGeometry args={[0.08, 0.08, 0.2, 12]} />
            <meshStandardMaterial color="#64748b" metalness={0.9} roughness={0.25} />
          </mesh>
          <mesh position={[0, 0.12, 0]}>
            <cylinderGeometry args={[0.13, 0.13, 0.06, 6]} />
            <meshStandardMaterial color="#38bdf8" metalness={0.8} roughness={0.3} />
          </mesh>
        </group>
      ))}

      {/* Main Structural Vertical Column (Cast Iron Housing) */}
      <mesh position={[0, 2.5, -0.6]} castShadow receiveShadow>
        <boxGeometry args={[2.2, 3.4, 1.8]} />
        <meshStandardMaterial color="#1a202e" roughness={0.35} metalness={0.82} />
      </mesh>

      {/* Heavy Precision Guide Rails on Column */}
      <mesh position={[-0.75, 2.5, 0.32]} castShadow>
        <boxGeometry args={[0.12, 3.3, 0.06]} />
        <meshStandardMaterial color="#cbd5e1" metalness={0.95} roughness={0.12} />
      </mesh>
      <mesh position={[0.75, 2.5, 0.32]} castShadow>
        <boxGeometry args={[0.12, 3.3, 0.06]} />
        <meshStandardMaterial color="#cbd5e1" metalness={0.95} roughness={0.12} />
      </mesh>

      {/* Cooling Fins / Ribbed Heat Dissipation Array */}
      {[-0.8, -0.4, 0, 0.4, 0.8].map((yOffset, i) => (
        <mesh key={i} position={[0, 3.2 + yOffset, -1.52]} castShadow>
          <boxGeometry args={[1.9, 0.05, 0.2]} />
          <meshStandardMaterial color="#0e1626" metalness={0.7} roughness={0.4} />
        </mesh>
      ))}

      {/* Upper Motor Housing & Top Cowling */}
      <mesh position={[0, 4.4, -0.6]} castShadow>
        <cylinderGeometry args={[0.9, 1.1, 0.8, 24]} />
        <meshStandardMaterial color="#1e293b" metalness={0.85} roughness={0.25} />
      </mesh>

      {/* Top Exhaust Vent / Cooling Turbine Fan */}
      <group ref={coolingTurbineRef} position={[0, 4.85, -0.6]}>
        <mesh>
          <cylinderGeometry args={[0.6, 0.6, 0.1, 16]} />
          <meshStandardMaterial color="#334155" metalness={0.9} roughness={0.2} />
        </mesh>
        {[0, 45, 90, 135, 180, 225, 270, 315].map((deg) => (
          <mesh key={deg} rotation={[0, (deg * Math.PI) / 180, 0.2]}>
            <boxGeometry args={[0.5, 0.04, 0.08]} />
            <meshStandardMaterial color="#0ea5e9" metalness={0.8} roughness={0.2} />
          </mesh>
        ))}
      </group>

      {/* Main Spindle Head Carriage (Moving Y/Z Axis Block) */}
      <mesh position={[0, 2.4, 0.2]} castShadow receiveShadow>
        <boxGeometry args={[1.8, 1.8, 1.4]} />
        <meshStandardMaterial color="#253248" roughness={0.3} metalness={0.85} />
      </mesh>

      {/* Spindle Nose Casting */}
      <mesh position={[0, 1.35, 0.4]} castShadow>
        <cylinderGeometry args={[0.5, 0.65, 0.5, 24]} />
        <meshStandardMaterial color="#1e293b" metalness={0.9} roughness={0.2} />
      </mesh>

      {/* High-Speed Rotating Spindle Core Assembly */}
      <group ref={spindleRef} position={[0, 1.05, 0.4]}>
        {/* Precision Spindle Shaft */}
        <mesh castShadow>
          <cylinderGeometry args={[0.32, 0.32, 0.6, 24]} />
          <meshStandardMaterial color="#cbd5e1" metalness={0.96} roughness={0.12} />
        </mesh>

        {/* Industrial Tool Chuck with Chamfered Flanges */}
        <mesh ref={toolChuckRef} position={[0, -0.38, 0]} castShadow>
          <cylinderGeometry args={[0.38, 0.28, 0.35, 20]} />
          <meshStandardMaterial color="#38bdf8" metalness={0.92} roughness={0.18} />
        </mesh>

        {/* Cutting Tool / High-Precision Milling Endmill */}
        <mesh position={[0, -0.68, 0]} castShadow>
          <cylinderGeometry args={[0.1, 0.08, 0.32, 16]} />
          <meshStandardMaterial color="#e2e8f0" metalness={0.98} roughness={0.08} />
        </mesh>

        {/* Tool Wear Proxy Ring on Chuck (Color reflects physical tool interface) */}
        <mesh position={[0, -0.48, 0]}>
          <torusGeometry args={[0.32, 0.025, 12, 24]} />
          <meshStandardMaterial color="#0ea5e9" emissive="#0ea5e9" emissiveIntensity={0.6} metalness={0.8} />
        </mesh>
      </group>

      {/* Cable Carrier Track / Drag Chain across Spindle Column */}
      {[-0.3, -0.1, 0.1, 0.3, 0.5, 0.7].map((offset, idx) => (
        <mesh key={idx} position={[1.05, 2.0 + offset, -0.2 + offset * 0.4]} rotation={[0.4, 0, 0]}>
          <boxGeometry args={[0.16, 0.1, 0.18]} />
          <meshStandardMaterial color="#090d16" roughness={0.7} metalness={0.3} />
        </mesh>
      ))}

      {/* High-Voltage Conduit Tube Running down Column */}
      <mesh position={[-1.15, 2.3, -0.5]}>
        <cylinderGeometry args={[0.04, 0.04, 3.2, 12]} />
        <meshStandardMaterial color="#64748b" metalness={0.7} roughness={0.4} />
      </mesh>
    </group>
  );
};
