/// <reference lib="dom" />
import React, { useState, useEffect, useRef } from 'react';
import { GeneratedScript } from '../types';
import { Play, Pause, RotateCcw, Volume2, VolumeX, Download, Loader2, AlertCircle } from 'lucide-react';
import { generateNarration, getStockImage } from '../services/geminiService';
import { renderVideoWithFFmpeg, audioBufferToWav } from '../services/ffmpegService';

interface VideoPlayerProps {
  script: GeneratedScript;
  onEditRequest: () => void;
}

export const VideoPlayer: React.FC<VideoPlayerProps> = ({ script, onEditRequest }) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentSceneIndex, setCurrentSceneIndex] = useState(0);
  const [progress, setProgress] = useState(0); 
  const [isMuted, setIsMuted] = useState(false);
  const [assetsLoaded, setAssetsLoaded] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState("Initializing...");
  const [isDownloading, setIsDownloading] = useState(false);
  
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const timerRef = useRef<number | null>(null);
  const sceneStartTimeRef = useRef<number>(0);
  
  // Asset Caches
  const imageCache = useRef<Record<number, HTMLImageElement>>({});
  // Store raw binary data for FFmpeg
  const imageBinaryCache = useRef<Record<number, Uint8Array>>({});
  
  const audioBufferCache = useRef<Record<number, AudioBuffer>>({});
  const audioCtxRef = useRef<AudioContext | null>(null); 
  const masterGainRef = useRef<GainNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const activeSourceRef = useRef<AudioBufferSourceNode | null>(null);

  useEffect(() => {
    try {
        const AudioContextClass = (window as any).AudioContext || (window as any).webkitAudioContext;
        if (!AudioContextClass) return;
        const ctx = new AudioContextClass();
        const masterGain = ctx.createGain();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 64; 
        masterGain.gain.value = 1;
        masterGain.connect(analyser);
        analyser.connect(ctx.destination);
        audioCtxRef.current = ctx;
        masterGainRef.current = masterGain;
        analyserRef.current = analyser;
    } catch (e) {
        console.warn("Audio Context failed.", e);
    }
    return () => { if (audioCtxRef.current?.state !== 'closed') audioCtxRef.current?.close(); };
  }, []);

  useEffect(() => {
    if (masterGainRef.current) masterGainRef.current.gain.value = isMuted ? 0 : 1;
  }, [isMuted]);

  const createSilentBuffer = (ctx: AudioContext | null): AudioBuffer => {
      if (!ctx) return new AudioBuffer({length: 44100, sampleRate: 44100, numberOfChannels: 1}); 
      return ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  };

  const decodeAudio = async (base64OrFlag: string, ctx: AudioContext): Promise<AudioBuffer> => {
      if (base64OrFlag === "SILENCE") return createSilentBuffer(ctx);
      try {
          const binaryString = atob(base64OrFlag);
          const len = binaryString.length;
          const bytes = new Uint8Array(len);
          for (let i = 0; i < len; i++) bytes[i] = binaryString.charCodeAt(i);
          return await ctx.decodeAudioData(bytes.buffer);
      } catch (e) {
          return createSilentBuffer(ctx);
      }
  };

  // Helper: Fetch URL as Uint8Array (Binary)
  const fetchImageAsBinary = async (url: string): Promise<Uint8Array> => {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error("Image fetch failed");
      const buffer = await resp.arrayBuffer();
      return new Uint8Array(buffer);
  };

  useEffect(() => {
    setAssetsLoaded(false);
    setIsPlaying(false);
    imageCache.current = {};
    imageBinaryCache.current = {};
    audioBufferCache.current = {};
    
    const loadAssets = async () => {
        setLoadingStatus("Downloading Assets...");
        
        // 1. Load Images (Binary Fetch)
        const imagePromises = script.scenes.map(async (scene, i) => {
            setLoadingStatus(`Downloading Image ${i+1}...`);
            
            // Try Stock first, then Picsum
            let imageUrl = '';
            try {
                imageUrl = await getStockImage(scene.imageKeyword);
            } catch {
                imageUrl = `https://picsum.photos/seed/${scene.imageKeyword}-${scene.id}/1080/1920`;
            }

            // Retry logic for fetching image binary
            let binaryData: Uint8Array | null = null;
            let attempts = 0;
            while (!binaryData && attempts < 3) {
                try {
                    binaryData = await fetchImageAsBinary(imageUrl);
                } catch (e) {
                    attempts++;
                    // Fallback to Picsum if Pexels fails
                    if (attempts === 1) imageUrl = `https://picsum.photos/seed/${scene.imageKeyword}-${scene.id}/1080/1920`;
                }
            }

            if (!binaryData) {
                // Should technically fail here, but we'll try one last desperation picsum
                 try {
                     binaryData = await fetchImageAsBinary(`https://picsum.photos/seed/error/1080/1920`);
                 } catch {
                     console.error("Critical image failure for scene", i);
                     return; // Skip drawing this frame rather than crashing
                 }
            }

            // Store Binary for FFmpeg
            imageBinaryCache.current[scene.id] = binaryData;

            // Create ObjectURL for Canvas Preview
            const blob = new Blob([binaryData]);
            const objectUrl = URL.createObjectURL(blob);
            
            await new Promise<void>((resolve) => {
                const img = new Image();
                img.onload = () => {
                    imageCache.current[scene.id] = img;
                    resolve();
                };
                img.onerror = () => resolve(); // Keep going even if decode fails
                img.src = objectUrl;
            });
        });

        await Promise.allSettled(imagePromises);

        // 2. Load Audio
        for (let i = 0; i < script.scenes.length; i++) {
            const scene = script.scenes[i];
            setLoadingStatus(`Synthesizing Voice ${i + 1}...`);
            try {
                const ctx = audioCtxRef.current;
                const base64Audio = await generateNarration(scene.narration);
                if (ctx) {
                    const buffer = await decodeAudio(base64Audio, ctx);
                    audioBufferCache.current[scene.id] = buffer;
                }
            } catch (e) {
                 if (audioCtxRef.current) {
                    audioBufferCache.current[scene.id] = createSilentBuffer(audioCtxRef.current);
                }
            }
        }

        setAssetsLoaded(true);
        setLoadingStatus("Ready");
        setTimeout(() => drawFrame(0, 0), 100);
    };

    loadAssets();

    return () => {
      stopAudio();
      if (timerRef.current) cancelAnimationFrame(timerRef.current);
    };
  }, [script]);

  const stopAudio = () => {
    if (activeSourceRef.current) {
        try { activeSourceRef.current.stop(); } catch(e) {}
        activeSourceRef.current = null;
    }
  };

  const playSceneAudio = (sceneIndex: number) => {
    if (!audioCtxRef.current || !masterGainRef.current) return;
    stopAudio(); 
    const sceneId = script.scenes[sceneIndex].id;
    const buffer = audioBufferCache.current[sceneId];
    if (buffer) {
        const source = audioCtxRef.current.createBufferSource();
        source.buffer = buffer;
        source.connect(masterGainRef.current);
        source.start(0);
        activeSourceRef.current = source;
    }
  };

  const handlePlayPause = async () => {
    if (audioCtxRef.current?.state === 'suspended') await audioCtxRef.current.resume();
    if (isPlaying) {
      setIsPlaying(false);
      stopAudio();
      if (timerRef.current) cancelAnimationFrame(timerRef.current);
    } else {
      setIsPlaying(true);
      if (currentSceneIndex >= script.scenes.length - 1 && progress >= 100) {
        setCurrentSceneIndex(0);
        setProgress(0);
        sceneStartTimeRef.current = Date.now();
        playSceneAudio(0);
      } else {
        const sceneDur = script.scenes[currentSceneIndex].duration * 1000;
        const elapsed = (progress / 100) * sceneDur;
        sceneStartTimeRef.current = Date.now() - elapsed;
        playSceneAudio(currentSceneIndex); 
      }
    }
  };

  const handleRestart = () => {
    setIsPlaying(false);
    setCurrentSceneIndex(0);
    setProgress(0);
    stopAudio();
    if (timerRef.current) cancelAnimationFrame(timerRef.current);
    setTimeout(() => drawFrame(0, 0), 0);
  };

  const drawFrame = (sceneIndex: number, sceneProgressPercent: number) => {
    const canvas = canvasRef.current;
    if (!canvas || !assetsLoaded) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    const scene = script.scenes[sceneIndex];
    const img = imageCache.current[scene.id];

    ctx.clearRect(0, 0, width, height);

    if (img) {
      const scale = 1 + (sceneProgressPercent / 100) * 0.15; 
      const scaledWidth = width * scale;
      const scaledHeight = height * scale;
      const x = (width - scaledWidth) / 2;
      const y = (height - scaledHeight) / 2;
      ctx.drawImage(img, x, y, scaledWidth, scaledHeight);
    } else {
      ctx.fillStyle = '#1f2937';
      ctx.fillRect(0, 0, width, height);
    }

    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.fillRect(0, 0, width, height);

    ctx.save();
    ctx.font = '900 60px Inter, sans-serif'; 
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'white';
    ctx.shadowColor = 'black';
    ctx.shadowBlur = 20;
    wrapText(ctx, scene.overlayText.toUpperCase(), width / 2, height / 2, width * 0.8, 75);
    ctx.restore();

    ctx.save();
    ctx.font = 'bold 32px Inter, sans-serif';
    ctx.textAlign = 'center';
    const narrY = height - 200;
    wrapTextWithBg(ctx, scene.narration, width/2, narrY, width * 0.9, 45);
    ctx.restore();
  };

  const wrapText = (ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number) => {
    const words = text.split(' ');
    let line = '';
    const lines = [];
    for (let n = 0; n < words.length; n++) {
      const testLine = line + words[n] + ' ';
      if (ctx.measureText(testLine).width > maxWidth && n > 0) {
        lines.push(line);
        line = words[n] + ' ';
      } else {
        line = testLine;
      }
    }
    lines.push(line);
    let startY = y - ((lines.length - 1) * lineHeight) / 2;
    lines.forEach(l => { ctx.fillText(l, x, startY); startY += lineHeight; });
  }

  const wrapTextWithBg = (ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number) => {
     const words = text.split(' ');
     let line = '';
     const lines = [];
     for (let n = 0; n < words.length; n++) {
        const testLine = line + words[n] + ' ';
        if (ctx.measureText(testLine).width > maxWidth && n > 0) {
            lines.push(line);
            line = words[n] + ' ';
        } else {
            line = testLine;
        }
     }
     lines.push(line);
     let curY = y;
     lines.forEach(l => {
         const w = ctx.measureText(l).width;
         ctx.fillStyle = 'rgba(0,0,0,0.7)';
         ctx.fillRect(x - w/2 - 10, curY - 30, w + 20, 40);
         ctx.fillStyle = '#fde047';
         ctx.fillText(l, x, curY);
         curY += lineHeight;
     });
  }

  useEffect(() => {
    if (!isPlaying) return;
    const animate = () => {
      const now = Date.now();
      const currentScene = script.scenes[currentSceneIndex];
      const elapsedInScene = (now - sceneStartTimeRef.current) / 1000;
      let sceneProgress = (elapsedInScene / currentScene.duration) * 100;

      if (sceneProgress >= 100) {
        if (currentSceneIndex < script.scenes.length - 1) {
          const nextIndex = currentSceneIndex + 1;
          setCurrentSceneIndex(nextIndex);
          sceneStartTimeRef.current = now;
          playSceneAudio(nextIndex); 
        } else {
          setIsPlaying(false);
          setProgress(100);
          stopAudio();
        }
      }
      if (sceneProgress > 100) sceneProgress = 100;
      setProgress(sceneProgress);
      drawFrame(currentSceneIndex, sceneProgress);
      if (isPlaying) timerRef.current = requestAnimationFrame(animate);
    };
    timerRef.current = requestAnimationFrame(animate);
    return () => { if(timerRef.current) cancelAnimationFrame(timerRef.current); };
  }, [isPlaying, currentSceneIndex]);

  // --- AUDIO STITCHING LOGIC ---
  // Merges all individual scene audio buffers into ONE master audio buffer
  // This ensures perfect sync and prevents FFmpeg filter complexity issues.
  const stitchAudioBuffers = async (scenes: typeof script.scenes, buffers: Record<number, AudioBuffer>): Promise<Uint8Array> => {
      // 1. Calculate Total Duration
      const totalDuration = scenes.reduce((acc, s) => acc + s.duration, 0);
      const sampleRate = 48000; // Standard for video
      
      // 2. Create Offline Context
      // (window as any).OfflineAudioContext handles type check for older browsers
      const OfflineCtx = (window as any).OfflineAudioContext || (window as any).webkitOfflineAudioContext;
      const offlineCtx = new OfflineCtx(1, Math.ceil(totalDuration * sampleRate), sampleRate);
      
      let currentTime = 0;
      
      // 3. Schedule all clips
      for (const scene of scenes) {
          const buffer = buffers[scene.id];
          if (buffer) {
              const source = offlineCtx.createBufferSource();
              source.buffer = buffer;
              source.connect(offlineCtx.destination);
              source.start(currentTime);
          }
          currentTime += scene.duration;
      }
      
      // 4. Render to Single Buffer
      const renderedBuffer = await offlineCtx.startRendering();
      
      // 5. Convert to WAV Bytes
      return audioBufferToWav(renderedBuffer);
  };

  const startDownload = async () => {
    setIsDownloading(true);
    setIsPlaying(false);
    stopAudio();

    try {
        setLoadingStatus("Pre-processing Audio...");
        
        // 1. Stitch Audio
        const masterAudioWav = await stitchAudioBuffers(script.scenes, audioBufferCache.current);
        
        // 2. Prepare Images
        const safeImagesBinary: Record<number, Uint8Array> = {};
        for(const scene of script.scenes) {
            if (imageBinaryCache.current[scene.id]) {
                safeImagesBinary[scene.id] = imageBinaryCache.current[scene.id];
            } else {
                throw new Error("Image data missing");
            }
        }

        setLoadingStatus("Initializing Video Engine...");
        
        // 3. Send to FFmpeg
        const videoBlob = await renderVideoWithFFmpeg(
            script,
            safeImagesBinary,
            masterAudioWav, // Pass single WAV file
            (percent, msg) => setLoadingStatus(`${msg} (${Math.round(percent)}%)`)
        );

        const url = URL.createObjectURL(videoBlob);
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = url;
        a.download = `${script.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.mp4`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        
        setLoadingStatus("Ready");
    } catch (e: any) {
        console.error(e);
        alert("Render failed: " + e.message);
    } finally {
        setIsDownloading(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center w-full max-w-6xl mx-auto gap-8 lg:flex-row lg:items-start p-4">
      <div className="relative shrink-0 w-[320px] h-[640px] bg-black rounded-[3rem] border-[8px] border-gray-800 shadow-2xl overflow-hidden ring-1 ring-gray-700">
        <div className="absolute top-0 left-1/2 transform -translate-x-1/2 w-32 h-6 bg-black rounded-b-xl z-20 pointer-events-none"></div>

        {!assetsLoaded && (
             <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-900 z-30 p-4 text-center">
                 <Loader2 className="animate-spin text-brand-500 mb-2" size={32} />
                 <span className="text-sm text-gray-400 font-medium animate-pulse">{loadingStatus}</span>
             </div>
        )}

        {isDownloading && (
            <div className="absolute inset-0 bg-black/80 z-40 flex flex-col items-center justify-center p-6 text-center">
                 <Loader2 className="animate-spin text-brand-500 mb-4" size={48} />
                 <h3 className="text-xl font-bold text-white mb-2">Rendering Video</h3>
                 <p className="text-sm text-gray-300">{loadingStatus}</p>
                 <p className="text-xs text-gray-500 mt-4">High-performance local rendering...</p>
            </div>
        )}

        <canvas ref={canvasRef} width={540} height={960} className="w-full h-full object-cover bg-gray-900"/>
      </div>

      <div className="flex-1 w-full space-y-6">
        <div className="bg-gray-800/50 border border-gray-700 rounded-2xl p-6 backdrop-blur-xl">
          <div className="flex justify-between items-start mb-4">
            <div>
              <h3 className="text-2xl font-bold text-white mb-1">{script.title}</h3>
              <p className="text-xs text-gray-400">
                  {process.env.PEXELS_API_KEY ? "Stock Images Active (Pexels)" : "Standard Mode (Basic Images)"}
              </p>
            </div>
          </div>

          <div className="flex gap-4 mb-8">
            <button 
              onClick={handlePlayPause}
              disabled={isDownloading || !assetsLoaded}
              className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-semibold transition-all shadow-lg ${
                isPlaying ? 'bg-gray-700' : 'bg-brand-600 hover:bg-brand-500'
              } disabled:opacity-50`}
            >
              {isPlaying ? <Pause size={20} /> : <Play size={20} />}
              {isPlaying ? 'Pause' : 'Preview'}
            </button>
            <button 
              onClick={handleRestart}
              disabled={isDownloading || !assetsLoaded}
              className="p-3 bg-gray-700 hover:bg-gray-600 rounded-xl disabled:opacity-50"
            >
              <RotateCcw size={20} />
            </button>
            <button 
              onClick={() => setIsMuted(!isMuted)}
              className="p-3 bg-gray-700 hover:bg-gray-600 rounded-xl disabled:opacity-50"
            >
              {isMuted ? <VolumeX size={20} /> : <Volume2 size={20} />}
            </button>
          </div>

          <button 
                onClick={startDownload}
                disabled={isDownloading || !assetsLoaded}
                className={`w-full bg-white text-black font-bold text-lg rounded-xl p-4 flex items-center justify-center gap-3 transition-all ${
                    isDownloading ? 'opacity-70 cursor-wait' : 'hover:bg-gray-100 shadow-xl shadow-white/10'
                }`}
             >
               {isDownloading ? (
                   <>
                    <Loader2 className="animate-spin" size={24} />
                    Processing with FFmpeg...
                   </>
               ) : (
                   <>
                    <Download size={24} />
                    Download MP4 (1080p)
                   </>
               )}
          </button>
        </div>
        <button onClick={onEditRequest} disabled={isDownloading} className="text-sm text-gray-500 hover:text-white underline w-full text-center">
          Create New Video
        </button>
      </div>
    </div>
  );
};
