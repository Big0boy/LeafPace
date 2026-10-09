import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import { LatLng, RouteData } from '../types';

interface MapViewProps {
  userLocation: LatLng;
  route: RouteData | null;
  onLocationChange?: (newLoc: LatLng) => void;
}

export const MapView: React.FC<MapViewProps> = ({ userLocation, route, onLocationChange }) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const routeLayerRef = useRef<L.Polyline | null>(null);
  const userMarkerRef = useRef<L.Marker | null>(null);

  // Initialize Map
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;

    const map = L.map(mapContainerRef.current, {
      center: [userLocation.lat, userLocation.lng],
      zoom: 14,
      zoomControl: false,
    });

    // OpenStreetMap standard tiles — keyless and unmetered.  (CARTO's free
    // basemaps now answer every request with a static "API key required"
    // placeholder image, so the map used to render as that error tile.)
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(map);

    // Zoom control at bottom right for thumb reachability
    L.control.zoom({ position: 'bottomright' }).addTo(map);

    // Allow user to tap map to set a new starting point
    map.on('click', (e: L.LeafletMouseEvent) => {
      if (onLocationChange) {
        onLocationChange({ lat: e.latlng.lat, lng: e.latlng.lng });
      }
    });

    mapInstanceRef.current = map;

    return () => {
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  // Update User Marker
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (userMarkerRef.current) {
      // React StrictMode (dev) re-runs effects after the map has been torn
      // down and recreated, which used to leave this marker orphaned on the
      // dead map — re-attach it to the live map before moving it.
      if (!map.hasLayer(userMarkerRef.current)) {
        userMarkerRef.current.addTo(map);
      }
      userMarkerRef.current.setLatLng([userLocation.lat, userLocation.lng]);
    } else {
      const userIcon = L.divIcon({
        className: 'user-marker',
        html: `<div class="w-5 h-5 bg-emerald-500 rounded-full border-2 border-white shadow-lg user-gps-pulse"></div>`,
        iconSize: [20, 20],
        iconAnchor: [10, 10],
      });

      userMarkerRef.current = L.marker([userLocation.lat, userLocation.lng], { icon: userIcon }).addTo(map);
    }

    // Centre the map on the newly set start point (GPS lock or map tap) so
    // the marker is never off-screen.  While a route loop is framed we leave
    // the view alone — the loop should stay visible.
    if (!route) {
      map.setView([userLocation.lat, userLocation.lng], map.getZoom());
    }
  }, [userLocation, route]);

  const routeMarkersRef = useRef<L.Marker[]>([]);

  // Update Route Polyline & Markers
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (routeLayerRef.current) {
      map.removeLayer(routeLayerRef.current);
      routeLayerRef.current = null;
    }

    // Clear old waypoint markers
    routeMarkersRef.current.forEach(m => map.removeLayer(m));
    routeMarkersRef.current = [];

    if (route && route.coordinates.length > 0) {
      const latlngs = route.coordinates.map(c => [c.lat, c.lng] as [number, number]);

      const polyline = L.polyline(latlngs, {
        color: '#15803d', // deep forest green
        weight: 5,
        opacity: 0.9,
        lineCap: 'round',
        lineJoin: 'round',
      }).addTo(map);

      // Add emerald glow line under it
      const glow = L.polyline(latlngs, {
        color: '#4ade80',
        weight: 8,
        opacity: 0.4,
      }).addTo(map);

      routeLayerRef.current = polyline;

      // Add start pin marker
      const startPt = route.coordinates[0];
      const startIcon = L.divIcon({
        className: 'start-marker',
        html: `<div class="bg-emerald-600 text-white font-bold text-[10px] px-2 py-0.5 rounded-full border border-white shadow-md flex items-center gap-1 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap">
          <span>🌲</span><span>Start & Loop</span>
        </div>`,
        iconSize: [0, 0],
      });
      const startMarker = L.marker([startPt.lat, startPt.lng], { icon: startIcon }).addTo(map);
      routeMarkersRef.current.push(startMarker);

      // Fit bounds with comfortable mobile padding
      map.fitBounds(polyline.getBounds(), {
        padding: [40, 40],
        maxZoom: 16,
      });

      return () => {
        map.removeLayer(glow);
        routeMarkersRef.current.forEach(m => map.removeLayer(m));
        routeMarkersRef.current = [];
      };
    }
  }, [route]);

  return (
    <div className="relative w-full h-full">
      <div ref={mapContainerRef} className="w-full h-full rounded-2xl overflow-hidden shadow-inner" />
      <div className="absolute top-3 left-3 z-[400] bg-stone-900/90 backdrop-blur-md px-3 py-1.5 rounded-full border border-stone-800 text-xs font-medium text-emerald-400 flex items-center gap-1.5 shadow-md">
        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
        Tap map or use GPS to set origin
      </div>
    </div>
  );
};
