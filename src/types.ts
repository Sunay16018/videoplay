export interface PlayerSettings {
  fpsLimit: number; // e.g. 15, 20, 24, 30, 60
  resolutionScale: number; // e.g. 0.25, 0.5, 0.75, 1.0
  playbackRate: number; // e.g. 0.5, 0.75, 1.0, 1.25, 1.5, 2.0
  mode: 'native' | 'canvas' | 'audio';
  audioVolume: number;
}

export type Language = 'tr' | 'en';

export interface DiagnosticsData {
  fps: number;
  droppedFrames: number;
  renderedFrames: number;
  cpuLoadEstimate: 'Low' | 'Medium' | 'High';
  canvasWidth: number;
  canvasHeight: number;
}

export interface CachedVideo {
  id: string;
  url: string;
  streamUrl?: string;
  contentType?: string;
  title: string;
  thumbnail: string;
  status: "downloading" | "completed" | "failed";
  progress: number;
  totalSize: number;
  downloadedSize: number;
  quality: string;
  error?: string;
  addedAt: number;
  isTranscoded?: boolean;
  transcodeStatus?: 'idle' | 'processing' | 'completed' | 'failed';
  transcodeProgress?: number;
  originalSize?: number;
  isLive?: boolean;
  isLiveDownload?: boolean;
  recordedDuration?: number;
}
