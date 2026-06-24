import React from 'react';
import { Language } from '../types';
import { translations } from '../utils/translations';
import { Sparkles, Compass, Lightbulb, CheckCircle2 } from 'lucide-react';

interface HelpGuidesProps {
  lang: Language;
}

export default function HelpGuides({ lang }: HelpGuidesProps) {
  const t = translations[lang];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      {/* Dynamic Explanation Guide */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl flex flex-col justify-between">
        <div>
          <div className="flex items-center gap-2 mb-4">
            <Compass className="w-5 h-5 text-indigo-400" />
            <h3 className="text-md font-display font-semibold text-slate-100">
              {t.clientVsServerTitle}
            </h3>
          </div>
          <p className="text-xs text-slate-300 leading-relaxed space-y-2">
            {t.clientVsServerText}
          </p>
        </div>

        <div className="mt-6 p-4 bg-slate-950/60 rounded-xl border border-slate-800/80 flex items-start gap-2.5">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
          <div className="text-[11px] text-slate-400 leading-relaxed">
            {lang === 'tr' ? (
              <>
                <strong>Sıfır İnternet Yükü:</strong> Yerel videolarınız hiçbir sunucuya yüklenmez. Bilgisayarınızda tamamen çevrimdışı (offline) olarak çözülür ve çalışır.
              </>
            ) : (
              <>
                <strong>Zero Bandwidth Cost:</strong> Local videos are never uploaded to any remote server. Decoding is done 100% locally and offline.
              </>
            )}
          </div>
        </div>
      </div>

      {/* Actionable Tips Column */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl">
        <div className="flex items-center gap-2 mb-4">
          <Lightbulb className="w-5 h-5 text-amber-400 animate-pulse" />
          <h3 className="text-md font-display font-semibold text-slate-100">
            {t.tipsTitle}
          </h3>
        </div>

        <div className="flex flex-col gap-3.5">
          <div className="bg-slate-950/40 p-3 rounded-xl border border-slate-800/40 text-xs text-slate-300 leading-relaxed">
            {t.tip1}
          </div>
          <div className="bg-slate-950/40 p-3 rounded-xl border border-slate-800/40 text-xs text-slate-300 leading-relaxed">
            {t.tip2}
          </div>
          <div className="bg-slate-950/40 p-3 rounded-xl border border-slate-800/40 text-xs text-slate-300 leading-relaxed">
            {t.tip3}
          </div>
          <div className="bg-slate-950/40 p-3 rounded-xl border border-slate-800/40 text-xs text-slate-300 leading-relaxed">
            {t.tip4}
          </div>
        </div>
      </div>
    </div>
  );
}
