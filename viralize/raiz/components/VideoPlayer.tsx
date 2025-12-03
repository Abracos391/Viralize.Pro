/// <reference lib="dom" />
import React, { useState, useEffect, useRef } from 'react';
import { GeneratedScript } from '../types';
import { Play, Pause, RotateCcw, Volume2, VolumeX, Download, Loader2, AlertCircle } from 'lucide-react';
import { generateNarration, getStockImage } from '../services/geminiService';

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
  const audioBufferCache = useRef<Record<number, AudioBuffer>>({});
  
  const audioCtxRef = useRef<AudioContext | null>(null); 
  const masterGainRef = useRef<GainNode | null>(null);
  const activeSourceRef = useRef<AudioBufferSourceNode | null>(null);
  
  // Recorder Refs
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const destNodeRef = useRef<MediaStreamAudioDestinationNode | null>(null);

  // Init Audio Context Safely
  useEffect(() => {
    try {
        const AudioContextClass = (window as any).AudioContext || (window as any).webkitAudioContext;
        if (!AudioContextClass) return;
        const ctx = new AudioContextClass();
        const masterGain = ctx.createGain();
        masterGain.gain.value = 1;
        masterGain.connect(ctx.destination);
        
        // Create Destination for Recording
        const dest = ctx.createMediaStreamDestination();
        masterGain.connect(dest);
        destNodeRef.current = dest;

        audioCtxRef.current = ctx;
        masterGainRef.current = masterGain;
    } catch (e) {
        console.warn("Audio Context failed.", e);
    }
    return () => { if (audioCtxRef.current?.state !== 'closed') audioCtxRef.current?.close(); };
  }, []);

  useEffect(() => {
    if (masterGainRef.current) masterGainRef.current.gain.value = isMuted ? 0 : 1;
  }, [isMuted]);

  // --- AUDIO HELPERS ---
  const createSilentBuffer = (ctx: AudioContext | null, duration: number = 2.0): AudioBuffer => {
      const rate = ctx ? ctx.sampleRate : 44100;
      const len = Math.ceil(rate * duration);
      const buf = ctx ? ctx.createBuffer(1, len, rate) : new AudioBuffer({length: len, sampleRate: rate, numberOfChannels: 1});
      return buf;
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
          console.error("Audio decode error, using silence", e);
          return createSilentBuffer(ctx);
      }
  };

  // --- ASSET LOADING ---
  useEffect(() => {
    setAssetsLoaded(false);
    setIsPlaying(false);
    imageCache.current = {};
    audioBufferCache.current = {};
    
    const loadAssets = async () => {
        setLoadingStatus("Downloading Assets...");
        
        // 1. Load Images
        const imagePromises = script.scenes.map(async (scene, i) => {
            setLoadingStatus(`Fetching Image ${i+1}...`);
            let imageUrl = '';
            try {
                imageUrl = await getStockImage(scene.imageKeyword);
            } catch {
                imageUrl = `https://picsum.photos/seed/${scene.imageKeyword}-${scene.id}/1080/1920`;
            }

            await new Promise<void>((resolve) => {
                const img = new Image();
                img.crossOrigin = "anonymous"; 
                const safeUrl = imageUrl.includes('?') 
                    ? `${imageUrl}&t=${Date.now()}` 
                    : `${imageUrl}?t=${Date.now()}`;
                
                img.onload = () => { imageCache.current[scene.id] = img; resolve(); };
                img.onerror = () => {
                    img.src = `https://picsum.photos/seed/fallback_${i}/1080/1920?t=${Date.now()}`; 
                    img.onload = () => { imageCache.current[scene.id] = img; resolve(); };
                    img.onerror = () => resolve(); 
                };
                img.src = safeUrl;
            });
        });

        await Promise.allSettled(imagePromises);

        // 2. Load Audio
        for (let i = 0; i < script.scenes.length; i++) {
            const scene = script.scenes[i];
            setLoadingStatus(`Voice Synthesis ${i + 1}...`);
            try {
                const base64Audio = await generateNarration(scene.narration);
                if (audioCtxRef.current) {
                    const buffer = await decodeAudio(base64Audio, audioCtxRef.current);
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
    return () => { stopAudio(); if (timerRef.current) cancelAnimationFrame(timerRef.current); };
  }, [script]);

  // --- PLAYBACK LOGIC ---
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
      // Logic to continue or restart
      if (currentSceneIndex >= script.scenes.length - 1 && progress >= 100) {
        restartSequence();
      } else {
        const sceneDur = script.scenes[currentSceneIndex].duration * 1000;
        const elapsed = (progress / 100) * sceneDur;
        sceneStartTimeRef.current = Date.now() - elapsed;
        playSceneAudio(currentSceneIndex); 
        runAnimationLoop();
      }
    }
  };

  const restartSequence = () => {
      setCurrentSceneIndex(0);
      setProgress(0);
      sceneStartTimeRef.current = Date.now();
      playSceneAudio(0);
      runAnimationLoop();
  }

  const runAnimationLoop = () => {
    const loop = () => {
        const now = Date.now();
        const elapsed = now - sceneStartTimeRef.current;
        const sceneDur = script.scenes[currentSceneIndex].duration * 1000;
        let newProgress = (elapsed / sceneDur) * 100;

        if (newProgress >= 100) {
            if (currentSceneIndex < script.scenes.length - 1) {
                // Next Scene
                setCurrentSceneIndex(prev => {
                    const next = prev + 1;
                    sceneStartTimeRef.current = Date.now();
                    playSceneAudio(next);
                    return next;
                });
                setProgress(0);
                timerRef.current = requestAnimationFrame(loop);
            } else {
                // End of video
                if (isDownloading) {
                    finishRecording(); // Stop recording if we are in download mode
                } else {
                    setIsPlaying(false);
                    stopAudio();
                    setProgress(100);
                }
            }
        } else {
            setProgress(newProgress);
            drawFrame(currentSceneIndex, newProgress);
            timerRef.current = requestAnimationFrame(loop);
        }
    };
    timerRef.current = requestAnimationFrame(loop);
  };

  // --- CANVAS DRAWING ---
  const drawFrame = (sceneIndex: number, sceneProgressPercent: number) => {
    const canvas = canvasRef.current;
    if (!canvas || !assetsLoaded) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    renderSceneToContext(ctx, canvas.width, canvas.height, sceneIndex, sceneProgressPercent);
  };
  
  const renderSceneToContext = (ctx: CanvasRenderingContext2D, width: number, height: number, sceneIndex: number, progress: number) => {
    const scene = script.scenes[sceneIndex];
    const img = imageCache.current[scene.id];

    ctx.clearRect(0, 0, width, height);

    if (img) {
      const scale = 1 + (progress / 100) * 0.10; // Zoom effect
      const scaledWidth = width * scale;
      const scaledHeight = height * scale;
      const x = (width - scaledWidth) / 2;
      const y = (height - scaledHeight) / 2;
      ctx.drawImage(img, x, y, scaledWidth, scaledHeight);
    } else {
      ctx.fillStyle = '#111827';
      ctx.fillRect(0, 0, width, height);
    }
    
    // Overlay
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.fillRect(0, 0, width, height);

    // Text - Burned In
    ctx.save();
    ctx.font = '900 60px Inter, sans-serif'; 
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'white';
    ctx.shadowColor = 'black';
    ctx.shadowBlur = 20;
    wrapText(ctx, scene.overlayText.toUpperCase(), width / 2, height / 2, width * 0.8, 75);
    ctx.restore();

    // Subtitles
    ctx.save();
    ctx.font = 'bold 32px Inter, sans-serif';
    ctx.textAlign = 'center';
    const narrY = height - 250;
    wrapTextWithBg(ctx, scene.narration, width/2, narrY, width * 0.9, 45);
    ctx.restore();
  }

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

  // --- NATIVE BROWSER RECORDING ---
  const startRecording = async () => {
      if (!canvasRef.current || !destNodeRef.current || !audioCtxRef.current) {
          alert("Recording not supported on this browser.");
          return;
      }

      setIsDownloading(true);
      setLoadingStatus("Recording in real-time (Please wait)...");
      setIsPlaying(true);
      stopAudio(); // Reset state

      // 1. Capture Canvas Stream
      const canvasStream = canvasRef.current.captureStream(30); // 30 FPS
      
      // 2. Capture Audio Stream
      const audioStream = destNodeRef.current.stream;
      
      // 3. Combine
      const combinedStream = new MediaStream([
          ...canvasStream.getVideoTracks(),
          ...audioStream.getAudioTracks()
      ]);

      // 4. Start Recorder
      // Try widely supported codecs
      let mimeType = 'video/webm;codecs=vp9';
      if (!MediaRecorder.isTypeSupported(mimeType)) {
          mimeType = 'video/webm;codecs=vp8';
          if (!MediaRecorder.isTypeSupported(mimeType)) {
              mimeType = 'video/webm';
          }
      }

      const recorder = new MediaRecorder(combinedStream, {
          mimeType,
          videoBitsPerSecond: 5000000 // 5 Mbps
      });

      recordedChunksRef.current = [];
      recorder.ondataavailable = (e) => {
          if (e.data.size > 0) recordedChunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
          const blob = new Blob(recordedChunksRef.current, { type: 'video/webm' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `${script.title.replace(/\s+/g, '_')}_viralize.webm`;
          document.body.appendChild(a);
          a.click();
          window.URL.revokeObjectURL(url);
          setIsDownloading(false);
          setLoadingStatus("Ready");
          setIsPlaying(false);
      };

      mediaRecorderRef.current = recorder;
      recorder.start();

      // Start Playback Loop
      restartSequence();
  };

  const finishRecording = () => {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
          mediaRecorderRef.current.stop();
          stopAudio();
          // Ensure we stop tracks to release memory
          if (mediaRecorderRef.current.stream) {
              mediaRecorderRef.current.stream.getTracks().forEach(t => t.stop());
          }
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
            <div className="absolute top-4 right-4 z-40">
                 <div className="bg-red-600 text-white text-xs font-bold px-2 py-1 rounded animate-pulse">REC</div>
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
              onClick={() => { stopAudio(); setIsPlaying(false); restartSequence(); setIsPlaying(false); }}
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
                onClick={startRecording}
                disabled={isDownloading || !assetsLoaded}
                className={`w-full bg-white text-black font-bold text-lg rounded-xl p-4 flex items-center justify-center gap-3 transition-all ${
                    isDownloading ? 'opacity-70 cursor-wait' : 'hover:bg-gray-100 shadow-xl shadow-white/10'
                }`}
             >
               {isDownloading ? (
                   <>
                    <Loader2 className="animate-spin" size={24} />
                    Recording Video...
                   </>
               ) : (
                   <>
                    <Download size={24} />
                    Download Video (Native)
                   </>
               )}
          </button>
          {isDownloading && <p className="text-center text-xs text-gray-400 mt-2">Please wait, recording the video in real-time to ensure quality.</p>}
        </div>
        <button onClick={onEditRequest} disabled={isDownloading} className="text-sm text-gray-500 hover:text-white underline w-full text-center">
          Create New Video
        </button>
      </div>
    </div>
  );
};
