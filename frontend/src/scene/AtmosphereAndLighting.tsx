import React, { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { Environment, Lightformer } from '@react-three/drei';

interface AtmosphereAndLightingProps {
  shadows?: boolean;
  shadowMapSize?: number;
  particleCount?: number;
  reducedMotion?: boolean;
}

export const AtmosphereAndLighting: React.FC<AtmosphereAndLightingProps> = ({
  shadows = true,
  shadowMapSize = 1024,
  particleCount = 55,
  reducedMotion = false,
}) => {
  const dustRef = useRef<THREE.Points>(null);
  const { gl } = useThree();

  // Set ACESFilmic tone mapping + exposure on the renderer
  useMemo(() => {
    gl.toneMapping = THREE.ACESFilmicToneMapping;
    gl.toneMappingExposure = 1.25;
    gl.outputColorSpace = THREE.SRGBColorSpace;
  }, [gl]);

  // Floating atmospheric micro-dust particles
  const [geometry, velocities] = useMemo(() => {
    const pos = new Float32Array(particleCount * 3);
    const vel = new Float32Array(particleCount * 3);
    for (let i = 0; i < particleCount; i++) {
      pos[i * 3 + 0] = (Math.random() - 0.5) * 16;
      pos[i * 3 + 1] = Math.random() * 7 + 0.5;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 12;
      vel[i * 3 + 0] = (Math.random() - 0.5) * 0.03;
      vel[i * 3 + 1] = Math.random() * 0.025 + 0.008;
      vel[i * 3 + 2] = (Math.random() - 0.5) * 0.03;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    return [geo, vel];
  }, [particleCount]);

  useFrame((_, delta) => {
    if (reducedMotion || !dustRef.current) return;
    const posAttr = dustRef.current.geometry.attributes.position as THREE.BufferAttribute;
    const arr = posAttr.array as Float32Array;
    for (let i = 0; i < particleCount; i++) {
      arr[i * 3 + 0] += velocities[i * 3 + 0] * delta;
      arr[i * 3 + 1] += velocities[i * 3 + 1] * delta;
      arr[i * 3 + 2] += velocities[i * 3 + 2] * delta;
      if (arr[i * 3 + 1] > 7.5) {
        arr[i * 3 + 1] = 0.5;
        arr[i * 3 + 0] = (Math.random() - 0.5) * 14;
        arr[i * 3 + 2] = (Math.random() - 0.5) * 10;
      }
    }
    posAttr.needsUpdate = true;
  });

  return (
    <>
      {/* Deep near-black industrial fog */}
      <fog attach="fog" args={['#030508', 9, 28]} />

      {/* ── Procedural Studio Environment Map (LOCAL - no network) ── */}
      {/* Low intensity so metal picks up only selected highlights */}
      <Environment resolution={128} background={false}>
        {/* Primary overhead white strip light – key specular source */}
        <Lightformer
          form="rect"
          intensity={4.0}
          color="#e8f0ff"
          scale={[8, 1.0, 1]}
          position={[0, 6, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
        />
        {/* Off-axis secondary overhead – slight warm */}
        <Lightformer
          form="rect"
          intensity={2.5}
          color="#d8e8f4"
          scale={[6, 0.8, 1]}
          position={[3, 5, 2]}
          rotation={[-Math.PI / 2.2, 0, 0.2]}
        />
        {/* Signature cool-blue rim from behind-left – edge lighting */}
        <Lightformer
          form="rect"
          intensity={6.0}
          color="#0066cc"
          scale={[14, 0.5, 1]}
          position={[-5, 3, -5]}
          rotation={[0, 0.5, 0]}
        />
        {/* Right-side subtle steel fill */}
        <Lightformer
          form="rect"
          intensity={1.2}
          color="#8898aa"
          scale={[4, 3, 1]}
          position={[5, 2, 3]}
          rotation={[0, -0.6, 0]}
        />
        {/* Floor underglow for workpiece blue ring bounce */}
        <Lightformer
          form="circle"
          intensity={2.5}
          color="#0077cc"
          scale={[2.5, 2.5, 1]}
          position={[-1, 0.2, 0.3]}
          rotation={[-Math.PI / 2, 0, 0]}
        />
        {/* Dark envelope – suppress sides to keep near-black */}
        <Lightformer
          form="rect"
          intensity={0.3}
          color="#040810"
          scale={[20, 14, 1]}
          position={[0, 0, -10]}
        />
      </Environment>

      {/* ── Key Directional Light (Overhead-right, white, hard specular) ── */}
      <directionalLight
        position={[3.5, 8.5, 2.5]}
        intensity={4.2}
        color="#f4f8ff"
        castShadow={shadows}
        shadow-mapSize-width={shadowMapSize}
        shadow-mapSize-height={shadowMapSize}
        shadow-camera-near={0.5}
        shadow-camera-far={28}
        shadow-camera-left={-7}
        shadow-camera-right={7}
        shadow-camera-top={7}
        shadow-camera-bottom={-7}
        shadow-bias={-0.0004}
      />

      {/* ── Electric-Blue Rim / Back Light (defines arm silhouette edges) ── */}
      <spotLight
        position={[-5.5, 4.8, -5.5]}
        target-position={[0.75, 1.45, 0]}
        intensity={7.5}
        distance={24}
        angle={0.65}
        penumbra={0.55}
        color="#0088ff"
      />

      {/* ── Soft warm-grey front fill (ensures titanium geometry is clearly visible) ── */}
      <directionalLight position={[-0.8, 2.2, 5.5]} intensity={1.1} color="#a5b8cf" />

      {/* ── Ambient base (prevents full black void) ── */}
      <ambientLight intensity={0.45} color="#0a1222" />

      {/* ── Physical Overhead Strip Light Fixtures ── */}
      {/* Luminaire 1 – Main */}
      <group position={[0.5, 5.9, 0.6]}>
        <mesh>
          <boxGeometry args={[4.6, 0.1, 0.28]} />
          <meshStandardMaterial color="#111827" metalness={0.9} roughness={0.3} />
        </mesh>
        <mesh position={[0, -0.06, 0]}>
          <boxGeometry args={[4.4, 0.03, 0.2]} />
          <meshStandardMaterial color="#ffffff" emissive="#ffffff" emissiveIntensity={5.0} roughness={0.05} />
        </mesh>
      </group>

      {/* Luminaire 2 – Secondary angled */}
      <group position={[2.8, 5.5, -2.0]} rotation={[0, -0.2, 0]}>
        <mesh>
          <boxGeometry args={[3.8, 0.1, 0.28]} />
          <meshStandardMaterial color="#111827" metalness={0.9} roughness={0.3} />
        </mesh>
        <mesh position={[0, -0.06, 0]}>
          <boxGeometry args={[3.6, 0.03, 0.2]} />
          <meshStandardMaterial color="#ffffff" emissive="#ffffff" emissiveIntensity={4.0} roughness={0.05} />
        </mesh>
      </group>

      {/* ── Background Electric-Blue LED Horizon Strip ── */}
      <group position={[0, 1.2, -7.5]}>
        <mesh>
          <boxGeometry args={[22, 0.06, 0.02]} />
          <meshStandardMaterial color="#0077ff" emissive="#0066dd" emissiveIntensity={4.5} roughness={0.2} />
        </mesh>
        <pointLight position={[0, 0, 0.3]} intensity={0.7} distance={5} color="#0077ff" />
      </group>

      {/* ── Rear Wall ── */}
      <mesh position={[0, 4, -8]} receiveShadow>
        <planeGeometry args={[30, 12]} />
        <meshStandardMaterial color="#04060b" roughness={0.9} metalness={0.35} />
      </mesh>

      {/* ── Background Machinery Silhouettes ── */}
      {/* Left enclosure */}
      <group position={[-6.2, 2.0, -5.5]} rotation={[0, 0.28, 0]}>
        <mesh castShadow receiveShadow>
          <boxGeometry args={[2.2, 4.0, 1.8]} />
          <meshStandardMaterial color="#090d18" roughness={0.7} metalness={0.55} />
        </mesh>
        <mesh position={[0, 1.82, 0.92]}>
          <boxGeometry args={[1.8, 0.04, 0.04]} />
          <meshStandardMaterial color="#0077ff" emissive="#0066ee" emissiveIntensity={1.4} />
        </mesh>
      </group>
      {/* Right enclosure */}
      <group position={[5.6, 1.8, -6.0]} rotation={[0, -0.22, 0]}>
        <mesh castShadow receiveShadow>
          <boxGeometry args={[2.4, 3.6, 1.6]} />
          <meshStandardMaterial color="#0b0f1e" roughness={0.75} metalness={0.5} />
        </mesh>
        {[-0.6, -0.2, 0.2, 0.6].map((x, idx) => (
          <mesh key={idx} position={[x, 0.4, 0.82]}>
            <boxGeometry args={[0.06, 1.4, 0.02]} />
            <meshStandardMaterial color="#030508" roughness={0.9} />
          </mesh>
        ))}
      </group>

      {/* ── Atmospheric Dust Particles ── */}
      <points ref={dustRef} geometry={geometry}>
        <pointsMaterial
          size={0.04}
          color="#5090cc"
          transparent
          opacity={0.28}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </points>
    </>
  );
};
