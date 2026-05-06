/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Tooltip, useMap, Polyline } from 'react-leaflet';
import L from 'leaflet';
import { motion, AnimatePresence } from 'motion/react';
import { FileText, MapPin, Plane, Train, Thermometer, ArrowRight, Loader2, Info, User, X } from 'lucide-react';
import { calculateHubs, getCityCoordinates, HubProposal } from './services/geminiService';
import { cn } from './lib/utils';

// Helper to create an arc between two latlng points
function getCurvePoints(start: { lat: number; lng: number }, end: { lat: number; lng: number }) {
  const points: [number, number][] = [];
  const midLat = (start.lat + end.lat) / 2;
  const midLng = (start.lng + end.lng) / 2;
  // Offset middle point to create a curve
  const offset = 0.2;
  const controlLat = midLat + (end.lng - start.lng) * offset;
  const controlLng = midLng - (end.lat - start.lat) * offset;
  
  for (let i = 0; i <= 20; i++) {
    const t = i / 20;
    const lat = Math.pow(1 - t, 2) * start.lat + 2 * (1 - t) * t * controlLat + Math.pow(t, 2) * end.lat;
    const lng = Math.pow(1 - t, 2) * start.lng + 2 * (1 - t) * t * controlLng + Math.pow(t, 2) * end.lng;
    points.push([lat, lng]);
  }
  return points;
}

// Marker Icons
const createHaloIcon = (isBest: boolean, isSelected: boolean) => L.divIcon({
  className: cn('ink-halo-marker', isBest ? 'ink-halo-marker-best' : 'ink-halo-marker-sub', isSelected && 'ink-halo-marker-selected'),
  html: `
    <div class="halo-ring"></div>
    <div class="center-dot"></div>
    <div class="focus-corners">
      <span class="tl"></span><span class="tr"></span><span class="bl"></span><span class="br"></span>
    </div>
  `,
  iconSize: [40, 40],
  iconAnchor: [20, 20]
});

const createDepartureIcon = () => L.divIcon({
  className: 'departure-marker',
  html: `<div class="departure-avatar-icon"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></div><div class="departure-base-dot"></div>`,
  iconSize: [24, 30],
  iconAnchor: [12, 30]
});

// A component to handle map bounds adjusting when results arrive
function MapBoundsManager({ points, hasPanel }: { points: [number, number][], hasPanel: boolean }) {
  const map = useMap();
  useEffect(() => {
    if (points.length > 0) {
      // Small delay to ensure rendering
      setTimeout(() => {
        const p1 = L.latLng(points[0][0], points[0][1]);
        const bounds = L.latLngBounds(p1, p1);
        points.forEach(p => bounds.extend(L.latLng(p[0], p[1])));
        // Add padding on the right if panel is open to avoid overlapping
        map.flyToBounds(bounds, { 
          paddingTopLeft: [50, 50], 
          paddingBottomRight: [hasPanel ? 450 : 50, 50],
          duration: 1.5 
        });
      }, 100);
    }
  }, [points, map, hasPanel]);
  return null;
}

function MapClickManager({ onClick }: { onClick: () => void }) {
  const map = useMap();
  useEffect(() => {
    map.on('click', onClick);
    return () => { map.off('click', onClick); }
  }, [map, onClick]);
  return null;
}

// Helper to calculate a point on a quadratic bezier curve
function quadraticBezier(p0: [number, number], p1: [number, number], p2: [number, number], t: number): [number, number] {
  const u = 1 - t;
  const lat = u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0];
  const lng = u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1];
  return [lat, lng];
}

function generateCurvePoints(start: { lat: number, lng: number }, end: { lat: number, lng: number }, segments = 40): [number, number][] {
  const p0: [number, number] = [start.lat, start.lng];
  const p2: [number, number] = [end.lat, end.lng];
  
  const midLat = (p0[0] + p2[0]) / 2;
  const midLng = (p0[1] + p2[1]) / 2;
  
  const latDiff = p2[0] - p0[0];
  const lngDiff = p2[1] - p0[1];
  
  // Curve factor to bend the line. A slight curvature.
  const perpLat = -lngDiff * 0.15; 
  const perpLng = latDiff * 0.15;
  
  const p1: [number, number] = [midLat + perpLat, midLng + perpLng];
  
  const points: [number, number][] = [];
  for (let i = 0; i <= segments; i++) {
    points.push(quadraticBezier(p0, p1, p2, i / segments));
  }
  return points;
}

