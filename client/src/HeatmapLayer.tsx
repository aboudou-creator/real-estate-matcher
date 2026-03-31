import { useEffect } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet.heat';

interface HeatmapPoint {
  latitude: number;
  longitude: number;
  category: string;
  price: number;
  city: string;
  neighborhood: string;
}

interface HeatmapLayerProps {
  points: HeatmapPoint[];
}

declare module 'leaflet' {
  function heatLayer(
    latlngs: Array<[number, number, number?]>,
    options?: Record<string, unknown>
  ): L.Layer;
}

function HeatmapLayer({ points }: HeatmapLayerProps) {
  const map = useMap();

  useEffect(() => {
    if (!points.length) return;

    const heatPoints: Array<[number, number, number]> = points.map((p) => [
      p.latitude,
      p.longitude,
      0.6,
    ]);

    const heat = L.heatLayer(heatPoints, {
      radius: 25,
      blur: 20,
      maxZoom: 15,
      max: 1.0,
      gradient: {
        0.0: '#0d47a1',
        0.2: '#1565c0',
        0.4: '#1e88e5',
        0.6: '#42a5f5',
        0.8: '#ffca28',
        1.0: '#ff5722',
      },
    });

    heat.addTo(map);

    return () => {
      map.removeLayer(heat);
    };
  }, [map, points]);

  return null;
}

export default HeatmapLayer;
