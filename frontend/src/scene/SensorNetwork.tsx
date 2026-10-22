import React, { useRef, useMemo } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';

interface SensorNetworkProps {
  riskTier?: string;
  simulatorStatus?: string;
  isOnline?: boolean;
  reducedMotion?: boolean;
}

export const SensorNetwork: React.FC<SensorNetworkProps> = ({
  riskTier = 'NORMAL',
  simulatorStatus = 'stopped',
  isOnline = true,
  reducedMotion = false,
}) => {
  const coreOuterRingRef = useRef<THREE.Group>(null);
  const coreInnerRingRef = useRef<THREE.Group>(null);
  const coreCrystalRef = useRef<THREE.Mesh>(null);
  const pulseGroupRef = useRef<THREE.Group>(null);

  // Active status color determined strictly by real telemetry state
  const tierColor = useMemo(() => {
    if (!isOnline) return '#ef4444'; // Red for offline
    if (simulatorStatus === 'stopped') return '#64748b'; // Neutral slate when stopped
    const tier = riskTier.toUpperCase();
    if (tier === 'CRITICAL') return '#ef4444';
    if (tier === 'HIGH') return '#f97316';
    if (tier === 'WATCH' || tier === 'WARNING') return '#f59e0b';
    return '#10b981'; // Normal emerald
  }, [riskTier, simulatorStatus, isOnline]);

  const emissiveIntensity = simulatorStatus === 'running' ? 1.6 : simulatorStatus === 'paused' ? 0.9 : 0.3;

  // Sensor Probe World Positions
  const sensorProbes = useMemo(() => [
    { name: 'Spindle Temperature Probe', pos: [0, 2.2, 0.9] as [number, number, number] },
    { name: 'Gearbox Torque Probe', pos: [2.2, 1.3, -0.1] as [number, number, number] },
    { name: 'Tool Wear Optical Sensor', pos: [0, 0.9, 0.8] as [number, number, number] },
    { name: 'Robotic Feed Sensor', pos: [-2.2, 1.8, 0.4] as [number, number, number] },
  ], []);

  // Core Position
  const corePos: [number, number, number] = [0, 5.6, -0.6];

  // Data Conduit Line Objects
  const conduitLines = useMemo(() => {
    return sensorProbes.map((probe) => {
      const p1 = new THREE.Vector3(...probe.pos);
      const p3 = new THREE.Vector3(...corePos);
      const midY = (probe.pos[1] + corePos[1]) / 2 + 0.6;
      const p2 = new THREE.Vector3(probe.pos[0] * 0.5, midY, (probe.pos[2] + corePos[2]) / 2);
      const curve = new THREE.QuadraticBezierCurve3(p1, p2, p3);
      const points = curve.getPoints(24);
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      const material = new THREE.LineBasicMaterial({
        color: new THREE.Color(tierColor),
        transparent: true,
        opacity: simulatorStatus === 'running' ? 0.65 : 0.25,
      });
      return { lineObj: new THREE.Line(geometry, material), points };
    });
  }, [sensorProbes, tierColor, simulatorStatus]);

  useFrame(({ clock }) => {
    if (reducedMotion) return;
    const t = clock.getElapsedTime();

    if (coreOuterRingRef.current) {
      coreOuterRingRef.current.rotation.y = t * 0.8;
      coreOuterRingRef.current.rotation.x = Math.sin(t * 0.5) * 0.25;
    }
    if (coreInnerRingRef.current) {
      coreInnerRingRef.current.rotation.y = -t * 1.2;
      coreInnerRingRef.current.rotation.z = Math.cos(t * 0.6) * 0.3;
    }
    if (coreCrystalRef.current) {
      coreCrystalRef.current.rotation.y = t * 1.5;
      coreCrystalRef.current.rotation.x = t * 0.9;
      const breathe = Math.sin(t * 3.0) * 0.08 + 1.0;
      coreCrystalRef.current.scale.set(breathe, breathe, breathe);
    }

    // Pulse animation along data conduits
    if (pulseGroupRef.current && simulatorStatus === 'running') {
      const pulseT = (t * 0.8) % 1.0;
      pulseGroupRef.current.children.forEach((pulseDot, idx) => {
        const points = conduitLines[idx]?.points;
        if (points) {
          const pointIdx = Math.floor(pulseT * (points.length - 1));
          const pt = points[pointIdx];
          if (pt) {
            pulseDot.position.copy(pt);
          }
        }
      });
    }
  });

  return (
    <group>
      {/* ── Sensor Probes (Data-Driven Status Lights) ── */}
      {sensorProbes.map((probe, idx) => (
        <group key={idx} position={probe.pos}>
          {/* Probe Mounting Collar */}
          <mesh>
            <cylinderGeometry args={[0.07, 0.09, 0.12, 12]} />
            <meshStandardMaterial color="#0f172a" metalness={0.9} roughness={0.2} />
          </mesh>
          {/* Glowing Status Indicator Bulb */}
          <mesh position={[0, 0.08, 0]}>
            <sphereGeometry args={[0.065, 16, 16]} />
            <meshStandardMaterial
              color={tierColor}
              emissive={tierColor}
              emissiveIntensity={emissiveIntensity}
              roughness={0.1}
            />
          </mesh>
          {/* Subtle Local Point Light from Sensor */}
          {simulatorStatus === 'running' && (
            <pointLight color={tierColor} intensity={0.4} distance={1.2} />
          )}
        </group>
      ))}

      {/* ── Luminous Data Conduits to Intelligence Core ── */}
      {conduitLines.map((item, idx) => (
        <primitive key={idx} object={item.lineObj} />
      ))}

      {/* Travelling Data Pulses */}
      <group ref={pulseGroupRef}>
        {sensorProbes.map((_, idx) => (
          <mesh key={idx} visible={simulatorStatus === 'running'}>
            <sphereGeometry args={[0.05, 12, 12]} />
            <meshStandardMaterial
              color="#ffffff"
              emissive={tierColor}
              emissiveIntensity={2.5}
            />
          </mesh>
        ))}
      </group>

      {/* ── Intelligence Core (Suspended Above Machine) ── */}
      <group position={corePos}>
        {/* Central Intelligence Node Crystal */}
        <mesh ref={coreCrystalRef} castShadow>
          <octahedronGeometry args={[0.38, 0]} />
          <meshStandardMaterial
            color={tierColor}
            emissive={tierColor}
            emissiveIntensity={emissiveIntensity * 1.2}
            metalness={0.9}
            roughness={0.1}
          />
        </mesh>

        {/* Outer Gyroscopic Telemetry Ring */}
        <group ref={coreOuterRingRef}>
          <mesh>
            <torusGeometry args={[0.7, 0.025, 12, 32]} />
            <meshStandardMaterial
              color="#38bdf8"
              emissive={tierColor}
              emissiveIntensity={emissiveIntensity * 0.8}
              metalness={0.8}
            />
          </mesh>
        </group>

        {/* Inner Counter-Rotating Telemetry Ring */}
        <group ref={coreInnerRingRef}>
          <mesh>
            <torusGeometry args={[0.52, 0.02, 12, 28]} />
            <meshStandardMaterial
              color="#c084fc"
              emissive={tierColor}
              emissiveIntensity={emissiveIntensity * 0.8}
              metalness={0.8}
            />
          </mesh>
        </group>

        {/* Dynamic Light from Core */}
        <pointLight
          color={tierColor}
          intensity={simulatorStatus === 'running' ? 2.5 : 0.8}
          distance={5.0}
        />
      </group>
    </group>
  );
};
