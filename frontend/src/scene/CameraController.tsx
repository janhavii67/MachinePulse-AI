import React, { useRef, useEffect } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';

interface CameraControllerProps {
  reducedMotion?: boolean;
}

export const CameraController: React.FC<CameraControllerProps> = ({ reducedMotion = false }) => {
  const { camera, size } = useThree();
  const mouseRef = useRef({ x: 0, y: 0 });
  const introProgressRef = useRef(0);

  // Responsive camera framing based on canvas viewport dimensions
  const isMobile = size.width < 768;
  const isTablet = size.width >= 768 && size.width < 1200;

  useEffect(() => {
    if (reducedMotion) return;

    const handleMouseMove = (e: MouseEvent) => {
      // Bounded [-1, 1] normalized coordinates
      mouseRef.current.x = (e.clientX / window.innerWidth) * 2 - 1;
      mouseRef.current.y = -(e.clientY / window.innerHeight) * 2 + 1;
    };

    window.addEventListener('mousemove', handleMouseMove, { passive: true });

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
    };
  }, [reducedMotion]);

  useFrame((_, delta) => {
    // Perfectly framed three-quarter view showing the FULL robotic arm from base to tool
    let targetCameraPos: THREE.Vector3;
    let targetLookAtPos: THREE.Vector3;

    if (isMobile) {
      targetCameraPos = new THREE.Vector3(0.65, 2.50, 7.5);
      targetLookAtPos = new THREE.Vector3(0.35, 1.35, 0.20);
    } else if (isTablet) {
      targetCameraPos = new THREE.Vector3(0.80, 2.45, 6.3);
      targetLookAtPos = new THREE.Vector3(0.30, 1.35, 0.20);
    } else {
      // Desktop: Natural, heroic centering across the entire hero scene
      targetCameraPos = new THREE.Vector3(0.95, 2.40, 5.6);
      targetLookAtPos = new THREE.Vector3(0.25, 1.35, 0.20);
    }

    if (reducedMotion) {
      camera.position.copy(targetCameraPos);
      camera.lookAt(targetLookAtPos);
      return;
    }

    // Gentle intro cubic-ease reveal
    introProgressRef.current = Math.min(introProgressRef.current + delta * 1.5, 1.0);
    const easeIntro = 1 - Math.pow(1 - introProgressRef.current, 3);

    // Subtle pointer parallax limits for realistic interactive depth
    const parallaxX = mouseRef.current.x * 0.18;
    const parallaxY = mouseRef.current.y * 0.10;

    const startPos = new THREE.Vector3(targetCameraPos.x + 0.3, targetCameraPos.y + 0.3, targetCameraPos.z + 0.8);
    const finalTarget = new THREE.Vector3().lerpVectors(startPos, targetCameraPos, easeIntro);

    finalTarget.x += parallaxX;
    finalTarget.y += parallaxY;

    // Damped lerp for silky smooth camera motion
    camera.position.lerp(finalTarget, Math.min(delta * 4.5, 0.25));

    const currentLookAt = new THREE.Vector3(
      targetLookAtPos.x + parallaxX * 0.08,
      targetLookAtPos.y + parallaxY * 0.05,
      targetLookAtPos.z
    );
    camera.lookAt(currentLookAt);
  });

  return null;
};
