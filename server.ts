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
    }
    
    if (videoId) {
      return `https://www.youtube.com/watch?v=${videoId}`;
    }
  } catch (e) {
    console.error("Failed to clean YouTube URL:", e);
  }
  return url;
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
}

async function startServer() {
  const app = express();
  const PORT = 3000;

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
    // Return sorted by added date (newest first)
    const list = Object.values(metadata).sort((a, b) => b.addedAt - a.addedAt);
    res.json(list);
  });

  // 2. POST - Start downloading YouTube / web video in background
  app.post("/api/videos/download", async (req, res) => {
    const { url, quality } = req.body;

    if (!url) {
      return res.status(400).json({ error: "URL is required" });
    }

    const id = Date.now().toString();
    const videoPath = path.join(DOWNLOADS_DIR, `${id}.mp4`);

    // Clean YouTube URL
    const isYt = url.includes("youtube.com") || url.includes("youtu.be");
    const cleanedUrl = isYt ? cleanYoutubeUrl(url) : url;

    // Get metadata info
    const info = isYt ? await getYoutubeMetadata(cleanedUrl) : {
      title: "Web Video (" + url.substring(0, 30) + ")",
      thumbnail: "https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=120&q=80"
    };

    try {
      // Resolve streaming URL before responding so client has immediate streamUrl for proxy playing!
      console.log(`Resolving Cobalt stream for: ${cleanedUrl}`);
      const streamUrl = await resolveUrlWithCobalt(cleanedUrl, quality);
      if (!streamUrl) {
        return res.status(502).json({ error: "Could not extract stream. Video might be restricted, copyright protected, or Cobalt API is busy." });
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
        quality: quality || "360",
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

    // Remove from metadata list
    if (metadata[id]) {
      delete metadata[id];
      saveMetadata(metadata);
    }

    res.json({ success: true });
  });

  // 4. GET - Stream downloaded/downloading video using Range requests
  app.get("/api/video-stream/:id", (req, res) => {
    const { id } = req.params;
    const videoPath = path.join(DOWNLOADS_DIR, `${id}.mp4`);

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
