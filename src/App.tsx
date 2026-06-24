import React, { useState, useRef, useEffect } from 'react';
import { PlayerSettings, DiagnosticsData, Language, CachedVideo } from './types';
import { translations } from './utils/translations';
import CanvasPlayer from './components/CanvasPlayer';
import YoutubePlayer from './components/YoutubePlayer';
import Diagnostics from './components/Diagnostics';
import HelpGuides from './components/HelpGuides';
import { 
  Upload, Link2, FileVideo, Youtube, Globe, MonitorPlay, 
  Trash2, Play, AlertCircle, RefreshCw, Cpu, Check, Loader2, PlayCircle, Settings, HardDrive, Sparkles, Info
} from 'lucide-react';

export default function App() {
  // Localization state
  const [lang, setLang] = useState<Language>('tr');
  const t = translations[lang];

  // Beautiful Custom Modal Alert State
  const [customAlert, setCustomAlert] = useState<{
    show: boolean;
    title: string;
    message: string;
    type: 'error' | 'warning' | 'info';
    isYt?: boolean;
    url?: string;
  } | null>(null);

  const showAlert = (
    title: string,
    message: string,
    type: 'error' | 'warning' | 'info' = 'error',
    isYt: boolean = false,
    url: string = ''
  ) => {
    setCustomAlert({ show: true, title, message, type, isYt, url });
  };

  const handleConfirmYtFallback = (url: string) => {
    setYoutubePlayMethod('iframe');
    setVideoSource(url);
    setActiveVideoId('');
    setInputUrl('');
    setCustomAlert(null);
  };

  const handleCloseAlert = () => {
    setCustomAlert(null);
  };

  // Global notification banner state
  const [notification, setNotification] = useState<{ message: string; type: 'info' | 'error' | 'success' } | null>(null);

  const showNotification = (message: string, type: 'info' | 'error' | 'success' = 'info') => {
    setNotification({ message, type });
    setTimeout(() => {
      setNotification(prev => prev?.message === message ? null : prev);
    }, 7000);
  };

  // Selected video source (can be a File or a string URL)
  const [videoSource, setVideoSource] = useState<File | string | null>(null);
  const [inputUrl, setInputUrl] = useState<string>('');
  const [activeVideoId, setActiveVideoId] = useState<string | null>(null);
  
  // Cache download list
  const [cachedVideos, setCachedVideos] = useState<CachedVideo[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [resolutionQuality, setResolutionQuality] = useState<string>('360'); // Low res by default to save bandwidth/CPU

  // Selected view method (we can support 'canvas' for FPS/Quality control, or 'iframe' for fallback if needed)
  const [youtubePlayMethod, setYoutubePlayMethod] = useState<'canvas' | 'iframe'>('canvas');

  // Drag and drop state
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Player settings state
  const [settings, setSettings] = useState<PlayerSettings>({
    fpsLimit: 24, // Optimized default FPS limit (film standard, 24fps)
    resolutionScale: 0.5, // Optimized default downsampling (50% scale)
    playbackRate: 1.0,
    mode: 'canvas', // Default to performance canvas mode!
    audioVolume: 0.8
  });

  // Diagnostics state
  const [diagnostics, setDiagnostics] = useState<DiagnosticsData>({
    fps: 0,
    droppedFrames: 0,
    renderedFrames: 0,
    cpuLoadEstimate: 'Low',
    canvasWidth: 0,
    canvasHeight: 0
  });

  // Fetch cached downloads list
  const fetchCachedVideos = async () => {
    try {
      const response = await fetch('/api/videos');
      if (response.ok) {
        const data = await response.json();
        setCachedVideos(data);
      }
    } catch (err) {
      console.warn('Could not fetch cached videos list:', err);
    }
  };

  // Poll for downloads progress
  useEffect(() => {
    fetchCachedVideos();
    const interval = setInterval(() => {
      // If there are downloading videos, poll more actively
      fetchCachedVideos();
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  // Is active video standard YouTube iframe (fallback)
  const activeVideo = activeVideoId ? cachedVideos.find(v => v.id === activeVideoId) : null;
  const isYoutubeIframeFallback = youtubePlayMethod === 'iframe' && (
    (typeof videoSource === 'string' && (videoSource.includes('youtube.com') || videoSource.includes('youtu.be'))) ||
    (activeVideo && (activeVideo.url.includes('youtube.com') || activeVideo.url.includes('youtu.be')))
  );

  // Handles adding video to download queue
  const handleAddDownload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputUrl.trim()) return;

    const isYt = inputUrl.includes('youtube.com') || inputUrl.includes('youtu.be');

    // We always trigger the backend download, allowing the user to watch the video while it downloads!
    // If they selected the standard player, it will render the YouTube Player while caching runs in the background.

    setIsSubmitting(true);
    try {
      const response = await fetch('/api/videos/download', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url: inputUrl.trim(),
          quality: resolutionQuality
        })
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to schedule download on server');
      }

      const newDownload = await response.json();
      setInputUrl('');
      fetchCachedVideos();

      // Automatically play this newly added video while it downloads!
      handlePlayCachedVideo(newDownload.id, newDownload);
    } catch (err: any) {
      const msg = err.message || (lang === 'tr' ? 'Video indirme kuyruğuna eklenemedi!' : 'Could not add video to downloading queue!');
      
      if (isYt) {
        // Automatic high-quality fallback! Switches instantly to Iframe mode and plays the video.
        setYoutubePlayMethod('iframe');
        setVideoSource(inputUrl.trim());
        setActiveVideoId('');
        setInputUrl('');
        
        showNotification(
          lang === 'tr'
            ? 'Doğrudan akış çözülemedi (Cobalt sunucuları meşgul veya engellenmiş olabilir). Reklamsız Standart YouTube oynatıcısına otomatik geçiş yapıldı.'
            : 'Could not extract direct stream (Cobalt servers might be busy or blocked). Automatically falling back to the clutter-free Standard YouTube player.',
          'info'
        );
      } else {
        showNotification(msg, 'error');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  // Play a specific video from the cached downloads list
  const handlePlayCachedVideo = (id: string, directVideo?: CachedVideo) => {
    const video = directVideo || cachedVideos.find(v => v.id === id);
    if (!video) {
      const streamUrl = `/api/video-stream/${id}`;
      setVideoSource(streamUrl);
      setActiveVideoId(id);
      setYoutubePlayMethod('canvas');
      return;
    }

    if (video.status === 'failed' && (video.url.includes('youtube.com') || video.url.includes('youtu.be'))) {
      setYoutubePlayMethod('iframe');
      setVideoSource(video.url);
      setActiveVideoId(id);
      showNotification(
        lang === 'tr' 
          ? 'Bellekten Oynatılamadı: Bu video indirilememiş. Reklamsız Standart YouTube oynatıcısı ile oynatılıyor.' 
          : 'Could not play from cache: This video failed to download. Playing via Standard YouTube player instead.', 
        'info'
      );
      return;
    }

    if (video.status === 'completed') {
      const streamUrl = `/api/video-stream/${id}`;
      setVideoSource(streamUrl);
      if (youtubePlayMethod !== 'iframe') {
        setYoutubePlayMethod('canvas');
      }
    } else if (video.streamUrl) {
      // If still downloading or has streamUrl, play via direct proxy stream!
      const proxyUrl = `/api/proxy-stream?url=${encodeURIComponent(video.streamUrl)}`;
      setVideoSource(proxyUrl);
      if (youtubePlayMethod !== 'iframe') {
        setYoutubePlayMethod('canvas');
      }
    } else {
      const streamUrl = `/api/video-stream/${id}`;
      setVideoSource(streamUrl);
      if (youtubePlayMethod !== 'iframe') {
        setYoutubePlayMethod('canvas');
      }
    }
    setActiveVideoId(id);
  };

  // Delete video from cache
  const handleDeleteCachedVideo = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation(); // Avoid triggering play
    try {
      const response = await fetch(`/api/videos/${id}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        fetchCachedVideos();
        // If we are playing the deleted video, clear the player
        if (activeVideoId === id) {
          handleClear();
        }
      }
    } catch (err) {
      console.error('Failed to delete video:', err);
    }
  };

  // Handle Drag Events for local files
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      if (file.type.startsWith('video/')) {
        setVideoSource(file);
        setActiveVideoId(null);
        setInputUrl('');
      } else {
        showNotification(t.formatError, 'error');
      }
    }
  };

  // Handle Local File Selection
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      if (file.type.startsWith('video/')) {
        setVideoSource(file);
        setActiveVideoId(null);
        setInputUrl('');
      } else {
        showNotification(t.formatError, 'error');
      }
    }
  };

  // Clear loaded video
  const handleClear = () => {
    setVideoSource(null);
    setActiveVideoId(null);
    setInputUrl('');
    setDiagnostics({
      fps: 0,
      droppedFrames: 0,
      renderedFrames: 0,
      cpuLoadEstimate: 'Low',
      canvasWidth: 0,
      canvasHeight: 0
    });
  };

  // Language switch
  const toggleLanguage = () => {
    setLang(prev => (prev === 'tr' ? 'en' : 'tr'));
  };

  // Helper to format bytes
  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans selection:bg-indigo-600/30">
      
      {/* Floating Notification Toast */}
      {notification && (
        <div className="fixed top-20 right-4 z-[99] max-w-sm w-full bg-slate-900 border border-slate-800 rounded-2xl p-4 shadow-2xl flex items-start gap-3 transition-all duration-300">
          <div className={`p-1.5 rounded-lg flex-shrink-0 ${
            notification.type === 'error' 
              ? 'bg-rose-500/10 text-rose-500' 
              : notification.type === 'success'
              ? 'bg-emerald-500/10 text-emerald-500'
              : 'bg-indigo-500/10 text-indigo-400'
          }`}>
            <AlertCircle className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-slate-200 leading-relaxed">
              {notification.message}
            </p>
          </div>
          <button 
            onClick={() => setNotification(null)}
            className="text-slate-500 hover:text-slate-300 transition-colors text-xs p-1 cursor-pointer"
          >
            ×
          </button>
        </div>
      )}

      {/* Beautiful Custom Modal Alert */}
      {customAlert && customAlert.show && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm transition-all duration-300">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl flex flex-col gap-4 transform scale-100">
            <div className="flex items-start gap-3">
              <div className={`p-2 rounded-xl flex-shrink-0 ${
                customAlert.type === 'error' 
                  ? 'bg-rose-500/10 text-rose-500' 
                  : 'bg-amber-500/10 text-amber-500'
              }`}>
                <AlertCircle className="w-6 h-6" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-semibold text-slate-100">
                  {customAlert.title}
                </h3>
                <p className="mt-1 text-xs text-slate-400 whitespace-pre-line leading-relaxed">
                  {customAlert.message}
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-2.5 mt-2">
              {customAlert.isYt && customAlert.url ? (
                <>
                  <button
                    onClick={handleCloseAlert}
                    className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-950 hover:bg-slate-800 text-slate-400 transition-colors cursor-pointer border border-slate-900"
                  >
                    {lang === 'tr' ? 'Vazgeç' : 'Cancel'}
                  </button>
                  <button
                    onClick={() => handleConfirmYtFallback(customAlert.url!)}
                    className="px-4 py-2 rounded-xl text-xs font-semibold bg-rose-600 hover:bg-rose-500 text-white transition-colors cursor-pointer flex items-center gap-1.5 shadow-lg active:scale-95"
                  >
                    <Youtube className="w-3.5 h-3.5 fill-current" />
                    {lang === 'tr' ? 'Standart Oynatıcı ile Aç' : 'Open with Standard Player'}
                  </button>
                </>
              ) : (
                <button
                  onClick={handleCloseAlert}
                  className="px-5 py-2 rounded-xl text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white transition-colors cursor-pointer shadow-lg active:scale-95"
                >
                  {lang === 'tr' ? 'Tamam' : 'OK'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Top Premium Header */}
      <header className="border-b border-slate-900 bg-slate-950/85 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-indigo-600/10 p-2 rounded-xl border border-indigo-500/20 text-indigo-400 animate-pulse">
              <MonitorPlay className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-sm font-display font-bold tracking-tight text-white flex items-center gap-1.5">
                {t.title}
                <span className="text-[10px] text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 px-1.5 py-0.5 rounded-full font-mono">
                  v3.0-Live-Buffer
                </span>
              </h1>
              <p className="text-[10px] text-slate-400 font-sans hidden sm:block">
                {t.subtitle}
              </p>
            </div>
          </div>

          {/* Controls: Language toggle */}
          <div className="flex items-center gap-3">
            <button
              onClick={toggleLanguage}
              className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors shadow-sm active:scale-95 cursor-pointer"
            >
              <Globe className="w-3.5 h-3.5 text-slate-400" />
              {t.switchLang}
            </button>
          </div>
        </div>
      </header>

      {/* Main Body */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex flex-col gap-6">
        
        {/* Custom Toast Notification Banner */}
        {notification && (
          <div className={`p-4 rounded-2xl border flex items-start gap-3 animate-in fade-in slide-in-from-top-4 duration-350 shadow-lg ${
            notification.type === 'error' 
              ? 'bg-rose-950/30 border-rose-900/40 text-rose-200' 
              : notification.type === 'success' 
              ? 'bg-emerald-950/30 border-emerald-900/40 text-emerald-200' 
              : 'bg-indigo-950/35 border-indigo-900/45 text-indigo-200'
          }`}>
            <div className="shrink-0 mt-0.5">
              {notification.type === 'error' ? (
                <AlertCircle className="w-4 h-4 text-rose-400" />
              ) : notification.type === 'success' ? (
                <Check className="w-4 h-4 text-emerald-400" />
              ) : (
                <Info className="w-4 h-4 text-indigo-400" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-sans font-medium leading-relaxed">{notification.message}</p>
            </div>
            <button 
              type="button"
              onClick={() => setNotification(null)}
              className="text-slate-400 hover:text-slate-200 text-xs font-mono ml-2 cursor-pointer p-0.5"
            >
              ✕
            </button>
          </div>
        )}
        
        {/* Intro Banner for progressive download streaming */}
        <div className="bg-gradient-to-r from-slate-900 via-slate-900 to-indigo-950/20 rounded-2xl p-6 border border-slate-850 shadow-xl flex flex-col md:flex-row gap-6 items-center justify-between">
          <div className="space-y-2 max-w-4xl">
            <div className="inline-flex items-center gap-1.5 bg-indigo-500/10 border border-indigo-500/25 px-2.5 py-1 rounded-full text-[11px] font-mono text-indigo-300">
              <Sparkles className="w-3.5 h-3.5 animate-pulse text-indigo-400" />
              {lang === 'tr' ? 'KESİNTİSİZ ARKA PLAN TAMPON Belleği AKTİF' : 'SEAMLESS BACKGROUND STREAM BUFFER ACTIVE'}
            </div>
            <h2 className="text-lg font-display font-bold text-slate-100">
              {lang === 'tr' 
                ? 'İndirme Tamamlanmadan Anında Oynatın ve FPS/Kalite Değerlerini Ayarlayın!' 
                : 'Watch Immediately as it Downloads with custom FPS & Quality limits!'}
            </h2>
            <p className="text-xs text-slate-400 leading-relaxed">
              {lang === 'tr'
                ? 'Girdiğiniz YouTube linklerini doğrudan arka plandaki geçici belleğe indiriyoruz. Video inerken tamamen dolmasını beklemeden, "Oynat" butonu ile saniyeler içinde doğrudan video akışını izlemeye başlayabilirsiniz. Böylece YouTube\'un ağır yorumları, reklamları ve işlemciyi yoran elementleri olmadan, tüy gibi hafif Canvas oynatıcımızla saniyedeki kare hızını ve çözünürlüğü tam performans kontrol edersiniz!'
                : 'We now cache your YouTube link inputs locally on the backend. You do not need to wait for the download to finish! Press play, and the browser will buffer the video progressively, allowing the client-side canvas player to apply custom FPS and resolution scales instantly without standard YouTube player lag and heavy interfaces.'}
            </p>
          </div>
        </div>

        {/* Action Panel: Video Loaders & Players */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          
          {/* Left Column (8 columns): Active Player & Diagnostics */}
          <div className="lg:col-span-8 flex flex-col gap-6">
            
            {/* Player Viewport */}
            {videoSource ? (
              <div className="flex flex-col gap-4">
                {/* Active File Banner */}
                <div className="bg-slate-900 border border-slate-800 rounded-2xl px-5 py-3.5 flex items-center justify-between shadow-md">
                  <div className="flex items-center gap-3 min-w-0">
                    {activeVideoId ? (
                      <Youtube className="w-5 h-5 text-rose-500 shrink-0 animate-pulse" />
                    ) : (
                      <FileVideo className="w-5 h-5 text-indigo-400 shrink-0" />
                    )}
                    <span className="text-xs font-mono font-medium text-slate-200 truncate pr-4">
                      {activeVideoId 
                        ? (cachedVideos.find(v => v.id === activeVideoId)?.title || "YouTube Stream")
                        : (videoSource instanceof File ? videoSource.name : "Local Playback")
                      }
                    </span>
                  </div>

                  {activeVideoId && (
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] bg-indigo-600/20 text-indigo-400 px-2 py-0.5 rounded-full border border-indigo-500/20 font-mono">
                        {t.directBadge}
                      </span>
                    </div>
                  )}

                  <button
                    onClick={handleClear}
                    className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg border border-transparent hover:border-rose-500/20 transition-all active:scale-95 shrink-0 cursor-pointer"
                    title={t.clearVideo}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

                {/* Display active progressive download bar directly under active video */}
                {activeVideoId && cachedVideos.find(v => v.id === activeVideoId)?.status === 'downloading' && (
                  <div className="bg-indigo-950/20 border border-indigo-900/30 rounded-xl p-4 flex flex-col gap-2">
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-indigo-300 font-medium flex items-center gap-1.5">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        {t.progressLabel}
                      </span>
                      <span className="font-mono text-indigo-400">
                        {cachedVideos.find(v => v.id === activeVideoId)?.progress}%
                      </span>
                    </div>
                    <div className="w-full bg-slate-900 rounded-full h-1.5 overflow-hidden">
                      <div 
                        className="bg-indigo-500 h-1.5 rounded-full transition-all duration-300"
                        style={{ width: `${cachedVideos.find(v => v.id === activeVideoId)?.progress}%` }}
                      ></div>
                    </div>
                  </div>
                )}

                {/* Render corresponding player based on video type & play method */}
                {isYoutubeIframeFallback ? (
                  <YoutubePlayer 
                    url={activeVideo && (activeVideo.url.includes('youtube.com') || activeVideo.url.includes('youtu.be')) ? activeVideo.url : (videoSource as string)} 
                    lang={lang} 
                  />
                ) : (
                  <CanvasPlayer
                    file={videoSource}
                    settings={settings}
                    setSettings={setSettings}
                    lang={lang}
                    onUpdateDiagnostics={setDiagnostics}
                  />
                )}
              </div>
            ) : (
              /* Empty State Showcase */
              <div className="bg-slate-900/40 border border-slate-850 rounded-2xl p-12 text-center flex flex-col items-center justify-center gap-4 aspect-video shadow-inner">
                <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 shadow-xl text-slate-400 mb-2">
                  <FileVideo className="w-8 h-8 animate-pulse text-indigo-500" />
                </div>
                <h3 className="text-sm font-display font-bold text-slate-200">
                  {lang === 'tr' ? 'Oynatılacak Video Seçin' : 'Select a Video to Stream'}
                </h3>
                <p className="text-xs text-slate-400 max-w-sm leading-relaxed">
                  {t.noVideoSelected}
                </p>
              </div>
            )}

            {/* Diagnostics Panel (Always in main column for clear technical view) */}
            <Diagnostics 
              data={diagnostics} 
              lang={lang} 
              mode={videoSource ? (activeVideoId ? settings.mode : 'native') : 'canvas'} 
            />
          </div>

          {/* Right Column (4 columns): File loaders and Buffer Cache list */}
          <div className="lg:col-span-4 flex flex-col gap-6">
            
            {/* URL & File Input Card */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl flex flex-col gap-5">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                {t.loadVideo}
              </h3>

              {/* Form loader */}
              <form onSubmit={handleAddDownload} className="flex flex-col gap-3">
                <label className="text-[11px] font-semibold text-slate-300 flex items-center gap-1">
                  <Link2 className="w-3 h-3 text-slate-400" />
                  {t.youtubeUrl}
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder={t.youtubePlaceholder}
                    value={inputUrl}
                    onChange={(e) => setInputUrl(e.target.value)}
                    className="flex-1 bg-slate-950 border border-slate-800 hover:border-slate-700 focus:border-indigo-500 rounded-xl px-3 py-2 text-xs text-slate-200 placeholder-slate-600 outline-none transition-colors"
                  />
                  <button
                    type="submit"
                    disabled={!inputUrl.trim() || isSubmitting}
                    className="bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-40 disabled:cursor-not-allowed font-semibold px-3 py-2 rounded-xl text-xs transition-colors flex items-center gap-1.5 shadow-md active:scale-95 cursor-pointer"
                  >
                    {isSubmitting ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Play className="w-3.5 h-3.5 fill-current" />
                    )}
                    {t.playButton}
                  </button>
                </div>

                {/* Playback Method Selector */}
                <div className="mt-2 pt-2 border-t border-slate-800/60 flex flex-col gap-2">
                  <span className="text-[10px] text-slate-400 font-mono flex items-center gap-1">
                    <Sparkles className="w-3 h-3 text-indigo-400 animate-pulse" />
                    {t.watchModeLabel}
                  </span>
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      onClick={() => setYoutubePlayMethod('canvas')}
                      className={`px-2.5 py-1.5 rounded-xl text-[10px] font-sans border transition-all flex items-center justify-center gap-1 cursor-pointer ${
                        youtubePlayMethod === 'canvas'
                          ? 'bg-indigo-600/20 text-indigo-400 border-indigo-500/30 font-bold'
                          : 'bg-slate-950 text-slate-500 border-slate-900 hover:text-slate-300'
                      }`}
                    >
                      <Sparkles className="w-3 h-3 text-indigo-400" />
                      {lang === 'tr' ? 'Performans (Canvas)' : 'Performance (Canvas)'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setYoutubePlayMethod('iframe')}
                      className={`px-2.5 py-1.5 rounded-xl text-[10px] font-sans border transition-all flex items-center justify-center gap-1 cursor-pointer ${
                        youtubePlayMethod === 'iframe'
                          ? 'bg-rose-600/20 text-rose-400 border-rose-500/30 font-bold'
                          : 'bg-slate-950 text-slate-500 border-slate-900 hover:text-slate-300'
                      }`}
                    >
                      <Youtube className="w-3 h-3 text-rose-500" />
                      {lang === 'tr' ? 'Standart Oynatıcı' : 'Standard Player'}
                    </button>
                  </div>
                </div>

                {/* Quality selection for YouTube buffering */}
                <div className="mt-2 pt-2 border-t border-slate-800/60 flex items-center justify-between">
                  <span className="text-[10px] text-slate-400 font-mono flex items-center gap-1">
                    <Settings className="w-3 h-3 text-slate-500" />
                    {t.qualityAutoLabel}
                  </span>
                  <div className="flex gap-1">
                    {['240', '360', '480', '720', '1080', '1440', '2160', 'max'].map((q) => (
                      <button
                        key={q}
                        type="button"
                        onClick={() => setResolutionQuality(q)}
                        className={`px-1.5 py-0.5 text-[9px] rounded font-mono border transition-all cursor-pointer ${
                          resolutionQuality === q 
                            ? 'bg-indigo-600/20 text-indigo-400 border-indigo-500/30 font-bold' 
                            : 'bg-slate-950 text-slate-500 border-slate-900 hover:text-slate-300'
                        }`}
                      >
                        {q === 'max' ? 'MAX' : `${q}p`}
                      </button>
                    ))}
                  </div>
                </div>
              </form>

              <div className="relative flex py-1 items-center">
                <div className="flex-grow border-t border-slate-800/60"></div>
                <span className="flex-shrink mx-3 text-[9px] text-slate-500 font-mono uppercase">OR</span>
                <div className="flex-grow border-t border-slate-800/60"></div>
              </div>

              {/* File Drag and Drop for Local Files */}
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`border border-dashed rounded-xl p-4 text-center cursor-pointer transition-all flex flex-col items-center justify-center gap-2 ${
                  isDragging 
                    ? 'border-indigo-500 bg-indigo-500/5' 
                    : 'border-slate-800 hover:border-slate-700 bg-slate-950/40 hover:bg-slate-950/80'
                }`}
              >
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileChange}
                  accept="video/*"
                  className="hidden"
                />
                <Upload className="w-4 h-4 text-slate-400" />
                <div className="space-y-0.5">
                  <p className="text-[10px] font-semibold text-slate-300">
                    {t.localVideo}
                  </p>
                  <p className="text-[9px] text-slate-500">
                    {t.dragDropText}
                  </p>
                </div>
              </div>
            </div>

            {/* Downloads & Cache List Panel */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl flex flex-col gap-4">
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-200 flex items-center justify-between">
                  <span>📥 {t.downloadsTitle}</span>
                  <span className="text-[10px] text-indigo-400 font-mono bg-indigo-500/10 px-1.5 py-0.5 rounded border border-indigo-500/20">
                    {cachedVideos.length}
                  </span>
                </h3>
                <p className="text-[10px] text-slate-400 mt-1 leading-relaxed">
                  {t.downloadsSubtitle}
                </p>
              </div>

              <div className="flex flex-col gap-3 max-h-[340px] overflow-y-auto pr-1">
                {cachedVideos.length === 0 ? (
                  <div className="text-center py-8 px-4 border border-dashed border-slate-800 rounded-xl bg-slate-950/30">
                    <p className="text-[11px] text-slate-500 leading-relaxed">
                      {t.emptyDownloads}
                    </p>
                  </div>
                ) : (
                  cachedVideos.map((video) => {
                    const isActive = activeVideoId === video.id;
                    return (
                      <div
                        key={video.id}
                        onClick={() => handlePlayCachedVideo(video.id)}
                        className={`group relative flex gap-3 p-2.5 rounded-xl border transition-all cursor-pointer items-center justify-between ${
                          isActive 
                            ? 'bg-indigo-600/10 border-indigo-500/40 shadow-md' 
                            : 'bg-slate-950 hover:bg-slate-900/60 border-slate-850 hover:border-slate-800'
                        }`}
                      >
                        {/* Title and Image Info */}
                        <div className="flex gap-2.5 items-center min-w-0 flex-1">
                          {/* Thumbnail */}
                          <div className="relative w-14 h-10 rounded overflow-hidden bg-slate-900 border border-slate-800 flex-shrink-0">
                            <img 
                              src={video.thumbnail || undefined} 
                              alt="Thumbnail" 
                              referrerPolicy="no-referrer"
                              className="w-full h-full object-cover"
                              onError={(e) => {
                                // Fallback image if youtube is blocked
                                (e.target as HTMLImageElement).src = "https://images.unsplash.com/photo-1611162617213-7d7a39e9b1d7?w=100&q=80";
                              }}
                            />
                            {/* Small status overlay */}
                            {video.status === 'downloading' && (
                              <div className="absolute inset-0 bg-slate-950/60 flex items-center justify-center">
                                <Loader2 className="w-3.5 h-3.5 text-indigo-400 animate-spin" />
                              </div>
                            )}
                          </div>

                          {/* Detail */}
                          <div className="flex-1 min-w-0">
                            <h4 className="text-[11px] font-medium text-slate-200 truncate group-hover:text-white transition-colors" title={video.title}>
                              {video.title}
                            </h4>
                            
                            {/* Status label / stats */}
                            <div className="flex items-center gap-1.5 mt-1">
                              {video.status === 'downloading' ? (
                                <span className="text-[9px] text-indigo-400 font-semibold flex items-center gap-1 font-mono">
                                  {video.progress}% {t.statusDownloading}
                                </span>
                              ) : video.status === 'completed' ? (
                                <span className="text-[9px] text-emerald-400 font-semibold flex items-center gap-0.5 font-mono">
                                  ✓ {lang === 'tr' ? 'Hazır' : 'Ready'}
                                </span>
                              ) : (
                                <span className="text-[9px] text-rose-400 font-semibold font-mono">
                                  ⚠ {lang === 'tr' ? 'Hata' : 'Failed'}
                                </span>
                              )}
                              
                              {video.totalSize > 0 && (
                                <span className="text-[9px] text-slate-500 font-mono">
                                  • {formatBytes(video.downloadedSize)} / {formatBytes(video.totalSize)}
                                </span>
                              )}
                            </div>

                            {/* Mini progress bar */}
                            {video.status === 'downloading' && (
                              <div className="w-full bg-slate-900 h-1 mt-1 rounded-full overflow-hidden">
                                <div 
                                  className="bg-indigo-500 h-1 rounded-full" 
                                  style={{ width: `${video.progress}%` }}
                                ></div>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Interactive control buttons */}
                        <div className="flex items-center gap-1 ml-2 flex-shrink-0">
                          {/* Play Button Overlay */}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handlePlayCachedVideo(video.id);
                            }}
                            className={`p-1 rounded-lg border transition-all ${
                              isActive 
                                ? 'bg-indigo-600 text-white border-indigo-500' 
                                : 'bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-indigo-400 border-slate-800'
                            }`}
                            title={t.playNow}
                          >
                            <PlayCircle className="w-3.5 h-3.5" />
                          </button>

                          {/* Delete from Cache */}
                          <button
                            onClick={(e) => handleDeleteCachedVideo(video.id, e)}
                            className="p-1 rounded-lg bg-slate-900 hover:bg-rose-950/30 text-slate-500 hover:text-rose-400 border border-slate-800 hover:border-rose-900/30 transition-all cursor-pointer"
                            title={t.actionDelete}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

          </div>
        </div>

        {/* Technical/Optimization Guides */}
        <HelpGuides lang={lang} />

      </main>

      {/* Humble footer */}
      <footer className="border-t border-slate-900 mt-16 py-8 text-center text-[11px] text-slate-500">
        <p>© 2026 {t.title} — {lang === 'tr' ? 'Düşük performanslı bilgisayarlar için sevgiyle yapıldı.' : 'Built with care for low-performance computers.'}</p>
      </footer>
    </div>
  );
}
