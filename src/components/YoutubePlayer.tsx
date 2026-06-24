import React from 'react';
import { Language } from '../types';
import { translations } from '../utils/translations';
import { Youtube, Info, Sparkles } from 'lucide-react';

interface YoutubePlayerProps {
  url: string;
  lang: Language;
}

export default function YoutubePlayer({ url, lang }: YoutubePlayerProps) {
  const t = translations[lang];

  // Extract YouTube video ID
  const getYoutubeId = (urlStr: string): string | null => {
    if (urlStr.includes('/live/')) {
      const parts = urlStr.split('/live/');
      if (parts[1]) {
        return parts[1].split('?')[0].split('&')[0];
      }
    }
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
    const match = urlStr.match(regExp);
    return match && match[2].length === 11 ? match[2] : null;
  };

  const videoId = getYoutubeId(url);

  if (!videoId) {
    return (
      <div className="bg-rose-950/20 border border-rose-900/30 rounded-2xl p-6 text-center text-rose-400">
        <p className="font-sans font-medium text-sm">
          {lang === 'tr' 
            ? 'Geçersiz YouTube Linki. Lütfen geçerli bir youtube.com veya youtu.be linki girin.' 
            : 'Invalid YouTube link. Please enter a valid youtube.com or youtu.be URL.'}
        </p>
      </div>
    );
  }

  // Construct optimized embed URL
  // modestbranding=1, rel=0, iv_load_policy=3, fs=1, disablekb=0
  const embedUrl = `https://www.youtube.com/embed/${videoId}?autoplay=1&modestbranding=1&rel=0&iv_load_policy=3&showinfo=0&fs=1`;

  return (
    <div className="flex flex-col gap-4">
      {/* Container holding the video player */}
      <div className="relative aspect-video w-full bg-slate-950 rounded-2xl overflow-hidden border border-slate-800 shadow-2xl group">
        <iframe
          src={embedUrl}
          title="YouTube Video Player - Clutter Free"
          frameBorder="0"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
          className="absolute inset-0 w-full h-full"
        />
      </div>

      {/* Info Notice about YouTube optimizations */}
      <div className="bg-indigo-950/30 border border-indigo-900/40 rounded-2xl p-5 flex flex-col sm:flex-row gap-4 items-start">
        <div className="bg-indigo-500/10 p-2.5 rounded-xl border border-indigo-500/20 text-indigo-400 shrink-0">
          <Sparkles className="w-5 h-5" />
        </div>
        <div>
          <h4 className="text-sm font-display font-semibold text-slate-100 flex items-center gap-2 mb-1">
            <Youtube className="w-4 h-4 text-rose-500" />
            {t.ytNoClutterTitle}
          </h4>
          <p className="text-xs text-slate-400 leading-relaxed">
            {t.ytNoClutterDesc}
          </p>
          <div className="mt-3 flex items-start gap-1.5 text-xs text-indigo-300">
            <Info className="w-3.5 h-3.5 mt-0.5 shrink-0 text-indigo-400" />
            <span>{t.tip1}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
