import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";

function cleanYoutubeUrl(url: string): string {
  try {
    let videoId = "";
    if (url.includes("youtu.be/")) {
      const parts = url.split("youtu.be/");
      if (parts[1]) {
        videoId = parts[1].split("?")[0].split("/")[0];
      }
    } else if (url.includes("youtube.com/watch")) {
      const queryStr = url.split("?")[1];
      if (queryStr) {
        const urlParams = new URLSearchParams(queryStr);
        videoId = urlParams.get("v") || "";
      }
    } else if (url.includes("youtube.com/embed/")) {
      const parts = url.split("youtube.com/embed/");
      if (parts[1]) {
        videoId = parts[1].split("?")[0];
      }
    } else if (url.includes("youtube.com/v/")) {
      const parts = url.split("youtube.com/v/");
      if (parts[1]) {
        videoId = parts[1].split("?")[0];
      }
    } else if (url.includes("youtube.com/shorts/")) {
      const parts = url.split("youtube.com/shorts/");
      if (parts[1]) {
        videoId = parts[1].split("?")[0];
      }
    } else if (url.includes("youtube.com/live/")) {
      const parts = url.split("youtube.com/live/");
      if (parts[1]) {
        videoId = parts[1].split("?")[0];
      }
    }
    
    if (videoId) {
      return `https://www.youtube.com/watch?v=${videoId}`;
    }
  } catch (e) {
    console.error("Failed to clean YouTube URL:", e);
  }
  return url;
}

function isDirectVideoUrl(url: string): boolean {
  try {
    const lowercase = url.toLowerCase();
    // Hugging Face dataset download / raw files
    if (lowercase.includes("huggingface.co")) {
      return true;
    }
    // Direct video extension check (with or without query parameters)
    const urlWithoutQuery = url.split("?")[0].split("#")[0].toLowerCase();
    if (
      urlWithoutQuery.endsWith(".mp4") ||
      urlWithoutQuery.endsWith(".webm") ||
      urlWithoutQuery.endsWith(".mkv") ||
      urlWithoutQuery.endsWith(".mov") ||
      urlWithoutQuery.endsWith(".avi") ||
      urlWithoutQuery.endsWith(".3gp") ||
      urlWithoutQuery.endsWith(".m4v")
    ) {
      return true;
    }
  } catch (e) {}
  return false;
}

function getFilenameFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname;
    const parts = pathname.split("/");
    const lastPart = parts[parts.length - 1];
    if (lastPart) {
      const decoded = decodeURIComponent(lastPart);
      if (decoded.includes(".")) {
        return decoded.split(".")[0]; // return without extension
      }
      return decoded;
    }
  } catch (e) {}
  return "Dataset Video";
}

interface CachedVideo {
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
}

