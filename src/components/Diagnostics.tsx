import React from 'react';
import { DiagnosticsData, Language } from '../types';
import { translations } from '../utils/translations';
import { Activity, AlertTriangle, Monitor, ShieldAlert } from 'lucide-react';

interface DiagnosticsProps {
  data: DiagnosticsData;
  lang: Language;
  mode: 'native' | 'canvas';
}

export default function Diagnostics({ data, lang, mode }: DiagnosticsProps) {
  const t = translations[lang];

  // Helper to determine FPS health color
  const getFpsColor = (fps: number) => {
    if (mode === 'native') return 'text-sky-400 border-sky-950 bg-sky-950/30';
    if (fps >= 24) return 'text-emerald-400 border-emerald-950 bg-emerald-950/30';
    if (fps >= 15) return 'text-amber-400 border-amber-950 bg-amber-950/30';
    return 'text-rose-400 border-rose-950 bg-rose-950/30';
  };

  // Helper for load color
  const getLoadBadge = (load: 'Low' | 'Medium' | 'High') => {
    switch (load) {
      case 'Low':
        return {
          text: t.loadLow,
          color: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
        };
      case 'Medium':
        return {
          text: t.loadMedium,
          color: 'bg-amber-500/10 text-amber-400 border-amber-500/20'
        };
      case 'High':
        return {
          text: t.loadHigh,
          color: 'bg-rose-500/10 text-rose-400 border-rose-500/20'
        };
    }
  };

  const loadBadge = getLoadBadge(data.cpuLoadEstimate);

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl transition-all duration-300">
      <div className="flex items-center gap-2 mb-4 border-b border-slate-800 pb-3">
        <Activity className="w-5 h-5 text-indigo-400" />
        <h3 className="text-md font-display font-semibold text-slate-100">
          {t.diagnosticsTitle}
        </h3>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* FPS Card */}
        <div className="bg-slate-950/50 rounded-xl p-3 border border-slate-800/60 flex flex-col justify-between">
          <span className="text-xs text-slate-400 font-sans block mb-1">{t.currentFps}</span>
          <div className="flex items-baseline gap-1.5">
            <span className={`text-2xl font-mono font-bold px-2 py-0.5 rounded-lg border ${getFpsColor(data.fps)}`}>
              {mode === 'native' ? 'N/A' : data.fps.toFixed(0)}
            </span>
            {mode === 'native' && (
              <span className="text-[10px] text-slate-500 font-mono">({t.nativeMode})</span>
            )}
            {mode === 'canvas' && (
              <span className="text-xs text-slate-400 font-mono">FPS</span>
            )}
          </div>
        </div>

        {/* Load Card */}
        <div className="bg-slate-950/50 rounded-xl p-3 border border-slate-800/60 flex flex-col justify-between">
          <span className="text-xs text-slate-400 font-sans block mb-1">{t.estLoad}</span>
          <div>
            <span className={`text-xs px-2 py-1 rounded-full border font-medium ${loadBadge.color}`}>
              {loadBadge.text}
            </span>
          </div>
        </div>

        {/* Resolution Card */}
        <div className="bg-slate-950/50 rounded-xl p-3 border border-slate-800/60 flex flex-col justify-between col-span-2 sm:col-span-1">
          <span className="text-xs text-slate-400 font-sans block mb-1">
            <div className="flex items-center gap-1">
              <Monitor className="w-3.5 h-3.5 text-slate-400" />
              {t.renderResolution}
            </div>
          </span>
          <span className="text-sm font-mono font-semibold text-slate-200">
            {data.canvasWidth > 0 ? `${data.canvasWidth} × ${data.canvasHeight}` : '—'}
          </span>
        </div>

        {/* Dropped Frames Card */}
        <div className="bg-slate-950/50 rounded-xl p-3 border border-slate-800/60 flex flex-col justify-between col-span-2 sm:col-span-1">
          <span className="text-xs text-slate-400 font-sans block mb-1">
            <div className="flex items-center gap-1">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
              {t.droppedFrames}
            </div>
          </span>
          <div className="flex items-baseline gap-2">
            <span className={`text-sm font-mono font-bold ${data.droppedFrames > 0 ? 'text-amber-400' : 'text-slate-400'}`}>
              {data.droppedFrames}
            </span>
            {data.droppedFrames > 100 && (
              <span className="text-[10px] text-rose-400 bg-rose-500/10 px-1.5 py-0.5 rounded border border-rose-500/20 font-sans flex items-center gap-0.5">
                <ShieldAlert className="w-2.5 h-2.5" />
                Düşürün!
              </span>
            )}
          </div>
        </div>
      </div>

      {mode === 'canvas' && data.droppedFrames > 50 && (
        <p className="mt-4 text-xs text-amber-400/90 bg-amber-500/5 p-2.5 rounded-lg border border-amber-500/20 leading-relaxed">
          ⚠️ <strong>{t.droppedFramesDesc}</strong>
        </p>
      )}
    </div>
  );
}
