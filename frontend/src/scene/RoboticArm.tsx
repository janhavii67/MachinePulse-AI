import React, { useRef, useMemo } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';

export interface RoboticArmProps {
  simulatorStatus?: 'running' | 'paused' | 'stopped';
  rotationalSpeedRpm?: number;
  riskTier?: string;
  isOnline?: boolean;
  reducedMotion?: boolean;
}

export const RoboticArm: React.FC<RoboticArmProps> = ({
  simulatorStatus = 'stopped',
  rotationalSpeedRpm = 1500,
  riskTier = 'NORMAL',
  isOnline = true,
  reducedMotion = false,
}) => {
  // Mechanical Joint Hierarchy Refs
  const baseYawRef = useRef<THREE.Group>(null);
  const shoulderPitchRef = useRef<THREE.Group>(null);
  const elbowPitchRef = useRef<THREE.Group>(null);
  const wristPitchRef = useRef<THREE.Group>(null);
  const spindleShaftRef = useRef<THREE.Group>(null);
  const workpieceGlowRef = useRef<THREE.PointLight>(null);
  const toolSparkRef = useRef<THREE.PointLight>(null);

  const isRunning = simulatorStatus === 'running';

  // Real data-driven status color mapping
  const statusColor = useMemo(() => {
    if (!isOnline) return '#ef4444'; // Red for disconnected
    if (simulatorStatus === 'stopped') return '#475569'; // Slate when stopped
    const tier = riskTier.toUpperCase();
    if (tier === 'CRITICAL') return '#ef4444';
    if (tier === 'HIGH') return '#f97316';
    if (tier === 'WATCH' || tier === 'WARNING') return '#f59e0b';
    return '#00b4d8'; // Signature electric blue for normal running
  }, [riskTier, simulatorStatus, isOnline]);

  const glowIntensity = useMemo(() => {
    if (!isOnline) return 0.3;
    if (simulatorStatus === 'stopped') return 0.2;
    if (simulatorStatus === 'paused') return 1.1;
    return 3.2; // High radiance when streaming
  }, [simulatorStatus, isOnline]);

  // Realistic Corrugated Industrial Cable:
  // Loops from the elbow servo enclosure box, along the top of the forearm, through guide brackets, to the wrist
  const cableTubeGeometry = useMemo(() => {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.08, 0.45, -0.28),
      new THREE.Vector3(0.18, 1.25, -0.24),
      new THREE.Vector3(0.24, 2.30, -0.22),
      new THREE.Vector3(0.02, 2.35, -0.08),
      new THREE.Vector3(-0.55, 1.95, 0.12),
      new THREE.Vector3(-1.15, 1.55, 0.16),
      new THREE.Vector3(-1.60, 1.20, 0.20),
    ]);
    return new THREE.TubeGeometry(curve, 44, 0.028, 12, false);
  }, []);

  // Frame-rate independent cinematic mechanical kinematics
  useFrame(({ clock }, delta) => {
    // Signature hero pose matching Image 2:
    // - Base turntable faces forward/left towards workpiece
    // - Shoulder tilts the sculpted boom slightly back-right (+X) by -0.20 rad (-11 deg)
    // - Elbow reaches forward-down towards workpiece by +2.38 rad (+136 deg)
    // - Wrist articulates to keep precision spindle tool strictly vertical down into workpiece
    const basePose = {
      baseYaw: 0.14,
      shoulderPitch: -0.20,
      elbowPitch: 2.38,
      wristPitch: 0.96,
    };

    if (reducedMotion) {
      if (baseYawRef.current) baseYawRef.current.rotation.y = basePose.baseYaw;
      if (shoulderPitchRef.current) shoulderPitchRef.current.rotation.z = basePose.shoulderPitch;
      if (elbowPitchRef.current) elbowPitchRef.current.rotation.z = basePose.elbowPitch;
      if (wristPitchRef.current) {
        wristPitchRef.current.rotation.z = basePose.wristPitch;
        wristPitchRef.current.rotation.x = 0;
      }
      return;
    }

    const t = clock.getElapsedTime() * (isRunning ? 0.55 : 0.18);

    // 1. Base Yaw turntable (Axis: Y): slow industrial sweep
    if (baseYawRef.current) {
      baseYawRef.current.rotation.y = basePose.baseYaw + Math.sin(t * 0.6) * 0.035;
    }

    // 2. Shoulder Pitch (Axis: Z): graceful muscular arc
    if (shoulderPitchRef.current) {
      shoulderPitchRef.current.rotation.z = basePose.shoulderPitch + Math.sin(t * 0.8) * 0.022;
    }

    // 3. Elbow Pitch (Axis: Z): coordinated counter-balancing articulation
    if (elbowPitchRef.current) {
      elbowPitchRef.current.rotation.z = basePose.elbowPitch - Math.sin(t * 0.8) * 0.030;
    }

    // 4. Wrist kinematics (Axis: Z & X): maintains precision tool verticality
    if (wristPitchRef.current) {
      wristPitchRef.current.rotation.z = basePose.wristPitch + Math.sin(t * 0.8) * 0.008;
      wristPitchRef.current.rotation.x = Math.sin(t * 0.4) * 0.012;
    }

    // 5. Spindle rotation around tool axis (Axis: Y)
    if (spindleShaftRef.current) {
      const speedFactor = isRunning ? Math.min(Math.max(rotationalSpeedRpm / 500, 1.8), 7.0) : 0.3;
      spindleShaftRef.current.rotation.y += delta * speedFactor * 9.5;
    }

    // 6. Workpiece & tool tip light pulsation
    if (workpieceGlowRef.current && isRunning) {
      const pulse = 1.0 + Math.sin(clock.getElapsedTime() * 3.5) * 0.18;
      workpieceGlowRef.current.intensity = glowIntensity * pulse;
    }
    if (toolSparkRef.current && isRunning) {
      const flicker = 1.0 + Math.sin(clock.getElapsedTime() * 12.0) * 0.25;
      toolSparkRef.current.intensity = 2.6 * flicker;
    }
  });

  return (
    <group position={[0, 0, 0]}>
      {/* ══════════════════════════════════════════════════════════════════════
          WORKSTATION: Machined T-Slot CNC Tooling Table & Clamps (Image 2)
          ══════════════════════════════════════════════════════════════════════ */}
      {/* Heavy Steel/Aluminum Tooling Table Slab */}
      <mesh position={[0, 0.22, 0.2]} castShadow receiveShadow>
        <boxGeometry args={[9.6, 0.44, 5.4]} />
        <meshStandardMaterial color="#181f2b" metalness={0.90} roughness={0.28} />
      </mesh>

      {/* Front Table Bevel with Electric-Blue Laser Inset */}
      <mesh position={[0, 0.435, 2.88]}>
        <boxGeometry args={[9.6, 0.015, 0.025]} />
        <meshStandardMaterial color="#0099ff" emissive="#0088ff" emissiveIntensity={2.5} />
      </mesh>

      {/* Precision Machined T-Slots along table surface */}
      {[-1.8, -1.2, -0.6, 0, 0.6, 1.2, 1.8].map((z, idx) => (
        <group key={idx} position={[0, 0.445, z + 0.2]}>
          <mesh receiveShadow>
            <boxGeometry args={[9.4, 0.015, 0.055]} />
            <meshStandardMaterial color="#090d14" roughness={0.6} metalness={0.75} />
          </mesh>
        </group>
      ))}

      {/* Table Clamping Brackets with Chrome Studs */}
      {[-3.7, 3.7].map((x) => (
        <group key={x} position={[x, 0.46, 2.3]}>
          <mesh castShadow>
            <boxGeometry args={[0.32, 0.08, 0.40]} />
            <meshStandardMaterial color="#334155" metalness={0.92} roughness={0.22} />
          </mesh>
          <mesh position={[0, 0.06, 0]}>
            <cylinderGeometry args={[0.045, 0.045, 0.08, 12]} />
            <meshStandardMaterial color="#e2e8f0" metalness={0.98} roughness={0.1} />
          </mesh>
        </group>
      ))}

      {/* Left Tooling Post: Steel Gauge Cylinders (Image 2 Left Foreground) */}
      <group position={[-3.0, 0.44, 1.3]}>
        <mesh position={[0, 0.06, 0]} castShadow receiveShadow>
          <boxGeometry args={[0.7, 0.12, 1.45]} />
          <meshStandardMaterial color="#1e293b" metalness={0.92} roughness={0.26} />
        </mesh>
        {[-0.42, -0.12, 0.18, 0.48].map((z, i) => (
          <group key={i} position={[0, 0.12, z]}>
            <mesh position={[0, (0.32 + i * 0.09) / 2, 0]} castShadow>
              <cylinderGeometry args={[0.06, 0.06, 0.32 + i * 0.09, 20]} />
              <meshStandardMaterial color="#f1f5f9" metalness={0.98} roughness={0.1} />
            </mesh>
            <mesh position={[0, 0.32 + i * 0.09, 0]}>
              <cylinderGeometry args={[0.075, 0.075, 0.04, 20]} />
              <meshStandardMaterial color="#64748b" metalness={0.95} roughness={0.18} />
            </mesh>
          </group>
        ))}
      </group>

      {/* ══════════════════════════════════════════════════════════════════════
          WORKPIECE: Machined Spool Disc with Glowing Electric-Blue Ring (Image 2)
          ══════════════════════════════════════════════════════════════════════ */}
      <group position={[-0.95, 0.44, 0.28]}>
        {/* Base Table Sub-Flange with Chamfer */}
        <mesh position={[0, 0.05, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[1.08, 1.20, 0.10, 40]} />
          <meshStandardMaterial color="#1e2533" metalness={0.92} roughness={0.22} />
        </mesh>

        {/* Recessed Glowing Electric-Blue LED Under-Ring (Horizontal in XZ plane) */}
        <mesh position={[0, 0.105, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.98, 0.038, 16, 56]} />
          <meshStandardMaterial
            color={statusColor}
            emissive={statusColor}
            emissiveIntensity={glowIntensity * 2.4}
            roughness={0.08}
          />
        </mesh>

        {/* Lower Stepped Rim (Ground Steel) */}
        <mesh position={[0, 0.16, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[0.95, 1.02, 0.10, 40]} />
          <meshStandardMaterial color="#94a3b8" metalness={0.96} roughness={0.15} />
        </mesh>

        {/* Machined Spool Waist (Narrowed Center Column with Recessed Grooves) */}
        <mesh position={[0, 0.24, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[0.74, 0.74, 0.10, 40]} />
          <meshStandardMaterial color="#475569" metalness={0.94} roughness={0.18} />
        </mesh>

        {/* Top Heavy Polished Metal Disc Flange (Mirror Ground Finish) */}
        <mesh position={[0, 0.32, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[0.98, 0.98, 0.10, 40]} />
          <meshStandardMaterial color="#f1f5f9" metalness={0.99} roughness={0.09} />
        </mesh>

        {/* Top Recessed Tool Cavity Well */}
        <mesh position={[0, 0.373, 0]}>
          <cylinderGeometry args={[0.58, 0.58, 0.02, 36]} />
          <meshStandardMaterial color="#1e293b" metalness={0.92} roughness={0.22} />
        </mesh>

        {/* Inner Glowing Electric-Blue LED Ring (Horizontal in XZ plane) */}
        <mesh position={[0, 0.376, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.50, 0.026, 16, 40]} />
          <meshStandardMaterial
            color={statusColor}
            emissive={statusColor}
            emissiveIntensity={glowIntensity * 3.0}
            roughness={0.06}
          />
        </mesh>

        {/* Dynamic Light Casting from Workpiece onto Spindle and Table */}
        <pointLight
          ref={workpieceGlowRef}
          position={[0, 0.44, 0]}
          intensity={glowIntensity * 2.2}
          distance={4.2}
          color={statusColor}
        />
      </group>

      {/* ══════════════════════════════════════════════════════════════════════
          EXACT 6-AXIS INDUSTRIAL ROBOTIC ARM (Matching Image 2 Specification)
          ══════════════════════════════════════════════════════════════════════ */}
      <group position={[0.75, 0.44, 0.0]}>
        {/* ── Base Pedestal & Turntable Mounting Plate ── */}
        {/* Heavy Cast Square Base Plate with Recessed Corner Bolt Slots */}
        <mesh position={[0, 0.04, 0]} castShadow receiveShadow>
          <boxGeometry args={[1.85, 0.08, 1.85]} />
          <meshStandardMaterial color="#1a212d" metalness={0.88} roughness={0.30} />
        </mesh>

        {/* Outer Base Flange Ring */}
        <mesh position={[0, 0.09, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[0.92, 0.98, 0.06, 40]} />
          <meshStandardMaterial color="#212a38" metalness={0.90} roughness={0.26} />
        </mesh>

        {/* Massive Stepped Conical Pedestal Casting (Substantial & Wide) */}
        <mesh position={[0, 0.22, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[0.80, 0.90, 0.22, 40]} />
          <meshStandardMaterial color="#242e3d" metalness={0.90} roughness={0.26} />
        </mesh>

        {/* Heavy Bolt Ring (12 Heavy Industrial Hex Bolts securing base to table) */}
        {Array.from({ length: 12 }).map((_, i) => {
          const angle = (i * 2 * Math.PI) / 12;
          const bx = Math.cos(angle) * 0.76;
          const bz = Math.sin(angle) * 0.76;
          return (
            <mesh key={i} position={[bx, 0.33, bz]} castShadow>
              <cylinderGeometry args={[0.032, 0.032, 0.05, 8]} />
              <meshStandardMaterial color="#e2e8f0" metalness={0.98} roughness={0.12} />
            </mesh>
          );
        })}

        {/* Ground Precision Turntable Bearing Ring (Bright Brushed Steel) */}
        <mesh position={[0, 0.34, 0]} castShadow>
          <cylinderGeometry args={[0.76, 0.76, 0.05, 40]} />
          <meshStandardMaterial color="#cbd5e1" metalness={0.98} roughness={0.10} />
        </mesh>

        {/* ── Joint 1: Base Turntable Pivot (Rotates around Y) ── */}
        <group ref={baseYawRef} position={[0, 0.37, 0]}>
          {/* Rotating Turntable Base Casting */}
          <mesh position={[0, 0.18, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[0.68, 0.74, 0.32, 40]} />
            <meshStandardMaterial color="#252f40" metalness={0.90} roughness={0.26} />
          </mesh>

          {/* Sculpted Shoulder Cleat Uprights (Heavy U-cradle casting) */}
          <mesh position={[-0.26, 0.48, 0]} castShadow>
            <boxGeometry args={[0.18, 0.48, 0.62]} />
            <meshStandardMaterial color="#1e2736" metalness={0.92} roughness={0.24} />
          </mesh>
          <mesh position={[0.26, 0.48, 0]} castShadow>
            <boxGeometry args={[0.18, 0.48, 0.62]} />
            <meshStandardMaterial color="#1e2736" metalness={0.92} roughness={0.24} />
          </mesh>

          {/* Rounded Cleat Reinforcement Fillets */}
          {[-0.26, 0.26].map((x) => (
            <mesh key={x} position={[x, 0.64, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
              <cylinderGeometry args={[0.31, 0.31, 0.18, 24]} />
              <meshStandardMaterial color="#1e2736" metalness={0.92} roughness={0.24} />
            </mesh>
          ))}

          {/* Rear Electronics / Connector Port Housing */}
          <mesh position={[0, 0.28, -0.40]} castShadow>
            <boxGeometry args={[0.40, 0.26, 0.22]} />
            <meshStandardMaterial color="#0f1622" metalness={0.85} roughness={0.35} />
          </mesh>

          {/* Data-Driven Arm Status LED Beacon */}
          <mesh position={[0.26, 0.58, -0.32]}>
            <sphereGeometry args={[0.038, 16, 16]} />
            <meshStandardMaterial
              color={statusColor}
              emissive={statusColor}
              emissiveIntensity={glowIntensity * 2.2}
            />
          </mesh>

          {/* ── Joint 2: Shoulder Pitch Pivot (Rotates around Z) ── */}
          <group ref={shoulderPitchRef} position={[0, 0.66, 0]}>
            {/* Massive Circular Shoulder Rotary Joint Housing (Image 2 Signature Element) */}
            <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
              <cylinderGeometry args={[0.46, 0.46, 0.68, 40]} />
              <meshStandardMaterial color="#222b3a" metalness={0.92} roughness={0.24} />
            </mesh>

            {/* Shoulder Joint End Caps: Polished Outer Ring, Dark Hub & Bolt Circle */}
            {[-0.35, 0.35].map((xSide) => (
              <group key={xSide} position={[xSide, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
                {/* Polished Metallic Outer Ring */}
                <mesh castShadow>
                  <cylinderGeometry args={[0.42, 0.42, 0.04, 36]} />
                  <meshStandardMaterial color="#e2e8f0" metalness={0.98} roughness={0.10} />
                </mesh>
                {/* Dark Graphite Inner Hub Cap */}
                <mesh position={[0, xSide > 0 ? 0.025 : -0.025, 0]}>
                  <cylinderGeometry args={[0.28, 0.28, 0.03, 30]} />
                  <meshStandardMaterial color="#0b0f17" metalness={0.88} roughness={0.30} />
                </mesh>
                {/* Recessed Perimeter Bolts (8 Bolts) */}
                {Array.from({ length: 8 }).map((_, bi) => {
                  const bAngle = (bi * 2 * Math.PI) / 8;
                  return (
                    <mesh
                      key={bi}
                      position={[Math.cos(bAngle) * 0.35, xSide > 0 ? 0.04 : -0.04, Math.sin(bAngle) * 0.35]}
                    >
                      <cylinderGeometry args={[0.022, 0.022, 0.02, 8]} />
                      <meshStandardMaterial color="#ffffff" metalness={0.99} roughness={0.06} />
                    </mesh>
                  );
                })}
              </group>
            ))}

            {/* Rear Motor Counterweight Box (Extending behind shoulder) */}
            <mesh position={[0.05, -0.12, -0.42]} castShadow>
              <boxGeometry args={[0.42, 0.50, 0.42]} />
              <meshStandardMaterial color="#18202d" metalness={0.90} roughness={0.28} />
            </mesh>

            {/* ══════════════════════════════════════════════════════════════
                MAIN ARM LINK: Sculpted Curved & Tapered Boom (Image 2 Key Design)
                ══════════════════════════════════════════════════════════════ */}
            <group position={[0, 0.75, 0.02]}>
              {/* Lower Boom Fork / Cleat Casting */}
              <mesh position={[0, -0.32, 0]} castShadow>
                <boxGeometry args={[0.38, 0.45, 0.52]} />
                <meshStandardMaterial color="#242e3e" metalness={0.92} roughness={0.25} />
              </mesh>

              {/* Main Tapered Industrial Arm Casting Body */}
              <mesh castShadow>
                <boxGeometry args={[0.34, 1.25, 0.46]} />
                <meshStandardMaterial color="#263142" metalness={0.92} roughness={0.25} />
              </mesh>

              {/* Sculpted Machined Side Inset Pockets (Both Sides) */}
              {[-0.18, 0.18].map((xOffset) => (
                <group key={xOffset} position={[xOffset, 0, 0]}>
                  {/* Recessed Pocket Plate */}
                  <mesh>
                    <boxGeometry args={[0.025, 1.15, 0.38]} />
                    <meshStandardMaterial color="#cbd5e1" metalness={0.96} roughness={0.16} />
                  </mesh>
                  {/* Circular Inspection / Access Port Boss (Matches Image 2 Side Circle) */}
                  <mesh position={[xOffset > 0 ? 0.015 : -0.015, -0.12, 0]} rotation={[0, 0, Math.PI / 2]}>
                    <cylinderGeometry args={[0.10, 0.10, 0.02, 24]} />
                    <meshStandardMaterial color="#0c1017" metalness={0.90} roughness={0.35} />
                  </mesh>
                  <mesh position={[xOffset > 0 ? 0.026 : -0.026, -0.12, 0]} rotation={[0, 0, Math.PI / 2]}>
                    <cylinderGeometry args={[0.07, 0.07, 0.01, 20]} />
                    <meshStandardMaterial color="#94a3b8" metalness={0.96} roughness={0.18} />
                  </mesh>
                </group>
              ))}

              {/* Precision Cable Guide Brackets along Upper Arm */}
              <mesh position={[0.20, -0.25, 0.25]}>
                <boxGeometry args={[0.07, 0.10, 0.08]} />
                <meshStandardMaterial color="#475569" metalness={0.92} roughness={0.22} />
              </mesh>
              <mesh position={[0.20, 0.30, 0.25]}>
                <boxGeometry args={[0.07, 0.10, 0.08]} />
                <meshStandardMaterial color="#475569" metalness={0.92} roughness={0.22} />
              </mesh>
            </group>

            {/* ── Joint 3: Elbow Rotary Pitch Pivot (Rotates around Z) ── */}
            <group ref={elbowPitchRef} position={[0, 1.48, 0.04]}>
              {/* Large Circular Elbow Joint Housing (Prominent in Image 2) */}
              <mesh rotation={[0, 0, Math.PI / 2]} castShadow>
                <cylinderGeometry args={[0.40, 0.40, 0.64, 40]} />
                <meshStandardMaterial color="#222b3a" metalness={0.92} roughness={0.24} />
              </mesh>

              {/* Elbow Joint Concentric End Caps with Chrome Outer Rings & Bolts */}
              {[-0.33, 0.33].map((xSide) => (
                <group key={xSide} position={[xSide, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
                  {/* Polished Metallic Ring */}
                  <mesh castShadow>
                    <cylinderGeometry args={[0.36, 0.36, 0.04, 36]} />
                    <meshStandardMaterial color="#e2e8f0" metalness={0.98} roughness={0.10} />
                  </mesh>
                  {/* Dark Hub */}
                  <mesh position={[0, xSide > 0 ? 0.025 : -0.025, 0]}>
                    <cylinderGeometry args={[0.24, 0.24, 0.03, 28]} />
                    <meshStandardMaterial color="#0b0f17" metalness={0.88} roughness={0.30} />
                  </mesh>
                  {/* Bolt Ring (6 Bolts) */}
                  {Array.from({ length: 6 }).map((_, bi) => {
                    const bAngle = (bi * 2 * Math.PI) / 6;
                    return (
                      <mesh
                        key={bi}
                        position={[Math.cos(bAngle) * 0.29, xSide > 0 ? 0.035 : -0.035, Math.sin(bAngle) * 0.29]}
                      >
                        <cylinderGeometry args={[0.02, 0.02, 0.02, 8]} />
                        <meshStandardMaterial color="#ffffff" metalness={0.99} roughness={0.06} />
                      </mesh>
                    );
                  })}
                </group>
              ))}

              {/* ── Prominent Angular Servo Motor Enclosure Box (Top/Rear of Elbow - Image 2) ── */}
              <group position={[0.06, 0.28, -0.34]}>
                <mesh castShadow>
                  <boxGeometry args={[0.42, 0.48, 0.50]} />
                  <meshStandardMaterial color="#161e2a" metalness={0.92} roughness={0.26} />
                </mesh>
                {/* Top Chamfered Cover Plate */}
                <mesh position={[0, 0.25, 0]}>
                  <boxGeometry args={[0.38, 0.04, 0.46]} />
                  <meshStandardMaterial color="#334155" metalness={0.95} roughness={0.18} />
                </mesh>
                {/* Industrial Cable Connector Glands on top */}
                <mesh position={[-0.10, 0.29, -0.10]}>
                  <cylinderGeometry args={[0.035, 0.035, 0.06, 12]} />
                  <meshStandardMaterial color="#e2e8f0" metalness={0.98} roughness={0.1} />
                </mesh>
                <mesh position={[0.10, 0.29, -0.10]}>
                  <cylinderGeometry args={[0.035, 0.035, 0.06, 12]} />
                  <meshStandardMaterial color="#e2e8f0" metalness={0.98} roughness={0.1} />
                </mesh>
                {/* Industrial Specification / Warning Plate Badge */}
                <mesh position={[0.215, 0, 0]} rotation={[0, Math.PI / 2, 0]}>
                  <planeGeometry args={[0.30, 0.16]} />
                  <meshStandardMaterial color="#e2e8f0" metalness={0.90} roughness={0.25} />
                </mesh>
              </group>

              {/* ══════════════════════════════════════════════════════════════
                  FOREARM: Cylindrical Actuator with Dual Chrome Rings (Image 2)
                  ══════════════════════════════════════════════════════════════ */}
              <group position={[0, 1.10, 0]}>
                {/* Main Cylindrical Forearm Actuator Body (Brushed Dark Titanium) */}
                <mesh castShadow>
                  <cylinderGeometry args={[0.30, 0.34, 2.25, 36]} />
                  <meshStandardMaterial color="#283244" metalness={0.94} roughness={0.22} />
                </mesh>

                {/* ── Lower Machined Brushed Chrome Banded Ring (Image 2 Feature) ── */}
                <mesh position={[0, -0.32, 0]} castShadow>
                  <cylinderGeometry args={[0.325, 0.325, 0.14, 36]} />
                  <meshStandardMaterial color="#f8fafc" metalness={0.99} roughness={0.08} />
                </mesh>
                {/* Dark Precision Accent Groove */}
                <mesh position={[0, -0.23, 0]}>
                  <cylinderGeometry args={[0.31, 0.31, 0.04, 36]} />
                  <meshStandardMaterial color="#0b0f17" roughness={0.4} />
                </mesh>

                {/* ── Upper Machined Brushed Chrome Banded Ring (Image 2 Feature) ── */}
                <mesh position={[0, -0.14, 0]} castShadow>
                  <cylinderGeometry args={[0.325, 0.325, 0.14, 36]} />
                  <meshStandardMaterial color="#f8fafc" metalness={0.99} roughness={0.08} />
                </mesh>

                {/* Longitudinal Casing Stiffening Spine */}
                <mesh position={[0.25, 0, 0]} castShadow>
                  <boxGeometry args={[0.08, 1.65, 0.12]} />
                  <meshStandardMaterial color="#1b2330" metalness={0.92} roughness={0.26} />
                </mesh>

                {/* Cable Guide Brackets along Forearm */}
                <mesh position={[-0.20, 0.20, 0.24]}>
                  <boxGeometry args={[0.07, 0.10, 0.07]} />
                  <meshStandardMaterial color="#475569" metalness={0.92} roughness={0.22} />
                </mesh>

                {/* ── Joint 4: Compact Articulated Robot Wrist (Multi-Axis) ── */}
                <group ref={wristPitchRef} position={[0, 1.12, 0]}>
                  {/* Spherical / Bevelled Wrist Base Hub */}
                  <mesh castShadow>
                    <cylinderGeometry args={[0.25, 0.28, 0.30, 32]} />
                    <meshStandardMaterial color="#202938" metalness={0.92} roughness={0.22} />
                  </mesh>

                  {/* Wrist Transverse Pitch Servo Hub */}
                  <mesh rotation={[Math.PI / 2, 0, 0]} castShadow>
                    <cylinderGeometry args={[0.21, 0.21, 0.34, 28]} />
                    <meshStandardMaterial color="#e2e8f0" metalness={0.98} roughness={0.12} />
                  </mesh>

                  {/* Tool Mounting Faceplate Disc */}
                  <mesh position={[0, 0.20, 0]} castShadow>
                    <cylinderGeometry args={[0.24, 0.24, 0.08, 32]} />
                    <meshStandardMaterial color="#cbd5e1" metalness={0.96} roughness={0.16} />
                  </mesh>

                  {/* ══════════════════════════════════════════════════════════════
                      PRECISION SPINDLE / MILLING TOOL (Pointing Down to Workpiece)
                      ══════════════════════════════════════════════════════════════ */}
                  <group position={[0, 0.30, 0]}>
                    {/* Spindle Motor Collar */}
                    <mesh castShadow>
                      <cylinderGeometry args={[0.21, 0.23, 0.22, 32]} />
                      <meshStandardMaterial color="#18202d" metalness={0.92} roughness={0.24} />
                    </mesh>

                    {/* High-Speed Rotating Precision Spindle Core */}
                    <group ref={spindleShaftRef} position={[0, 0.17, 0]}>
                      {/* Stepped Precision Lathe-Machined Chuck Body */}
                      <mesh position={[0, 0.09, 0]} castShadow>
                        <cylinderGeometry args={[0.17, 0.19, 0.22, 28]} />
                        <meshStandardMaterial color="#e2e8f0" metalness={0.99} roughness={0.07} />
                      </mesh>

                      {/* Precision Collet Nut with Vertical Flutes (Ground Finish) */}
                      <mesh position={[0, 0.24, 0]} castShadow>
                        <cylinderGeometry args={[0.14, 0.16, 0.15, 28]} />
                        <meshStandardMaterial color="#f8fafc" metalness={0.99} roughness={0.05} />
                      </mesh>

                      {/* Stepped Tool Holder Shank */}
                      <mesh position={[0, 0.35, 0]} castShadow>
                        <cylinderGeometry args={[0.065, 0.065, 0.14, 16]} />
                        <meshStandardMaterial color="#cbd5e1" metalness={0.98} roughness={0.08} />
                      </mesh>

                      {/* Sharp Tungsten Carbide Tool Tip (Pointing Down to Workpiece) */}
                      <mesh position={[0, 0.46, 0]} castShadow>
                        <coneGeometry args={[0.032, 0.15, 16]} />
                        <meshStandardMaterial color="#ffffff" metalness={0.99} roughness={0.04} />
                      </mesh>

                      {/* Brilliant Pinpoint Spark / Laser at Tool Tip */}
                      <mesh position={[0, 0.54, 0]}>
                        <sphereGeometry args={[0.018, 12, 12]} />
                        <meshBasicMaterial color="#ffffff" />
                      </mesh>
                      <pointLight
                        ref={toolSparkRef}
                        position={[0, 0.54, 0]}
                        intensity={2.6}
                        distance={1.6}
                        color="#00e5ff"
                      />
                    </group>
                  </group>
                </group>
              </group>
            </group>
          </group>
        </group>

        {/* ── Corrugated Flexible Black Rubber Cable Harness (Image 2) ── */}
        <mesh geometry={cableTubeGeometry} castShadow>
          <meshStandardMaterial color="#090d13" roughness={0.88} metalness={0.10} />
        </mesh>
      </group>
    </group>
  );
};
