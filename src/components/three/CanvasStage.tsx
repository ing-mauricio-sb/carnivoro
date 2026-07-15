'use client';

import dynamic from 'next/dynamic';

// WebGL must never run on the server.
const Burger3D = dynamic(() => import('./Burger3D'), { ssr: false });

/** Fixed full-viewport 3D stage that the cinematic sections scroll over. */
export default function CanvasStage() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-[1]"
      style={{ height: '100dvh' }}
    >
      <Burger3D />
    </div>
  );
}
