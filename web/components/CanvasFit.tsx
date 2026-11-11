import { useEffect } from 'react';
import { useReactFlow, useStore, type FitViewOptions } from '@xyflow/react';

/** Camera fitting follows actual canvas and graph geometry changes. */
export function CanvasFit({ enabled, layoutKey, padding, minZoom = .15, maxZoom = 1 }: {
  enabled: boolean;
  layoutKey: string;
  padding?: FitViewOptions['padding'];
  minZoom?: number;
  maxZoom?: number;
}) {
  const width = useStore(state => state.width);
  const height = useStore(state => state.height);
  const { fitView, viewportInitialized } = useReactFlow();
  // Progress renders recreate option objects without changing their meaning.
  const paddingKey = JSON.stringify(padding);
  useEffect(() => {
    if (!enabled || !viewportInitialized || width <= 0 || height <= 0) return;
    void fitView({ padding, minZoom, maxZoom, duration: 0 });
  }, [enabled, viewportInitialized, width, height, layoutKey, paddingKey, minZoom, maxZoom, fitView]);
  return null;
}