function AnimatedPolyline({ start, end, key }: { start: { lat: number, lng: number }, end: { lat: number, lng: number }, key?: React.Key }) {
  const [currentPoints, setCurrentPoints] = useState<[number, number][]>([]);
  
  // Only recreate curve if start/end changes
  const curvePoints = React.useMemo(() => generateCurvePoints(start, end), [start.lat, start.lng, end.lat, end.lng]);

  useEffect(() => {
    setCurrentPoints([]);
    if (curvePoints.length === 0) return;
    
    let frame = 0;
    const totalFrames = curvePoints.length;
    
    // Animate point by point
    const interval = setInterval(() => {
      frame++;
      setCurrentPoints(curvePoints.slice(0, frame));
      if (frame >= totalFrames) clearInterval(interval);
    }, 20); // 20ms per point is smooth

    return () => clearInterval(interval);
  }, [curvePoints]);

  if (currentPoints.length < 2) return null;
  return <Polyline positions={currentPoints} pathOptions={{ color: '#999', weight: 0.8, opacity: 0.6, dashArray: '4, 4', fill: false, className: 'travel-path' }} />;
}

function CheckableItem({ label, key }: { label: string, key?: React.Key }) {
  const [checked, setChecked] = useState(false);
  return (
    <div 
      onClick={() => setChecked(!checked)}
      className="flex items-center gap-3 cursor-pointer group"
    >
      <div className={cn("w-4 h-4 border border-[var(--color-ink)] flex items-center justify-center transition-colors", checked ? "bg-[var(--color-ink)]" : "bg-transparent")}>
        {checked && <User className="w-3 h-3 text-[var(--color-paper)]" />}
      </div>
      <span className={cn("text-sm font-medium transition-all", checked ? "line-through opacity-50" : "opacity-100 group-hover:opacity-70")}>{label}</span>
    </div>
  );
}