async function startServer() {
  const app = express();
  const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

  // Writable downloads directory in project root
  const DOWNLOADS_DIR = path.join(process.cwd(), "downloads");
  const METADATA_PATH = path.join(DOWNLOADS_DIR, "metadata.json");

  // Ensure downloads directory exists
  if (!fs.existsSync(DOWNLOADS_DIR)) {
    fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
  }

  // Load and save helper functions for CachedVideos
  function loadMetadata(): Record<string, CachedVideo> {
    try {
      if (fs.existsSync(METADATA_PATH)) {
        const raw = fs.readFileSync(METADATA_PATH, "utf-8");
        return JSON.parse(raw);
      }
    } catch (e) {
      console.error("Failed to read metadata file:", e);
    }
    return {};
  }

  function saveMetadata(data: Record<string, CachedVideo>) {
    try {
      fs.writeFileSync(METADATA_PATH, JSON.stringify(data, null, 2), "utf-8");
    } catch (e) {
      console.error("Failed to write metadata file:", e);
    }
  }

  // Active download streams so we can cancel them if deleted
  const activeDownloads = new Map<string, { controller?: AbortController; fileStream?: fs.WriteStream }>();

  // Helper to extract YouTube info via oEmbed
  async function getYoutubeMetadata(videoUrl: string) {
    try {
      const response = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(videoUrl)}`);
      if (response.ok) {
        const data: any = await response.json();
        return {
          title: data.title || "YouTube Video",
          thumbnail: data.thumbnail_url || "https://images.unsplash.com/photo-1611162617213-7d7a39e9b1d7?w=120&q=80"
        };
      }
    } catch (e) {
      console.warn("Could not fetch oEmbed metadata for YouTube link:", e);
    }
    return {
      title: "YouTube Video (" + videoUrl.substring(0, 20) + "...)",
      thumbnail: "https://images.unsplash.com/photo-1611162617213-7d7a39e9b1d7?w=120&q=80"
    };
  }

  // Dynamic list of Cobalt endpoints
  let cachedCobaltEndpoints: string[] = [
    "https://api.cobalt.tools/api/json",
    "https://co.wuk.sh/api/json",
    "https://cobalt.api.ryb.ovh/api/json",
    "https://cobalt.shitty.moe/api/json",
    "https://cobalt.unblocker.lol/api/json",
    "https://cobalt.unblock.ch/api/json",
    "https://cobalt.smartit.nu/api/json",
    "https://cobalt.moe/api/json"
  ];
  let lastCobaltFetchTime = 0;

  async function fetchLatestCobaltEndpoints() {
    const now = Date.now();
    // Cache for 1 hour to prevent flooding registries
    if (now - lastCobaltFetchTime < 3600000 && lastCobaltFetchTime !== 0) {
      return;
    }

    try {
      console.log("Fetching dynamic Cobalt instances list...");
      const endpoints = new Set<string>([
        "https://api.cobalt.tools/api/json",
        "https://co.wuk.sh/api/json",
        "https://cobalt.api.ryb.ovh/api/json",
        "https://cobalt.shitty.moe/api/json",
        "https://cobalt.unblocker.lol/api/json",
        "https://cobalt.unblock.ch/api/json",
        "https://cobalt.smartit.nu/api/json",
        "https://cobalt.moe/api/json"
      ]);

      // 1. Fetch from official hyper.lol list
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 4000);
        const res = await fetch("https://instances.hyper.lol/instances.json", { signal: controller.signal });
        clearTimeout(timeoutId);
        if (res.ok) {
          const list: any = await res.json();
          if (Array.isArray(list)) {
            for (const item of list) {
              if (item.api && item.state === "up") {
                let api: string = item.api;
                if (!api.startsWith("http")) api = "https://" + api;
                const finalUrl = api.endsWith("/api/json") 
                  ? api 
                  : (api.endsWith("/") ? api + "api/json" : api + "/api/json");
                endpoints.add(finalUrl);
              }
            }
          }
        }
      } catch (e: any) {
        // Silent catch for registry fetch issues
      }

      // 2. Fetch from sadb0y's cobalt-instances registry
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 4000);
        const res = await fetch("https://raw.githubusercontent.com/sadb0y/cobalt-instances/master/instances.json", { signal: controller.signal });
        clearTimeout(timeoutId);
        if (res.ok) {
          const list: any = await res.json();
          if (Array.isArray(list)) {
            for (const item of list) {
              if (item.url && item.state !== "down") {
                let url: string = item.url;
                if (!url.startsWith("http")) url = "https://" + url;
                const finalUrl = url.endsWith("/api/json") 
                  ? url 
                  : (url.endsWith("/") ? url + "api/json" : url + "/api/json");
                endpoints.add(finalUrl);
              }
            }
          }
        }
      } catch (e: any) {
        // Silent catch for registry fetch issues
      }

      if (endpoints.size > 5) {
        cachedCobaltEndpoints = Array.from(endpoints);
        lastCobaltFetchTime = now;
        console.log(`Updated Cobalt instances pool. Total endpoints: ${cachedCobaltEndpoints.length}`);
      }
    } catch (e: any) {
      // Silent catch for registry fetch issues
    }
  }

  // Helper to resolve YouTube URL to a direct video stream URL using Cobalt tools
  async function resolveUrlWithCobalt(url: string, quality: string): Promise<string | null> {
    await fetchLatestCobaltEndpoints();

    // Randomize the endpoints to distribute traffic and try fresh nodes on failure
    const instances = [...cachedCobaltEndpoints].sort(() => Math.random() - 0.5);

    for (const apiEndpoint of instances) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000); // reduced timeout for faster iteration

      try {
        console.log(`Resolving streaming link from Cobalt: ${apiEndpoint}`);
        const response = await fetch(apiEndpoint, {
          method: "POST",
          headers: {
            "Accept": "application/json",
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            url: url,
            videoQuality: quality || "360",
            audioFormat: "mp3",
            downloadMode: "video",
            isNoTTWatermark: true
          }),
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          continue;
        }

        const data: any = await response.json();
        if (data.status === "stream" && data.url) {
          console.log(`Successfully resolved direct stream link from ${apiEndpoint}`);
          return data.url;
        }
        if (data.status === "redirect" && data.url) {
          console.log(`Successfully resolved redirect stream link from ${apiEndpoint}`);
          return data.url;
        }
        if (data.url) {
          console.log(`Successfully resolved generic link from ${apiEndpoint}`);
          return data.url;
        }
        if (data.picker && data.picker.length > 0) {
          const videoItem = data.picker.find((p: any) => p.type === "video" || p.url);
          if (videoItem) {
            console.log(`Successfully resolved picker link from ${apiEndpoint}`);
            return videoItem.url;
          }
        }
      } catch (err: any) {
        clearTimeout(timeoutId);
      }
    }
    return null;
  }

  app.use(express.json());

  // 1. GET - List all downloading & downloaded videos
  app.get("/api/videos", (req, res) => {
    const metadata = loadMetadata();
    // Return sorted such that completed videos (progress = 100) are at the very top (en başta),
    // and among them, sorted by addedAt (newest first).
    const list = Object.values(metadata).sort((a, b) => {
      const aVal = a.progress === 100 ? 1 : 0;
      const bVal = b.progress === 100 ? 1 : 0;
      if (aVal !== bVal) {
        return bVal - aVal; // 100% progress/completed first
      }
      return b.addedAt - a.addedAt;
    });
    res.json(list);
  });

  // 2. POST - Start downloading YouTube / web video in background
  app.post("/api/videos/download", async (req, res) => {
    const { url, quality, isLive } = req.body;

    if (!url) {
      return res.status(400).json({ error: "URL is required" });
    }

    const id = Date.now().toString();
    const videoPath = path.join(DOWNLOADS_DIR, `${id}.mp4`);

    // Clean YouTube URL
    const isYt = url.includes("youtube.com") || url.includes("youtu.be");
    const cleanedUrl = isYt ? cleanYoutubeUrl(url) : url;

    const isDirect = isDirectVideoUrl(cleanedUrl);
    const isHf = cleanedUrl.toLowerCase().includes("huggingface.co");

    // Get metadata info
    let info;
    if (isYt) {
      info = await getYoutubeMetadata(cleanedUrl);
    } else if (isDirect) {
      const filename = getFilenameFromUrl(cleanedUrl);
      info = {
        title: isHf ? "Hugging Face: " + filename : "Direct Video: " + filename,
        thumbnail: isHf
          ? "https://images.unsplash.com/photo-1620712943543-bcc4688e7485?w=120&q=80"
          : "https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=120&q=80"
      };
    } else {
      info = {
        title: url.includes(".m3u8") || isLive 
          ? "Canlı Yayın (" + url.substring(0, 30) + "...)" 
          : "Web Video (" + url.substring(0, 30) + ")",
        thumbnail: url.includes(".m3u8") || isLive
          ? "https://images.unsplash.com/photo-1526698905402-e1a019a38641?w=120&q=80"
          : "https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=120&q=80"
      };
    }

    try {
      // If it is a live stream or requested as live/instant, save immediately without background download
      if (isLive || url.includes(".m3u8") || url.includes("/live/") || url.includes("youtube.com/live")) {
        const metadata = loadMetadata();
        const newVideo: CachedVideo = {
          id,
          url: cleanedUrl,
          streamUrl: cleanedUrl,
          title: info.title,
          thumbnail: info.thumbnail,
          status: "completed",
          progress: 100,
          totalSize: 0,
          downloadedSize: 0,
          quality: "live",
          addedAt: Date.now(),
          isLive: true
        };

        metadata[id] = newVideo;
        saveMetadata(metadata);
        return res.json(newVideo);
      }

      // Resolve streaming URL before responding so client has immediate streamUrl for proxy playing!
      let streamUrl = cleanedUrl;
      if (isDirect) {
        console.log(`Bypassing Cobalt for direct/HuggingFace video stream: ${cleanedUrl}`);
      } else {
        console.log(`Resolving Cobalt stream for: ${cleanedUrl}`);
        const resolved = await resolveUrlWithCobalt(cleanedUrl, quality);
        if (!resolved) {
          return res.status(502).json({ error: "Could not extract stream. Video might be restricted, copyright protected, or Cobalt API is busy." });
        }
        streamUrl = resolved;
      }

      const metadata = loadMetadata();
      const newVideo: CachedVideo = {
        id,
        url: cleanedUrl,
        streamUrl,
        title: info.title,
        thumbnail: info.thumbnail,
        status: "downloading",
        progress: 0,
        totalSize: 0,
        downloadedSize: 0,
        quality: quality || "max",
        addedAt: Date.now()
      };

      metadata[id] = newVideo;
      saveMetadata(metadata);

      // Send instant response to client that download has started and provide streamUrl
      res.json(newVideo);

      // Asynchronous background download
      (async () => {
        const abortController = new AbortController();
        const fileStream = fs.createWriteStream(videoPath);
        activeDownloads.set(id, { controller: abortController, fileStream });

        try {
          // Connect to stream
          const response = await fetch(streamUrl, { signal: abortController.signal });
          if (!response.ok) {
            throw new Error(`Failed to stream content: HTTP ${response.status}`);
          }

          const totalSize = parseInt(response.headers.get("content-length") || "0", 10);
          const contentType = response.headers.get("content-type") || "video/mp4";
          
          // Update total size & content type in metadata
          const currentMeta = loadMetadata();
          if (currentMeta[id]) {
            currentMeta[id].totalSize = totalSize;
            currentMeta[id].contentType = contentType;
            saveMetadata(currentMeta);
          }

          if (!response.body) throw new Error("Empty video stream received.");

          let downloadedSize = 0;
          let lastSavedProgress = -1;
          let lastSavedTime = 0;

          // Custom stream reader to allow real-time progress calculations & pipe to local disk
          const reader = (response.body as any).getReader();
          
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              fileStream.end();
              const completedMeta = loadMetadata();
              if (completedMeta[id]) {
                completedMeta[id].status = "completed";
                completedMeta[id].progress = 100;
                completedMeta[id].downloadedSize = totalSize || downloadedSize;
                saveMetadata(completedMeta);
              }
              break;
            }

            fileStream.write(Buffer.from(value));
            downloadedSize += value.length;

            const progress = totalSize > 0 ? Math.round((downloadedSize / totalSize) * 100) : 0;
            const now = Date.now();
            // Throttle metadata write to save I/O cycles: write if progress increases, or every 500ms
            if (progress !== lastSavedProgress && (now - lastSavedTime > 500 || progress === 100)) {
              const currentMeta = loadMetadata();
              if (currentMeta[id]) {
                currentMeta[id].downloadedSize = downloadedSize;
                currentMeta[id].progress = progress;
                saveMetadata(currentMeta);
              }
              lastSavedProgress = progress;
              lastSavedTime = now;
            }
          }
        } catch (err: any) {
          console.error(`Background download failed for ${id}:`, err.message);
          fileStream.end();
          
          // Clean up partial file on failure
          if (fs.existsSync(videoPath)) {
            try {
              fs.unlinkSync(videoPath);
            } catch (_) {}
          }

          const currentMeta = loadMetadata();
          if (currentMeta[id]) {
            currentMeta[id].status = "failed";
            currentMeta[id].error = err.message || "Unknown error";
            saveMetadata(currentMeta);
          }
        } finally {
          activeDownloads.delete(id);
        }
      })();

    } catch (error: any) {
      console.error("Download setup error:", error);
      res.status(500).json({ error: error.message || "Internal server error" });
    }
  });

  // 3. DELETE - Cancel download and remove video files from cache
  app.delete("/api/videos/:id", (req, res) => {
    const { id } = req.params;
    const metadata = loadMetadata();

    // Abort active download stream if any
    const active = activeDownloads.get(id);
    if (active) {
      active.controller?.abort();
      active.fileStream?.end();
      activeDownloads.delete(id);
    }

    // Delete file
    const videoPath = path.join(DOWNLOADS_DIR, `${id}.mp4`);
    if (fs.existsSync(videoPath)) {
      try {
        fs.unlinkSync(videoPath);
      } catch (e) {
        console.error(`Could not delete file ${videoPath}:`, e);
      }
    }

    // Delete transcoded file if it exists
    const transcodedPath = path.join(DOWNLOADS_DIR, `${id}-transcoded.mp4`);
    if (fs.existsSync(transcodedPath)) {
      try {
        fs.unlinkSync(transcodedPath);
      } catch (e) {
        console.error(`Could not delete transcoded file ${transcodedPath}:`, e);
      }
    }

    // Remove from metadata list
    if (metadata[id]) {
      delete metadata[id];
      saveMetadata(metadata);
    }

    res.json({ success: true });
  });

  // 3b. POST - Transcode downloaded video to super low-overhead Baseline MP4 (Server-side E1-1200 CPU Saver Mode)
  app.post("/api/videos/transcode/:id", (req, res) => {
    const { id } = req.params;
    const { targetFps = 20, targetScale = "426:240" } = req.body;

    const metadata = loadMetadata();
    const video = metadata[id];

    if (!video) {
      return res.status(404).json({ error: "Video metadata not found" });
    }

    const inputPath = path.join(DOWNLOADS_DIR, `${id}.mp4`);
    const outputPath = path.join(DOWNLOADS_DIR, `${id}-transcoded.mp4`);

    if (!fs.existsSync(inputPath)) {
      return res.status(404).json({ error: "Source video file not found in local cache. Please download it first." });
    }

    if (video.transcodeStatus === "processing") {
      return res.json({ message: "Transcoding is already in progress.", video });
    }

    video.transcodeStatus = "processing";
    video.transcodeProgress = 0;
    metadata[id] = video;
    saveMetadata(metadata);

    res.json({ message: "Transcoding started on server.", video });

    // Use spawn to launch ffmpeg in background
    const { spawn } = require("child_process");
    const ffmpegArgs = [
      "-y",
      "-i", inputPath,
      "-vf", `scale=${targetScale},fps=${targetFps}`,
      "-c:v", "libx264",
      "-profile:v", "baseline",
      "-level", "3.0",
      "-preset", "ultrafast",
      "-tune", "fastdecode",
      "-pix_fmt", "yuv420p",
      "-b:v", "200k",
      "-c:a", "aac",
      "-b:a", "64k",
      "-ac", "2",
      outputPath
    ];

    console.log(`[FFmpeg Server Transcode] Starting for id: ${id}, args: ${ffmpegArgs.join(" ")}`);
    const ffmpeg = spawn("ffmpeg", ffmpegArgs);

    let duration = 0;

    ffmpeg.stderr.on("data", (data: Buffer) => {
      const line = data.toString();
      
      // Parse duration to estimate progress
      if (line.includes("Duration:")) {
        const match = line.match(/Duration: (\d{2}):(\d{2}):(\d{2})/);
        if (match) {
          duration = parseInt(match[1], 10) * 3600 + parseInt(match[2], 10) * 60 + parseInt(match[3], 10);
        }
      }
      
      // Parse current time to calculate progress
      if (line.includes("time=")) {
        const match = line.match(/time=(\d{2}):(\d{2}):(\d{2})/);
        if (match && duration > 0) {
          const currentTime = parseInt(match[1], 10) * 3600 + parseInt(match[2], 10) * 60 + parseInt(match[3], 10);
          const progress = Math.min(99, Math.round((currentTime / duration) * 100));
          
          const currentMeta = loadMetadata();
          if (currentMeta[id] && currentMeta[id].transcodeStatus === "processing") {
            currentMeta[id].transcodeProgress = progress;
            saveMetadata(currentMeta);
          }
        }
      }
    });

    ffmpeg.on("close", (code: number) => {
      const currentMeta = loadMetadata();
      if (!currentMeta[id]) return;

      if (code === 0 && fs.existsSync(outputPath)) {
        console.log(`[FFmpeg Server Transcode] Completed successfully for video ${id}`);
        currentMeta[id].transcodeStatus = "completed";
        currentMeta[id].transcodeProgress = 100;
        currentMeta[id].isTranscoded = true;

        const stat = fs.statSync(outputPath);
        currentMeta[id].originalSize = currentMeta[id].totalSize || currentMeta[id].downloadedSize;
        currentMeta[id].downloadedSize = stat.size;
        currentMeta[id].totalSize = stat.size;

        saveMetadata(currentMeta);
      } else {
        console.error(`[FFmpeg Server Transcode] Failed for video ${id} with exit code ${code}`);
        currentMeta[id].transcodeStatus = "failed";
        currentMeta[id].error = `Transcoding failed (exit code ${code})`;
        saveMetadata(currentMeta);

        if (fs.existsSync(outputPath)) {
          try { fs.unlinkSync(outputPath); } catch (_) {}
        }
      }
    });
  });

  // 4. GET - Stream downloaded/downloading video using Range requests
  app.get("/api/video-stream/:id", (req, res) => {
    const { id } = req.params;
    let videoPath = path.join(DOWNLOADS_DIR, `${id}.mp4`);
    const transcodedPath = path.join(DOWNLOADS_DIR, `${id}-transcoded.mp4`);

    if (fs.existsSync(transcodedPath)) {
      videoPath = transcodedPath;
    }

    if (!fs.existsSync(videoPath)) {
      return res.status(404).json({ error: "Video file not found in local cache." });
    }

    // Get true content-type from metadata
    const metadata = loadMetadata();
    const videoMeta = metadata[id];
    const contentType = videoMeta?.contentType || "video/mp4";

    // Standard video streaming headers with support for growing files
    const stat = fs.statSync(videoPath);
    const fileSize = stat.size;
    const range = req.headers.range;

    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

      if (start >= fileSize) {
        res.status(416).send("Requested range not satisfiable\n" + start + " >= " + fileSize);
        return;
      }

      const chunksize = (end - start) + 1;
      const file = fs.createReadStream(videoPath, { start, end });
      const head = {
        "Content-Range": `bytes ${start}-${end}/${fileSize}`,
        "Accept-Ranges": "bytes",
        "Content-Length": chunksize,
        "Content-Type": contentType,
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Range",
      };

      res.writeHead(206, head);
      file.pipe(res);
    } else {
      const head = {
        "Content-Length": fileSize,
        "Content-Type": contentType,
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Range",
      };
      res.writeHead(200, head);
      fs.createReadStream(videoPath).pipe(res);
    }
  });

  // 5. GET - Proxy stream direct from Cobalt (handles direct progressive play with proper CORS and codecs)
  app.get("/api/proxy-stream", async (req, res) => {
    const { url } = req.query;
    if (!url) {
      return res.status(400).send("URL parameter is required");
    }

    try {
      const decodedUrl = decodeURIComponent(url as string);
      console.log(`Proxying live stream from: ${decodedUrl}`);

      const range = req.headers.range;
      const headers: Record<string, string> = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      };
      if (range) {
        headers["Range"] = range;
      }

      const response = await fetch(decodedUrl, { headers });
      
      const responseHeaders: Record<string, string | string[]> = {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Range",
      };
      const headersToCopy = [
        "content-type",
        "content-length",
        "content-range",
        "accept-ranges",
        "cache-control"
      ];

      headersToCopy.forEach(header => {
        const val = response.headers.get(header);
        if (val) {
          responseHeaders[header] = val;
        }
      });

      // Default content type if missing
      if (!responseHeaders["content-type"]) {
        responseHeaders["content-type"] = "video/mp4";
      }

      res.writeHead(response.status, responseHeaders);

      if (response.body) {
        const reader = (response.body as any).getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(Buffer.from(value));
        }
        res.end();
      } else {
        res.end();
      }
    } catch (err: any) {
      console.error("Proxy streaming failed:", err.message);
      if (!res.headersSent) {
        res.status(500).send("Failed to proxy video stream: " + err.message);
      }
    }
  });

  // API to resolve YouTube URL to a direct video stream URL
  app.post("/api/resolve-video", async (req, res) => {
    const { url, quality } = req.body;
    if (!url) return res.status(400).json({ error: "URL is required" });

    const streamUrl = await resolveUrlWithCobalt(url, quality);
    if (streamUrl) {
      return res.json({ streamUrl });
    }
    return res.status(502).json({ error: "Could not extract direct stream link." });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer().catch(err => {
  console.error("Failed to start server:", err);
});
