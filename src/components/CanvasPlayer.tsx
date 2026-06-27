import React, { useRef, useEffect, useState } from 'react';
import Hls from 'hls.js';
import { PlayerSettings, DiagnosticsData, Language } from '../types';
import { translations } from '../utils/translations';
import { 
  Play, Pause, Volume2, VolumeX, SkipBack, 
  RotateCcw, Sliders, Cpu, HardDrive, Maximize2, Minimize2,
  Loader2, AlertCircle
} from 'lucide-react';

interface CanvasPlayerProps {
  file: File | string; // File object or direct URL
  settings: PlayerSettings;
  setSettings: React.Dispatch<React.SetStateAction<PlayerSettings>>;
  lang: Language;
  onUpdateDiagnostics: (data: DiagnosticsData) => void;
  activeVideoId?: string | null;
  activeVideo?: any;
}

export default function CanvasPlayer({ 
  file, 
  settings, 
  setSettings, 
  lang, 
  onUpdateDiagnostics,
  activeVideoId = null,
  activeVideo = null
}: CanvasPlayerProps) {
  const t = translations[lang];

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // UI state
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(settings.audioVolume);
  const [isMuted, setIsMuted] = useState(false);
  const [videoLoaded, setVideoLoaded] = useState(false);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [isHovered, setIsHovered] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isControlsVisible, setIsControlsVisible] = useState(true);
  const [isScrubbing, setIsScrubbing] = useState(false);

  // Keep a direct ref to settings for the animation loop to avoid dependency restarts
  const settingsRef = useRef(settings);
  useEffect(() => {
    settingsRef.current = settings;
    if (videoRef.current) {
      videoRef.current.playbackRate = settings.playbackRate;
    }
  }, [settings]);

  // Object URL for local files
  const [videoSrc, setVideoSrc] = useState<string>('');

  // Local transcoding states
  const [localTranscodeStatus, setLocalTranscodeStatus] = useState<'idle' | 'processing' | 'completed' | 'failed'>('idle');
  const [localTranscodeProgress, setLocalTranscodeProgress] = useState(0);
  const pollIntervalRef = useRef<any>(null);

  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, []);

  const handleStartLocalTranscode = async () => {
    if (!activeVideoId) return;
    setLocalTranscodeStatus('processing');
    setLocalTranscodeProgress(0);
    try {
      const response = await fetch(`/api/videos/transcode/${activeVideoId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          targetFps: 30,
          targetScale: "1280:720" // 720p is beautiful and plays smoothly on all systems
        })
      });
      if (response.ok) {
        startPollingTranscode();
      } else {
        setLocalTranscodeStatus('failed');
        setVideoError(lang === 'tr' ? 'Dönüştürme başlatılamadı.' : 'Failed to start transcoding.');
      }
    } catch (e) {
      setLocalTranscodeStatus('failed');
      setVideoError(lang === 'tr' ? 'Dönüştürme hatası oluştu.' : 'Transcoding error occurred.');
    }
  };

  const startPollingTranscode = () => {
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    
    pollIntervalRef.current = setInterval(async () => {
      try {
        const res = await fetch('/api/videos');
        if (res.ok) {
          const videos = await res.json();
          const currentVideo = videos.find((v: any) => v.id === activeVideoId);
          if (currentVideo) {
            if (currentVideo.transcodeStatus === 'processing') {
              setLocalTranscodeStatus('processing');
              setLocalTranscodeProgress(currentVideo.transcodeProgress || 0);
            } else if (currentVideo.transcodeStatus === 'completed' || currentVideo.isTranscoded) {
              setLocalTranscodeStatus('completed');
              setLocalTranscodeProgress(100);
              if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
              
              // Success! Clear video error and reload the video element with a cache buster
              setVideoError(null);
              setLocalTranscodeStatus('idle');
              setVideoLoaded(false);
              
              const buster = `?t=${Date.now()}`;
              const baseSrc = videoSrc.split('?')[0];
              setVideoSrc(`${baseSrc}${buster}`);
              
              if (videoRef.current) {
                videoRef.current.load();
                videoRef.current.play().catch(() => {});
              }
            } else if (currentVideo.transcodeStatus === 'failed') {
              setLocalTranscodeStatus('failed');
              if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
              setVideoError(lang === 'tr' 
                ? `Dönüştürme başarısız oldu: ${currentVideo.error || 'Bilinmeyen hata'}` 
                : `Transcoding failed: ${currentVideo.error || 'Unknown error'}`);
            }
          }
        }
      } catch (err) {
        console.error("Error polling transcode status:", err);
      }
    }, 1500);
  };

  useEffect(() => {
    let url = '';
    if (file instanceof File) {
      url = URL.createObjectURL(file);
    } else if (typeof file === 'string') {
      const lowercase = file.toLowerCase();
      const isDirect = lowercase.includes('huggingface.co') || 
                       lowercase.endsWith('.mp4') || 
                       lowercase.endsWith('.webm') || 
                       lowercase.endsWith('.mkv') || 
                       lowercase.endsWith('.mov') || 
                       lowercase.endsWith('.avi') || 
                       lowercase.endsWith('.3gp') || 
                       lowercase.endsWith('.m4v');
      
      // If it is a direct link, proxy it to guarantee CORS-compliant same-origin playback
      if (isDirect && file.startsWith('http') && !file.includes('/api/video-stream') && !file.includes('/api/proxy-stream')) {
        url = `/api/proxy-stream?url=${encodeURIComponent(file)}`;
      } else {
        url = file;
      }
    }
    setVideoSrc(url);
    setVideoLoaded(false);
    setIsPlaying(false);
    setVideoError(null);

    return () => {
      if (file instanceof File && url) {
        URL.revokeObjectURL(url);
      }
    };
  }, [file]);

  const hlsRef = useRef<Hls | null>(null);

  // Handle HLS live stream initialization
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }

    if (videoSrc && (videoSrc.includes('.m3u8') || videoSrc.includes('m3u8'))) {
      if (Hls.isSupported()) {
        const hls = new Hls({
          maxMaxBufferLength: 10, // Optimized buffering limit for low-end machines
          enableWorker: true,
          lowLatencyMode: true,
        });
        hls.loadSource(videoSrc);
        hls.attachMedia(video);
        hlsRef.current = hls;

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          setVideoLoaded(true);
        });

        hls.on(Hls.Events.ERROR, (event, data) => {
          if (data.fatal) {
            switch (data.type) {
              case Hls.ErrorTypes.NETWORK_ERROR:
                hls.startLoad();
                break;
              case Hls.ErrorTypes.MEDIA_ERROR:
                hls.recoverMediaError();
                break;
              default:
                setVideoError(lang === 'tr' ? 'Canlı yayın yüklenirken hata oluştu.' : 'Failed to load live stream.');
                break;
            }
          }
        });
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = videoSrc;
        video.addEventListener('loadedmetadata', handleLoadedMetadata);
      }
    }

    return () => {
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [videoSrc]);

  // Canvas loop variables
  const lastFrameTime = useRef<number>(0);
  const frameCount = useRef<number>(0);
  const lastFpsTime = useRef<number>(0);
  const totalDroppedFrames = useRef<number>(0);
  const expectedFrameTime = useRef<number>(0);
  const animationFrameId = useRef<number | null>(null);

  // Initialize playback rate whenever video loads
  useEffect(() => {
    if (videoRef.current && videoLoaded) {
      videoRef.current.playbackRate = settings.playbackRate;
    }
  }, [videoLoaded, settings.playbackRate]);

  // Canvas render loop
  useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;

    if (!video || !canvas || settings.mode !== 'canvas' || !isPlaying) {
      if (animationFrameId.current) {
        cancelAnimationFrame(animationFrameId.current);
        animationFrameId.current = null;
      }
      return;
    }

    const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
    if (!ctx) return;

    // Track frame times
    lastFrameTime.current = performance.now();
    lastFpsTime.current = performance.now();
    frameCount.current = 0;

    const renderLoop = (now: number) => {
      const currentSettings = settingsRef.current;
      const targetFps = currentSettings.fpsLimit;
      const fpsInterval = 1000 / targetFps;

      const elapsed = now - lastFrameTime.current;

      // Adjust canvas resolution dynamically
      const targetWidth = Math.max(120, Math.floor(video.videoWidth * currentSettings.resolutionScale)) || 640;
      const targetHeight = Math.max(90, Math.floor(video.videoHeight * currentSettings.resolutionScale)) || 360;

      if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
        canvas.width = targetWidth;
        canvas.height = targetHeight;
      }

      // Check if we should draw this frame
      if (targetFps === 60 || elapsed >= fpsInterval) {
        // Drop frames if elapsed is way behind (CPU is lagging)
        if (targetFps !== 60 && elapsed > fpsInterval * 2) {
          const missedFrames = Math.floor(elapsed / fpsInterval) - 1;
          totalDroppedFrames.current += Math.max(0, missedFrames);
        }

        // Save last frame time
        lastFrameTime.current = now - (targetFps === 60 ? 0 : elapsed % fpsInterval);

        // Draw video frame to scaled canvas
        try {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          frameCount.current++;
        } catch (e) {
          // Video frame might not be ready
        }
      }

      // Calculate actual output FPS every second
      const fpsElapsed = now - lastFpsTime.current;
      if (fpsElapsed >= 1000) {
        const actualFps = (frameCount.current * 1000) / fpsElapsed;
        
        // Estimate CPU load based on target vs actual FPS
        let cpuLoad: 'Low' | 'Medium' | 'High' = 'Low';
        const expectedFps = Math.min(targetFps, 30);
        if (actualFps < expectedFps * 0.6) {
          cpuLoad = 'High';
        } else if (actualFps < expectedFps * 0.85) {
          cpuLoad = 'Medium';
        }

        onUpdateDiagnostics({
          fps: actualFps,
          droppedFrames: totalDroppedFrames.current,
          renderedFrames: frameCount.current,
          cpuLoadEstimate: cpuLoad,
          canvasWidth: canvas.width,
          canvasHeight: canvas.height,
        });

        frameCount.current = 0;
        lastFpsTime.current = now;
      }

      animationFrameId.current = requestAnimationFrame(renderLoop);
    };

    animationFrameId.current = requestAnimationFrame(renderLoop);

    return () => {
      if (animationFrameId.current) {
        cancelAnimationFrame(animationFrameId.current);
        animationFrameId.current = null;
      }
    };
  }, [isPlaying, settings.mode, videoLoaded]);

  // Helper to draw a single frame to the canvas when paused/seeking
  const drawSingleFrame = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (video && canvas && settings.mode === 'canvas') {
      const currentSettings = settingsRef.current;
      const targetWidth = Math.max(120, Math.floor(video.videoWidth * currentSettings.resolutionScale)) || 640;
      const targetHeight = Math.max(90, Math.floor(video.videoHeight * currentSettings.resolutionScale)) || 360;

      if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
        canvas.width = targetWidth;
        canvas.height = targetHeight;
      }

      const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
      if (ctx) {
        try {
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        } catch (_) {}
      }
    }
  };

  // Draw single frame on load or settings switch while paused
  useEffect(() => {
    if (videoLoaded && settings.mode === 'canvas' && !isPlaying) {
      const timer = setTimeout(() => {
        drawSingleFrame();
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [videoLoaded, settings.mode, videoSrc, isPlaying]);

  // Update time tracker on native video ticks
  const handleTimeUpdate = () => {
    if (videoRef.current && !isScrubbing) {
      setCurrentTime(videoRef.current.currentTime);
    }
  };

  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      setDuration(videoRef.current.duration);
      setVideoLoaded(true);

      const target = (videoRef.current as any)._targetSeekTime;
      if (target !== undefined && target !== null) {
        videoRef.current.currentTime = target;
        setCurrentTime(target);
        delete (videoRef.current as any)._targetSeekTime;
      }

      // Trigger initial diagnostic info
      onUpdateDiagnostics({
        fps: 0,
        droppedFrames: 0,
        renderedFrames: 0,
        cpuLoadEstimate: 'Low',
        canvasWidth: videoRef.current.videoWidth,
        canvasHeight: videoRef.current.videoHeight,
      });
    }
  };

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;

    if (isPlaying) {
      video.pause();
      setIsPlaying(false);
    } else {
      video.play()
        .then(() => setIsPlaying(true))
        .catch(err => {
          setVideoError(lang === 'tr' ? 'Oynatılamadı. Format desteklenmiyor olabilir.' : 'Failed to play. Video format might not be supported.');
        });
    }
  };

  const performSeek = (newTime: number) => {
    const video = videoRef.current;
    if (!video) return;

    if (activeVideo?.isLiveDownload) {
      // Reload the video source with a unique timestamp to force the browser to check the new file size
      const baseSrc = videoSrc.split('?')[0];
      const buster = `?t=${Date.now()}`;
      setVideoSrc(`${baseSrc}${buster}`);
      
      // Store the target seek time so we can apply it when the metadata finishes loading
      (video as any)._targetSeekTime = newTime;
      
      // Load the video
      video.load();
      // Keep playing if it was playing
      if (isPlaying) {
        video.play().catch(() => {});
      }
    } else {
      video.currentTime = newTime;
      setCurrentTime(newTime);
      if (settings.mode === 'canvas' && !isPlaying) {
        setTimeout(() => {
          drawSingleFrame();
        }, 50);
      }
    }
  };

  const handleScrub = (e: React.ChangeEvent<HTMLInputElement>) => {
    const video = videoRef.current;
    if (!video) return;

    const newTime = parseFloat(e.target.value);
    
    // For non-live videos, we can seek immediately on scrub drag
    if (!activeVideo?.isLiveDownload) {
      video.currentTime = newTime;
      // If in canvas mode and paused, draw a single frame immediately on seeking
      if (settings.mode === 'canvas' && !isPlaying) {
        setTimeout(() => {
          drawSingleFrame();
        }, 50);
      }
    }
    setCurrentTime(newTime);
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const video = videoRef.current;
    if (!video) return;

    const val = parseFloat(e.target.value);
    video.volume = val;
    setVolume(val);
    setIsMuted(val === 0);
    setSettings(prev => ({ ...prev, audioVolume: val }));
  };

  const toggleMute = () => {
    const video = videoRef.current;
    if (!video) return;

    if (isMuted) {
      video.volume = volume === 0 ? 0.5 : volume;
      if (volume === 0) setVolume(0.5);
      setIsMuted(false);
    } else {
      video.volume = 0;
      setIsMuted(true);
    }
  };

  const formatTime = (timeInSeconds: number) => {
    if (isNaN(timeInSeconds)) return '00:00';
    const minutes = Math.floor(timeInSeconds / 60);
    const seconds = Math.floor(timeInSeconds % 60);
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  const skipRelative = (sec: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = Math.max(0, Math.min(duration, videoRef.current.currentTime + sec));
    }
  };

  const toggleFullscreen = () => {
    const container = document.getElementById('video-player-container');
    if (!container) return;

    if (!document.fullscreenElement) {
      container.requestFullscreen()
        .then(() => setIsFullscreen(true))
        .catch(err => {
          console.error("Error attempting to enable full-screen mode:", err);
        });
    } else {
      document.exitFullscreen()
        .then(() => setIsFullscreen(false))
        .catch(err => {
          console.error("Error attempting to exit full-screen mode:", err);
        });
    }
  };

  // Setup fullscreen change listener
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, []);

  // Keyboard shortcut listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept shortcuts if typing in any input fields
      const activeEl = document.activeElement;
      if (activeEl && (
        activeEl.tagName === 'INPUT' || 
        activeEl.tagName === 'TEXTAREA' || 
        activeEl.getAttribute('contenteditable') === 'true'
      )) {
        return;
      }

      switch (e.key.toLowerCase()) {
        case ' ':
          e.preventDefault();
          togglePlay();
          break;
        case 'f':
          e.preventDefault();
          toggleFullscreen();
          break;
        case 'm':
          e.preventDefault();
          toggleMute();
          break;
        case 'arrowleft':
          e.preventDefault();
          skipRelative(-10);
          break;
        case 'arrowright':
          e.preventDefault();
          skipRelative(10);
          break;
        case 'arrowup':
          e.preventDefault();
          if (videoRef.current) {
            const nextVol = Math.min(1, videoRef.current.volume + 0.1);
            videoRef.current.volume = nextVol;
            setVolume(nextVol);
            setIsMuted(nextVol === 0);
            setSettings(prev => ({ ...prev, audioVolume: nextVol }));
          }
          break;
        case 'arrowdown':
          e.preventDefault();
          if (videoRef.current) {
            const nextVol = Math.max(0, videoRef.current.volume - 0.1);
            videoRef.current.volume = nextVol;
            setVolume(nextVol);
            setIsMuted(nextVol === 0);
            setSettings(prev => ({ ...prev, audioVolume: nextVol }));
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isPlaying, isMuted, volume, duration]);

  // Hide controls in fullscreen after inactivity when playing
  useEffect(() => {
    let timeoutId: number;

    const handleMouseMove = () => {
      setIsControlsVisible(true);
      const container = document.getElementById('video-player-container');
      if (container) {
        container.style.cursor = 'default';
      }

      if (isPlaying) {
        clearTimeout(timeoutId);
        timeoutId = window.setTimeout(() => {
          if (isPlaying) {
            setIsControlsVisible(false);
            if (document.fullscreenElement && container) {
              container.style.cursor = 'none';
            }
          }
        }, 2000);
      }
    };

    const container = document.getElementById('video-player-container');
    if (isPlaying && container) {
      container.addEventListener('mousemove', handleMouseMove);
      handleMouseMove(); // Trigger first time
    } else {
      setIsControlsVisible(true);
      if (container) {
        container.style.cursor = 'default';
      }
    }

    return () => {
      if (container) {
        container.removeEventListener('mousemove', handleMouseMove);
        container.style.cursor = 'default';
      }
      clearTimeout(timeoutId);
    };
  }, [isPlaying, isFullscreen]);

  return (
    <div className="flex flex-col gap-6">
      {/* Video Viewport Container */}
      <div 
        id="video-player-container"
        className="relative aspect-video w-full bg-slate-950 rounded-2xl overflow-hidden border border-slate-800/80 shadow-2xl group flex items-center justify-center cursor-pointer"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        onClick={(e) => {
          // Only toggle play if clicking outside the control bar
          const controls = document.getElementById('player-controls-overlay');
          if (controls && !controls.contains(e.target as Node)) {
            togglePlay();
          }
        }}
        onDoubleClick={(e) => {
          const controls = document.getElementById('player-controls-overlay');
          if (controls && !controls.contains(e.target as Node)) {
            toggleFullscreen();
          }
        }}
      >
        {/* Hidden video element for Canvas rendering, or visible for native rendering */}
        <video
          ref={videoRef}
          src={videoSrc && (videoSrc.includes('.m3u8') || videoSrc.includes('m3u8')) ? undefined : (videoSrc || undefined)}
          className={(settings.mode === 'canvas' || settings.mode === 'audio') ? 'absolute inset-0 w-full h-full opacity-0 pointer-events-none' : 'w-full h-full object-contain block'}
          onTimeUpdate={handleTimeUpdate}
          onLoadedMetadata={handleLoadedMetadata}
          onError={() => {
            if (videoSrc && !(videoSrc.includes('.m3u8') || videoSrc.includes('m3u8'))) {
              const mediaError = videoRef.current?.error;
              let errMsg = lang === 'tr' ? 'Video formatı bu tarayıcıda açılamıyor.' : 'Video format is not supported by this browser.';
              if (mediaError) {
                errMsg += ` (Code: ${mediaError.code}, Message: ${mediaError.message || 'unknown'})`;
              }
              setVideoError(errMsg);
            }
          }}
          playsInline
        />

        {/* Visible Canvas element for customized downscaled/capped rendering */}
        {settings.mode === 'canvas' && (
          <canvas
            ref={canvasRef}
            className="w-full h-full object-contain bg-slate-950"
          />
        )}

        {/* Audio Only Mode Visualizer Overlay */}
        {settings.mode === 'audio' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950 text-slate-300 select-none animate-in fade-in duration-300">
            {/* Pulsating disk or music icon in the center */}
            <div className={`p-6 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 mb-4 relative flex items-center justify-center ${isPlaying ? 'animate-pulse' : ''}`}>
              <div className={`absolute inset-0 rounded-full border border-indigo-500/10 animate-ping opacity-25 ${isPlaying ? '' : 'paused'}`} style={{ animationDuration: '2s' }} />
              <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
              </svg>
            </div>
            
            <h4 className="text-sm font-semibold text-indigo-300 font-sans tracking-wide">
              {lang === 'tr' ? 'Sadece Ses Modu Aktif' : 'Audio-Only Mode Active'}
            </h4>
            <p className="text-[10px] text-slate-500 font-mono mt-1 uppercase tracking-wider">
              {isPlaying ? (lang === 'tr' ? 'Ses oynatılıyor...' : 'Playing audio stream...') : (lang === 'tr' ? 'Duraklatıldı' : 'Paused')}
            </p>

            {/* Bouncing audio wave bars */}
            <div className="flex items-end gap-1 h-8 mt-5">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((i) => {
                const delay = `${i * 0.08}s`;
                const duration = `${0.5 + (i % 4) * 0.15}s`;
                return (
                  <div
                    key={i}
                    className="w-1 bg-indigo-500 rounded-full transition-all duration-300"
                    style={{
                      height: isPlaying ? '100%' : '15%',
                      animation: isPlaying ? `bounceWave ${duration} ease-in-out infinite alternate` : 'none',
                      animationDelay: isPlaying ? delay : '0s',
                      minHeight: '4px',
                      maxHeight: '32px',
                    }}
                  />
                );
              })}
            </div>

            <style dangerouslySetInnerHTML={{__html: `
              @keyframes bounceWave {
                0% { height: 15%; }
                100% { height: 100%; }
              }
            `}} />
          </div>
        )}

        {/* Initial loading screen */}
        {!videoLoaded && !videoError && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950 text-slate-300">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-indigo-400 mb-3" />
            <p className="text-xs font-mono">{t.loading}</p>
          </div>
        )}

        {/* Error overlay */}
        {videoError && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/95 text-center px-6 py-4 overflow-y-auto z-20">
            {localTranscodeStatus === 'processing' ? (
              <div className="flex flex-col items-center justify-center max-w-md animate-in fade-in duration-300">
                <div className="bg-amber-500/10 p-3.5 rounded-full border border-amber-500/25 text-amber-400 mb-4">
                  <Loader2 className="w-6 h-6 animate-spin" />
                </div>
                <h4 className="text-sm font-bold font-display text-amber-400 mb-1">
                  {lang === 'tr' ? 'Video Dönüştürülüyor...' : 'Transcoding Video...'}
                </h4>
                <p className="text-[11px] text-slate-400 mb-4 leading-relaxed">
                  {lang === 'tr' 
                    ? 'Tarayıcınızın donmadan oynatabilmesi için video sunucuda standart H.264 Baseline formatına dönüştürülüyor. Lütfen bekleyin...' 
                    : 'The video is being converted on our server to standard H.264 Baseline format so your browser can play it smoothly. Please wait...'}
                </p>
                <div className="w-full bg-slate-900 rounded-full h-2 overflow-hidden mb-2 border border-slate-800">
                  <div 
                    className="bg-amber-500 h-2 rounded-full transition-all duration-300"
                    style={{ width: `${localTranscodeProgress}%` }}
                  ></div>
                </div>
                <span className="font-mono text-xs font-bold text-amber-400">
                  {localTranscodeProgress}%
                </span>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center max-w-lg animate-in fade-in duration-300">
                <div className="bg-rose-500/10 p-3.5 rounded-full border border-rose-500/25 text-rose-400 mb-3">
                  <AlertCircle className="w-6 h-6 animate-pulse" />
                </div>
                <h4 className="text-sm font-bold font-display text-rose-400 mb-1.5">
                  {lang === 'tr' ? 'Oynatma Hatası (Uyumsuz Format/Codec)' : 'Playback Error (Incompatible Format/Codec)'}
                </h4>
                <p className="text-[11px] text-slate-300 mb-4 leading-relaxed max-w-md">
                  {lang === 'tr' 
                    ? 'Bu video tarayıcınızın doğrudan çözemediği yüksek çözünürlüklü modern bir kodlamaya (örn. 4K AV1) sahip. Sorunu düzeltmek için tek tıkla videoyu sunucumuzda her tarayıcıyla %100 uyumlu Baseline formatına dönüştürebilirsiniz.' 
                    : 'This video uses a high-res codec (like 4K AV1) that your browser cannot play directly. You can solve this with one click by transcoding it on our server into standard, 100% compatible Baseline format.'}
                </p>
                
                <div className="bg-slate-900 border border-slate-800/60 rounded-xl px-4 py-2.5 mb-5 text-[10px] font-mono text-slate-400 max-w-sm truncate">
                  {videoError}
                </div>

                {activeVideoId ? (
                  <button
                    onClick={handleStartLocalTranscode}
                    className="flex items-center gap-2 bg-amber-500 hover:bg-amber-400 text-slate-950 px-5 py-2.5 rounded-xl text-xs font-bold transition-all shadow-md active:scale-95 cursor-pointer font-sans hover:shadow-amber-500/10"
                  >
                    <Cpu className="w-4 h-4" />
                    {lang === 'tr' ? '⚡ Videoyu Sunucuda Dönüştür (Önerilen)' : '⚡ Transcode on Server (Recommended)'}
                  </button>
                ) : (
                  <p className="text-[10px] text-slate-500 italic font-sans">
                    {lang === 'tr' 
                      ? 'İndirilen videoları dönüştürmek için lütfen sağdaki "Sunucuya İndir" seçeneğiyle ekleyin.' 
                      : 'Please add the video using "Download & Cache" on the right to enable server-side conversion.'}
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* Live recording badge indicator */}
        {activeVideo?.isLiveDownload && (
          <div className="absolute top-4 left-4 z-20 flex items-center gap-2 bg-slate-950/80 backdrop-blur-md border border-rose-500/30 px-2.5 py-1.5 rounded-full select-none shadow-lg">
            <span className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-ping absolute"></span>
            <span className="w-2.5 h-2.5 rounded-full bg-rose-500 inline-block"></span>
            <span className="text-[10px] font-bold text-rose-400 tracking-wider uppercase font-mono">
              {lang === 'tr' ? 'CANLI KAYIT İZLENİYOR' : 'WATCHING LIVE RECORDING'}
            </span>
          </div>
        )}

        {/* Video Controls Overlay (Fade in on hover or when paused or controls are active) */}
        <div 
          id="player-controls-overlay"
          className={`absolute bottom-0 left-0 right-0 bg-gradient-to-t from-slate-950/95 via-slate-950/80 to-transparent p-5 pt-12 transition-all duration-300 flex flex-col gap-3 z-10 ${
            isHovered || !isPlaying || isControlsVisible ? 'opacity-100 translate-y-0 pointer-events-auto' : 'opacity-0 translate-y-2 pointer-events-none'
          }`}
        >
          {/* Progress Bar (Scrubbing) */}
          <div className="flex items-center gap-3">
            <span className="text-[10px] text-slate-300 font-mono w-10 text-right">
              {formatTime(currentTime)}
            </span>
            <input
              type="range"
              min={0}
              max={Math.max(duration, activeVideo?.recordedDuration || 0) || 100}
              step={0.1}
              value={currentTime}
              onMouseDown={() => setIsScrubbing(true)}
              onTouchStart={() => setIsScrubbing(true)}
              onChange={handleScrub}
              onMouseUp={(e: any) => {
                setIsScrubbing(false);
                performSeek(parseFloat(e.target.value));
              }}
              onTouchEnd={(e: any) => {
                setIsScrubbing(false);
                performSeek(parseFloat(e.target.value));
              }}
              className="flex-1 accent-indigo-500 h-1 bg-slate-800 rounded-full cursor-pointer appearance-none outline-none focus:ring-1 focus:ring-indigo-400"
            />
            <span className="text-[10px] text-slate-300 font-mono w-10 text-left">
              {formatTime(Math.max(duration, activeVideo?.recordedDuration || 0))}
            </span>
          </div>

          {/* Controls Bar */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {/* Play/Pause Button */}
              <button
                type="button"
                onClick={togglePlay}
                disabled={!videoLoaded || !!videoError}
                className="w-10 h-10 flex items-center justify-center rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isPlaying ? <Pause className="w-4 h-4 fill-white" /> : <Play className="w-4 h-4 fill-white ml-0.5" />}
              </button>

              {/* Skip Back 10s */}
              <button
                type="button"
                onClick={() => skipRelative(-10)}
                disabled={!videoLoaded || !!videoError}
                className="p-2 text-slate-300 hover:text-white hover:bg-slate-900/60 rounded-lg transition-colors"
                title="10s Back"
              >
                <SkipBack className="w-4 h-4" />
              </button>

              {/* Volume Controller */}
              <div className="flex items-center gap-1.5 ml-2">
                <button
                  type="button"
                  onClick={toggleMute}
                  className="p-2 text-slate-300 hover:text-white hover:bg-slate-900/60 rounded-lg transition-colors"
                >
                  {isMuted ? <VolumeX className="w-4 h-4 text-rose-400" /> : <Volume2 className="w-4 h-4" />}
                </button>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={isMuted ? 0 : volume}
                  onChange={handleVolumeChange}
                  className="w-16 accent-slate-300 h-1 bg-slate-800 rounded-full cursor-pointer appearance-none outline-none"
                />
              </div>
            </div>

            {/* Playback speed indicators & Fullscreen toggle */}
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-slate-400 font-mono bg-slate-900/80 px-2 py-1 rounded-md border border-slate-800">
                {settings.playbackRate}x
              </span>

              {/* Fullscreen Button */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleFullscreen();
                }}
                className="p-2 text-slate-300 hover:text-white hover:bg-slate-900/60 rounded-lg transition-colors"
                title={isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
              >
                {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Speed Selector & Advanced Mode toggles */}
      <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-5 shadow-lg">
        <h3 className="text-sm font-display font-semibold text-slate-200 mb-4 flex items-center gap-2">
          <Sliders className="w-4 h-4 text-indigo-400" />
          {t.settingsTitle}
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Section 1: Mode Picker */}
          <div className="flex flex-col gap-3">
            <label className="text-xs font-semibold text-slate-300 tracking-wide uppercase">
              {t.playerMode}
            </label>
            <div className="grid grid-cols-3 gap-1.5 bg-slate-950 p-1 rounded-xl border border-slate-800">
              <button
                type="button"
                onClick={() => setSettings(prev => ({ ...prev, mode: 'native' }))}
                className={`py-2 px-1 text-[10px] font-medium rounded-lg transition-all text-center ${
                  settings.mode === 'native' 
                    ? 'bg-indigo-600/10 text-indigo-400 border border-indigo-500/20 shadow-sm' 
                    : 'text-slate-400 border border-transparent hover:text-slate-200'
                }`}
              >
                {t.nativeMode.split(' ')[0]}
              </button>
              <button
                type="button"
                onClick={() => setSettings(prev => ({ ...prev, mode: 'canvas' }))}
                className={`py-2 px-1 text-[10px] font-medium rounded-lg transition-all text-center ${
                  settings.mode === 'canvas' 
                    ? 'bg-indigo-600/15 text-indigo-400 border border-indigo-500/30 shadow-sm' 
                    : 'text-slate-400 border border-transparent hover:text-slate-200'
                }`}
              >
                🚀 {t.canvasMode.split(' ')[0]}
              </button>
              <button
                type="button"
                onClick={() => setSettings(prev => ({ ...prev, mode: 'audio' }))}
                className={`py-2 px-1 text-[10px] font-medium rounded-lg transition-all text-center ${
                  settings.mode === 'audio' 
                    ? 'bg-indigo-600/15 text-indigo-400 border border-indigo-500/30 shadow-sm' 
                    : 'text-slate-400 border border-transparent hover:text-slate-200'
                }`}
              >
                🎵 {lang === 'tr' ? 'Sadece Ses' : 'Audio Only'}
              </button>
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed mt-1">
              {settings.mode === 'canvas' ? t.canvasDesc : settings.mode === 'audio' ? t.audioDesc : t.nativeDesc}
            </p>
          </div>

          {/* Section 2: Canvas settings (Visible only in canvas mode) */}
          <div className={`flex flex-col gap-4 transition-all duration-300 ${settings.mode === 'canvas' ? 'opacity-100 pointer-events-auto' : 'opacity-40 pointer-events-none'}`}>
            {/* FPS Selector */}
            <div className="flex flex-col gap-2">
              <div className="flex justify-between items-center">
                <span className="text-xs font-semibold text-slate-300 uppercase tracking-wide">
                  {t.fpsLimitLabel}
                </span>
                <span className="text-xs font-mono font-bold text-indigo-400">
                  {settings.fpsLimit === 60 ? t.fpsUncapped : `${settings.fpsLimit} FPS`}
                </span>
              </div>
              <div className="flex gap-1.5 bg-slate-950 p-1 rounded-lg border border-slate-800">
                {[15, 20, 24, 30, 60].map((fps) => (
                  <button
                    key={fps}
                    type="button"
                    onClick={() => setSettings(prev => ({ ...prev, fpsLimit: fps }))}
                    className={`flex-1 py-1.5 rounded-md text-[10px] font-mono font-bold transition-colors ${
                      settings.fpsLimit === fps 
                        ? 'bg-indigo-600 text-white' 
                        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                    }`}
                  >
                    {fps === 60 ? 'MAX' : fps}
                  </button>
                ))}
              </div>
            </div>

            {/* Scale Selector */}
            <div className="flex flex-col gap-2">
              <div className="flex justify-between items-center">
                <span className="text-xs font-semibold text-slate-300 uppercase tracking-wide">
                  {t.resScaleLabel}
                </span>
                <span className="text-xs font-mono font-bold text-indigo-400">
                  {settings.resolutionScale * 100}%
                </span>
              </div>
              <div className="flex gap-1.5 bg-slate-950 p-1 rounded-lg border border-slate-800">
                {[0.25, 0.5, 0.75, 1.0].map((scale) => (
                  <button
                    key={scale}
                    type="button"
                    onClick={() => setSettings(prev => ({ ...prev, resolutionScale: scale }))}
                    className={`flex-1 py-1.5 rounded-md text-[10px] font-mono font-bold transition-colors ${
                      settings.resolutionScale === scale 
                        ? 'bg-indigo-600 text-white' 
                        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                    }`}
                  >
                    {scale * 100}%
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-slate-500 font-sans">
                {settings.resolutionScale === 0.25 ? `✨ ${t.resLow}` : settings.resolutionScale === 0.5 ? t.resMedium : settings.resolutionScale === 1.0 ? t.resOriginal : t.resHigh}
              </p>
            </div>
          </div>
        </div>

        {/* Playback rate control */}
        <div className="mt-5 pt-4 border-t border-slate-800/80 flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-300 uppercase tracking-wide">
            {t.playbackSpeed}
          </span>
          <div className="flex gap-2">
            {[0.5, 0.75, 1.0, 1.25, 1.5, 2.0].map((rate) => (
              <button
                key={rate}
                type="button"
                onClick={() => setSettings(prev => ({ ...prev, playbackRate: rate }))}
                className={`px-3 py-1 text-[11px] font-mono rounded-lg border transition-colors ${
                  settings.playbackRate === rate 
                    ? 'bg-indigo-600 text-white border-indigo-500' 
                    : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-slate-200'
                }`}
              >
                {rate}x
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