export default function App() {
  const [citiesList, setCitiesList] = useState<{id: string, name: string}[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [hubs, setHubs] = useState<HubProposal[]>([]);
  const [departureCoords, setDepartureCoords] = useState<{city: string, lat: number, lng: number}[]>([]);
  const [selectedHub, setSelectedHub] = useState<HubProposal | null>(null);

  const handleSearch = async () => {
    let currentList = [...citiesList];
    if (inputValue.trim()) {
      const newCityNames = inputValue.split(/[,，]+/).map(c => c.trim()).filter(Boolean);
      const newCities = newCityNames.map(name => ({ id: Math.random().toString(36).substring(2, 9), name }));
      currentList = [...currentList, ...newCities];
      setCitiesList(currentList);
      setInputValue('');
    }

    const searchNames = currentList.map(c => c.name);
    if (searchNames.length < 2) {
      alert("请至少输入两个出发地");
      return;
    }
    
    setIsLoading(true);
    try {
      // Step 1: get hub proposals
      const proposals = await calculateHubs(searchNames);
      
      // Step 2: get coords for departure cities to draw curves later
      const coords = await getCityCoordinates(searchNames);
      
      setDepartureCoords(coords);
      // Sort proposals by fairness index desc
      proposals.sort((a, b) => b.fairnessIndex - a.fairnessIndex);
      setHubs(proposals);
      setSelectedHub(proposals[0]); // auto select the best
    } catch (e: any) {
      console.error(e);
      alert("Error finding the hub: " + e.message);
    } finally {
      setIsLoading(false);
    }
  };

  const allMapPoints = [
    ...departureCoords.map(d => [d.lat, d.lng] as [number, number]),
    ...hubs.map(h => [h.lat, h.lng] as [number, number])
  ];

  return (
    <div className="relative w-full h-screen font-sans bg-[var(--color-paper)] overflow-hidden">
      {/* SVG Filters for Ink effect */}
      <svg style={{ width: 0, height: 0, position: 'absolute' }} aria-hidden="true">
        <defs>
          <filter id="ink-wash" colorInterpolationFilters="sRGB">
            <feTurbulence type="fractalNoise" baseFrequency="0.04" numOctaves="2" result="noise" />
            <feDisplacementMap in="SourceGraphic" in2="noise" scale="12" xChannelSelector="R" yChannelSelector="G" />
            <feGaussianBlur stdDeviation="1" result="blurred" />
            <feMerge>
              <feMergeNode in="blurred" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="ink-wash-strong" colorInterpolationFilters="sRGB">
            <feTurbulence type="fractalNoise" baseFrequency="0.03" numOctaves="3" result="noise" />
            <feDisplacementMap in="SourceGraphic" in2="noise" scale="20" xChannelSelector="R" yChannelSelector="G" />
            <feGaussianBlur stdDeviation="2" result="blurred" />
            <feMerge>
              <feMergeNode in="blurred" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
      </svg>

      {/* Texture overlay via index.css applied to body, but let's add class here just in case */}
      <div className="paper-texture"></div>

      {/* Beige Tint Layer to make it feel like paper */}
      <div className="absolute inset-0 bg-[#e8e2d4] mix-blend-multiply opacity-40 pointer-events-none z-[5]"></div>

      {/* Map Layer */}
      <div className="absolute inset-0 z-0">
        <MapContainer center={[35.8617, 104.1954]} zoom={5} style={{ width: '100%', height: '100%' }} zoomControl={false} dragging={true} onClick={() => setSelectedHub(null)}>
          <TileLayer
            url="https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png"
            attribution=""
          />
          {/* Shaded Relief for Topography map styling */}
          <TileLayer
            url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Shaded_Relief/MapServer/tile/{z}/{y}/{x}"
            className="terrain-layer"
            attribution=""
            opacity={0.5}
          />
          <MapBoundsManager points={allMapPoints} hasPanel={!!selectedHub} />
          
          {/* Map click detector (because react-leaflet v3+ needs event hook inside) */}
          <MapClickManager onClick={() => setSelectedHub(null)} />
          
          {/* Departure Markers */}
          {departureCoords.map((dep, idx) => (
             <Marker key={`dep-${idx}`} position={[dep.lat, dep.lng]} icon={createDepartureIcon()}>
               <Tooltip direction="top" offset={[0, -24]} permanent className="custom-tooltip departure-tooltip">
                 {dep.city}
               </Tooltip>
             </Marker>
          ))}

          {/* Hub Markers */}
          {hubs.map((hub, idx) => {
            const isBest = idx === 0;
            const isSelected = selectedHub?.city === hub.city;
            // Only show permanent tooltip on best or selected. Or hover for subs.
            return (
              <Marker 
                key={`hub-${idx}`} 
                position={[hub.lat, hub.lng]} 
                icon={createHaloIcon(isBest, isSelected)}
                eventHandlers={{
                  click: () => setSelectedHub(hub),
                }}
              >
                 {(isBest || isSelected) ? (
                   <Tooltip direction="auto" offset={[16, 0]} permanent className="custom-tooltip halo-tooltip">
                     {hub.city}
                   </Tooltip>
                 ) : (
                   <Tooltip direction="auto" offset={[16, 0]} className="custom-tooltip halo-tooltip">
                     {hub.city}
                   </Tooltip>
                 )}
              </Marker>
            )
          })}

          {/* Flight Paths from Departures to Selected Hub */}
          {selectedHub && departureCoords.map((dep, idx) => (
             <AnimatedPolyline 
               key={`path-${idx}-${selectedHub.city}`} 
               start={dep}
               end={selectedHub}
             />
          ))}
        </MapContainer>
      </div>

      {/* Top Search Bar */}
      <div className="absolute top-10 left-1/2 -translate-x-1/2 z-10 w-full max-w-lg px-4">
        <div className="bg-[var(--color-paper)]/80 backdrop-blur-md p-2 rounded-full border border-black/10 shadow-sm flex items-center mb-6">
          <input 
            type="text" 
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (inputValue.trim()) {
                  const newCityNames = inputValue.split(/[,，]+/).map(c => c.trim()).filter(Boolean);
                  const newCities = newCityNames.map(name => ({ id: Math.random().toString(36).substring(2, 9), name }));
                  setCitiesList(prev => [...prev, ...newCities]);
                  setInputValue('');
                } else if (!isLoading) {
                  handleSearch();
                }
              }
            }}
            placeholder="输入出发城市，按回车添加..."
            className="flex-1 bg-transparent px-4 outline-none text-[var(--color-ink)] placeholder-black/30 font-medium"
          />
          <button 
            onClick={handleSearch}
            disabled={isLoading}
            className="bg-[var(--color-ink)] text-[var(--color-paper)] w-10 h-10 rounded-full flex items-center justify-center hover:bg-black transition-colors shrink-0"
          >
            {isLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <ArrowRight className="w-5 h-5" />}
          </button>
        </div>
        
        {/* Participants Array Elements */}
        <div className="flex flex-wrap gap-5 justify-center">
          <AnimatePresence>
            {citiesList.map((city) => (
              <motion.div 
                key={city.id}
                initial={{ opacity: 0, y: 15, scale: 0.9 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                className="flex flex-col items-center relative group"
              >
                <div className="avatar-wrapper flex flex-col items-center">
                   <div className="w-10 h-10 rounded-full border border-[var(--color-ink)] bg-white/60 backdrop-blur-sm flex items-center justify-center shadow-sm relative transition-all group-hover:bg-white group-hover:-translate-y-1 z-10">
                      <User className="w-5 h-5 text-[var(--color-ink)]" strokeWidth={1.5} />
                      <button 
                        onClick={() => setCitiesList(prev => prev.filter(c => c.id !== city.id))}
                        className="absolute -top-1 -right-1 w-4 h-4 bg-[var(--color-ink)] text-[var(--color-paper)] rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-[0_2px_4px_rgba(0,0,0,0.15)] hover:scale-110"
                      >
                        <X className="w-3 h-3" strokeWidth={2}/>
                      </button>
                   </div>
                   <div className="mt-2 text-[11px] font-medium tracking-widest text-[var(--color-ink)] drop-shadow-md bg-[var(--color-paper)]/40 px-1.5 rounded">{city.name}</div>
                </div>
                <div className="avatar-shadow"></div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>

      {/* Initial overlay if no hubs */}
      <AnimatePresence>
        {!isLoading && hubs.length === 0 && (
          <motion.div 
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="absolute inset-0 z-10 flex flex-col items-center justify-center pointer-events-none"
          >
            <h1 className="font-serif text-6xl text-[var(--color-ink)] tracking-widest mb-4">集合点</h1>
            <p className="font-sans text-[var(--color-ink-light)] opacity-70 tracking-[0.2em] uppercase text-xs">The Hub - 寻找最公平的相聚点</p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Selected Hub Receipt Menu -> Zine UI */}
      <AnimatePresence>
        {selectedHub && !isLoading && (
          <motion.div
            initial={{ x: "100%", opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: "100%", opacity: 0 }}
            transition={{ type: "spring", damping: 25, stiffness: 200 }}
            className="absolute top-0 right-0 z-20 h-full w-full max-w-md bg-[var(--color-paper)]/95 backdrop-blur-xl border-l border-black/5 shadow-[-10px_0_40px_rgba(0,0,0,0.05)] overflow-y-auto"
          >
            {/* Zine Pages Container */}
            <div className="p-8 pt-12 space-y-12 pb-24">
              
              {/* Zine Cover */}
              <div className="zine-page relative p-8 border border-black/10 shadow-sm bg-white/50 backdrop-blur-md rounded-sm min-h-[400px] flex flex-col justify-between">
                 {/* Fold line visual */}
                 <div className="absolute -left-[1px] top-0 bottom-0 w-[2px] bg-gradient-to-r from-black/5 to-transparent"></div>
                 
                 <div className="text-center relative z-10">
                   <div className="w-16 h-16 mx-auto mb-6 relative">
                     <div className="absolute inset-0 bg-[var(--color-ink)] rounded-full opacity-10 filter blur-xl animate-pulse"></div>
                     <div className="w-full h-full border border-black/20 rounded-full flex flex-wrap items-center justify-center p-2 bg-[var(--color-paper)] shadow-inner">
                       <User className="w-4 h-4 text-[var(--color-ink)] opacity-80 -ml-1" />
                       <User className="w-4 h-4 text-[var(--color-ink)] opacity-80 -mt-2" />
                       <User className="w-4 h-4 text-[var(--color-ink)] opacity-80" />
                     </div>
                   </div>
                   <h2 className="font-serif text-6xl font-medium tracking-tight mb-4 text-[var(--color-ink)]">{selectedHub.city}</h2>
                   <div className="flex justify-center items-center gap-2 text-xs font-semibold uppercase tracking-widest text-[var(--color-ink-light)] opacity-70">
                     <MapPin className="w-3 h-3" /> The Hub
                   </div>
                 </div>

                 <div className="mt-8 text-center pt-8 border-t border-black/10">
                   <h3 className="text-[11px] uppercase font-bold tracking-widest text-[var(--color-ink-light)] mb-3 flex items-center justify-center gap-1">
                     <Thermometer className="w-3 h-3" /> 当地气象
                   </h3>
                   <div className="font-serif text-3xl font-medium mb-1">{selectedHub.weather.temp}°C</div>
                   <div className="text-xs opacity-70 mb-1">{selectedHub.weather.description}</div>
                   <div className="text-[10px] italic opacity-50 leading-relaxed max-w-[200px] mx-auto">{selectedHub.weather.clothing}</div>
                 </div>
              </div>

              {/* Zine Page 1: Transport & Assembly */}
              <div className="zine-page relative p-8 border border-black/10 shadow-sm bg-[var(--color-paper)] rounded-sm">
                <div className="absolute -left-[1px] top-0 bottom-0 w-[2px] bg-gradient-to-r from-black/5 to-transparent"></div>
                <div className="absolute -top-[1px] left-0 right-0 h-[2px] bg-gradient-to-b from-black/5 to-transparent"></div>
                
                <h3 className="text-xl font-serif mb-6 text-[var(--color-ink)] flex items-center gap-2 border-b border-black/10 pb-4">
                  同步降落计划
                  <span className="text-[9px] uppercase font-sans tracking-widest opacity-40 ml-auto pt-1">Arrival</span>
                </h3>

                <div className="space-y-4 mb-8">
                  {selectedHub.travelSolutions.map((sol, i) => (
                    <div key={i} className="bg-white/40 border border-black/5 rounded-xl p-4 shadow-sm relative group">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-[var(--color-ink)] text-white flex items-center justify-center shrink-0">
                            {sol.mode === 'flight' ? <Plane className="w-4 h-4" /> : <Train className="w-4 h-4" />}
                          </div>
                          <div>
                            <div className="flex items-center gap-2 mb-0.5">
                              <span className="font-semibold text-sm">{sol.departureCity}</span>
                              <span className="text-[10px] bg-black/10 px-1.5 rounded text-black/60 font-mono tracking-tighter">{sol.courseNo}</span>
                            </div>
                            <div className="flex items-center gap-1.5 text-xs text-[var(--color-ink-light)] font-mono">
                              <span>{sol.departureTime}</span>
                              <span className="w-4 border-t border-black/20"></span>
                              <span className="font-bold text-[var(--color-ink)]">{sol.arrivalTime}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="bg-[#EBE7DF]/50 p-4 rounded-xl border border-black/5">
                  <h4 className="text-[10px] uppercase font-bold tracking-widest opacity-50 mb-2">集合地点</h4>
                  <p className="font-serif text-lg text-[var(--color-ink)]">{selectedHub.assemblyPoint}</p>
                </div>
              </div>

              {/* Zine Page 2: Food & Guide with Checkboxes */}
              <div className="zine-page relative p-8 border border-black/10 shadow-sm bg-[var(--color-paper)] rounded-sm">
                <div className="absolute -left-[1px] top-0 bottom-0 w-[2px] bg-gradient-to-r from-black/5 to-transparent"></div>
                <div className="absolute -top-[1px] left-0 right-0 h-[2px] bg-gradient-to-b from-black/5 to-transparent"></div>

                <h3 className="text-xl font-serif mb-6 text-[var(--color-ink)] flex items-center gap-2 border-b border-black/10 pb-4">
                  共识赏味单
                  <span className="text-[9px] uppercase font-sans tracking-widest opacity-40 ml-auto pt-1">Taste</span>
                </h3>

                <ul className="mb-6 space-y-2">
                  {selectedHub.localGuides.tags.map((tag, i) => (
                    <li key={i} className="text-xs italic opacity-80 border-b border-black/5 pb-2">#{tag}</li>
                  ))}
                </ul>

                <div className="space-y-6">
                  <div>
                    <h4 className="text-[10px] uppercase font-bold tracking-widest opacity-50 mb-3">吃点好的</h4>
                    <div className="space-y-3">
                      {selectedHub.localGuides.foods.map((f, i) => (
                        <CheckableItem key={`food-${i}`} label={f} />
                      ))}
                    </div>
                  </div>
                  <div>
                    <h4 className="text-[10px] uppercase font-bold tracking-widest opacity-50 mb-3">走走看看</h4>
                    <div className="space-y-3">
                      {selectedHub.localGuides.attractions.map((a, i) => (
                        <CheckableItem key={`attraction-${i}`} label={a} />
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Back Cover: Budget */}
              <div className="zine-page relative p-8 border border-black/10 shadow-sm bg-black text-white rounded-sm mt-8">
                 <div className="absolute -left-[1px] top-0 bottom-0 w-[2px] bg-gradient-to-r from-white/10 to-transparent"></div>
                 <h3 className="text-xl font-serif mb-6 border-b border-white/20 pb-4 text-center">
                  预算分摊小记
                 </h3>
                 <div className="flex flex-col items-center justify-center space-y-6">
                    <div className="text-center">
                      <div className="text-[10px] uppercase tracking-[0.2em] opacity-60 mb-2">人均预估 (交通)</div>
                      <div className="font-serif text-5xl">¥{Math.round(selectedHub.budgetSummary.perPerson)}</div>
                    </div>
                    <div className="text-center opacity-60">
                      <div className="text-[10px] uppercase tracking-widest mb-1">总预算</div>
                      <div className="font-serif text-lg">¥{Math.round(selectedHub.budgetSummary.total)}</div>
                    </div>
                 </div>
              </div>

            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

