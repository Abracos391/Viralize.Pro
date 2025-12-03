/// <reference lib="dom" />
import React, { useState, useEffect, useRef } from 'react';
import { GeneratedScript } from '../types';
import { Play, Pause, RotateCcw, Volume2, VolumeX, Download, Loader2, Music4, AlertTriangle } from 'lucide-react';
import { generateNarration, getStockImage } from '../services/geminiService';
import { renderVideoWithFFmpeg } from '../services/ffmpegService';

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
  const imageUrlCache = useRef<Record<number, string>>({}); // Store URLs/Blobs for FFmpeg
  const audioBufferCache = useRef<Record<number, AudioBuffer>>({});
  
  // Audio Context & Graph
  const audioCtxRef = useRef<AudioContext | null>(null); 
  const masterGainRef = useRef<GainNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const activeSourceRef = useRef<AudioBufferSourceNode | null>(null);

  // --- 1. INITIALIZE AUDIO ENGINE ---
  useEffect(() => {
    const AudioContextClass = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;

    const ctx = new AudioContextClass();
    
    // Nodes
    const masterGain = ctx.createGain();
    const analyser = ctx.createAnalyser();

    // Config Analyser
    analyser.fftSize = 64; 

    masterGain.gain.value = 1;
    masterGain.connect(analyser);
    analyser.connect(ctx.destination);
    
    audioCtxRef.current = ctx;
    masterGainRef.current = masterGain;
    analyserRef.current = analyser;

    return () => {
        if (ctx.state !== 'closed') ctx.close();
    };
  }, []);

  // Handle Mute
  useEffect(() => {
    if (masterGainRef.current) {
        masterGainRef.current.gain.value = isMuted ? 0 : 1;
    }
  }, [isMuted]);

  // --- 2. ASSET LOADING ---
  const decodeAudio = async (base64: string, ctx: AudioContext): Promise<AudioBuffer> => {
      const binaryString = atob(base64);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      return await ctx.decodeAudioData(bytes.buffer);
  };

  useEffect(() => {
    setAssetsLoaded(false);
    setIsPlaying(false);
    imageCache.current = {};
    imageUrlCache.current = {};
    audioBufferCache.current = {};
    
    const loadAssets = async () => {
        try {
            setLoadingStatus("Preparing visuals...");
            
            // Load Images
            for (let i = 0; i < script.scenes.length; i++) {
                 const scene = script.scenes[i];
                 setLoadingStatus(`Loading Visuals ${i+1}/${script.scenes.length}...`);
                 
                 const imageUrl = await getStockImage(scene.imageKeyword);
                 imageUrlCache.current[scene.id] = imageUrl;

                 await new Promise<void>((resolve) => {
                    const img = new Image();
                    img.crossOrigin = "Anonymous"; 
                    img.src = imageUrl;
                    img.onload = () => {
                        imageCache.current[scene.id] = img;
                        resolve();
                    };
                    img.onerror = () => {
                        const fallback = `https://picsum.photos/seed/${scene.imageKeyword}-${scene.id}/1080/1920`;
                        img.src = fallback;
                        imageUrlCache.current[scene.id] = fallback;
                        setTimeout(resolve, 1000); 
                    };
                 });
            }

            // Load Audio
            for (let i = 0; i < script.scenes.length; i++) {
                const scene = script.scenes[i];
                let success = false;
                
                while (!success) {
                    setLoadingStatus(`Synthesizing Audio ${i + 1}/${script.scenes.length}...`);
                    
                    try {
                        const base64Audio = await generateNarration(scene.narration, (msg) => {
                            setLoadingStatus(`${msg} (Scene ${i+1})`); 
                        });

                        if (audioCtxRef.current && base64Audio) {
                            const buffer = await decodeAudio(base64Audio, audioCtxRef.current);
                            audioBufferCache.current[scene.id] = buffer;
                            success = true; 
                        } else {
                            throw new Error("Empty audio");
                        }
                    } catch (e) {
                        setLoadingStatus(`Waiting for Google API (Scene ${i+1})...`);
                        await new Promise(r => setTimeout(r, 5000));
                    }
                }
            }

            setAssetsLoaded(true);
            setLoadingStatus("Ready");
            drawFrame(0, 0); 

        } catch (e) {
            console.error(e);
            setLoadingStatus("Critical Error: Please refresh");
        }
    };

    loadAssets();

    return () => {
      stopAudio();
      if (timerRef.current) cancelAnimationFrame(timerRef.current);
    };
  }, [script]);

  // --- 3. AUDIO CONTROL ---
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

  // --- 4. PLAYBACK LOGIC ---
  const handlePlayPause = async () => {
    if (!audioCtxRef.current) return;
    if (audioCtxRef.current.state === 'suspended') await audioCtxRef.current.resume();

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

  // --- 5. RENDER LOOP (VISUALS) ---
  const drawFrame = (sceneIndex: number, sceneProgressPercent: number) => {
    const canvas = canvasRef.current;
    if (!canvas || !assetsLoaded) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    const scene = script.scenes[sceneIndex];
    const img = imageCache.current[scene.id];

    // Clear
    ctx.clearRect(0, 0, width, height);

    // 1. Background Image
    if (img) {
      const scale = 1 + (sceneProgressPercent / 100) * 0.15; 
      const scaledWidth = width * scale;
      const scaledHeight = height * scale;
      const x = (width - scaledWidth) / 2;
      const y = (height - scaledHeight) / 2;
      ctx.drawImage(img, x, y, scaledWidth, scaledHeight);
    } else {
      ctx.fillStyle = '#111';
      ctx.fillRect(0, 0, width, height);
    }

    // 2. Overlay
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.fillRect(0, 0, width, height);

    // 3. Text: Overlay
    ctx.save();
    ctx.font = '900 60px Inter, sans-serif'; 
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'white';
    ctx.shadowColor = 'black';
    ctx.shadowBlur = 20;
    const text = scene.overlayText.toUpperCase();
    wrapText(ctx, text, width / 2, height / 2, width * 0.8, 75);
    ctx.restore();

    // 4. Text: Subtitles
    ctx.save();
    ctx.font = 'bold 32px Inter, sans-serif';
    ctx.textAlign = 'center';
    const narr = scene.narration;
    const narrY = height - 200;
    wrapTextWithBg(ctx, narr, width/2, narrY, width * 0.9, 45);
    ctx.restore();

    // 5. Audio Visualizer
    if (analyserRef.current) {
        const bufferLength = analyserRef.current.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        analyserRef.current.getByteFrequencyData(dataArray);

        const barWidth = (width / 16) - 10;
        let x = (width - ((barWidth + 10) * 16)) / 2;

        ctx.fillStyle = '#22c55e';
        for(let i = 0; i < 16; i++) {
            const val = dataArray[i + 2] || 0; 
            const barHeight = (val / 255) * 100;
            if (barHeight > 5) {
                ctx.fillRect(x, height - 120 - barHeight, barWidth, barHeight);
            }
            x += barWidth + 10;
        }
    }
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

  // --- 6. ANIMATION LOOP ---
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

      if (isPlaying) {
        timerRef.current = requestAnimationFrame(animate);
      }
    };

    timerRef.current = requestAnimationFrame(animate);
    return () => { if(timerRef.current) cancelAnimationFrame(timerRef.current); };
  }, [isPlaying, currentSceneIndex]);

  // --- 7. FFmpeg DOWNLOAD ---
  const startDownload = async () => {
    setIsDownloading(true);
    setIsPlaying(false);
    stopAudio();

    try {
        setLoadingStatus("Initializing FFmpeg Engine...");
        
        const videoBlob = await renderVideoWithFFmpeg(
            script,
            imageUrlCache.current,
            audioBufferCache.current,
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
      
      {/* PHONE MOCKUP */}
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
                 <p className="text-xs text-gray-500 mt-4">Using browser-based FFmpeg. Do not close.</p>
            </div>
        )}

        <canvas 
            ref={canvasRef}
            width={540} 
            height={960}
            className="w-full h-full object-cover bg-gray-900"
        />
      </div>

      {/* CONTROLS */}
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
                    Download MP4 (High Quality)
                   </>
               )}
          </button>
          
          <div className="mt-4 text-xs text-gray-500 text-center">
             <p>Generates 1080p MP4 with Hardcoded Subtitles using FFmpeg.wasm</p>
          </div>
        </div>

        <button onClick={onEditRequest} disabled={isDownloading} className="text-sm text-gray-500 hover:text-white underline w-full text-center">
          Create New Video
        </button>
      </div>
    </div>
  );
};
