/// <reference lib="dom" />
import React, { useState, useEffect, useRef } from 'react';
import { GeneratedScript } from '../types';
import { Play, Pause, RotateCcw, Volume2, VolumeX, Download, Loader2 } from 'lucide-react';
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
  const [isProcessing, setIsProcessing] = useState(false); // New state for "Mixing"
  
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
        masterGain.connect(ctx.destination); // For hearing
        
        // Create Destination for Recording (The "Mixer")
        const dest = ctx.createMediaStreamDestination();
        masterGain.connect(dest); // For recording
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
        setLoadingStatus("Downloading Visuals...");
        
        // 1. Load Images (with Cache Busting to prevent Tainted Canvas)
        const imagePromises = script.scenes.map(async (scene, i) => {
            let imageUrl = '';
            try { imageUrl = await getStockImage(scene.imageKeyword); } 
            catch { imageUrl = `https://picsum.photos/seed/${scene.imageKeyword}/1080/1920`; }

            await new Promise<void>((resolve) => {
                const img = new Image();
                img.crossOrigin = "anonymous"; // CRITICAL FOR RECORDING
                // Add timestamp to force fresh request and avoid cache tainting
                const safeUrl = imageUrl.includes('?') 
                    ? `${imageUrl}&t=${Date.now()}` 
                    : `${imageUrl}?t=${Date.now()}`;
                
                img.onload = () => { imageCache.current[scene.id] = img; resolve(); };
                img.onerror = () => {
                    // Fallback to solid color if download fails
                    resolve(); 
                };
                img.src = safeUrl;
            });
        });

        await Promise.allSettled(imagePromises);

        // 2. Load Audio
        for (let i = 0; i < script.scenes.length; i++) {
            const scene = script.scenes[i];
            setLoadingStatus(`Synthesizing Voice ${i + 1}/${script.scenes.length}...`);
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

  const startPlayback = (recordingMode = false) => {
      // Reset
      setCurrentSceneIndex(0);
      setProgress(0);
      sceneStartTimeRef.current = Date.now();
      
      // Ensure Audio Context is running (user interaction req)
      if (audioCtxRef.current?.state === 'suspended') {
          audioCtxRef.current.resume();
      }

      setIsPlaying(true);
      if (recordingMode) setIsProcessing(true);
      
      playSceneAudio(0);
      runAnimationLoop(recordingMode);
  };

  const runAnimationLoop = (recordingMode: boolean) => {
    const loop = () => {
        const now = Date.now();
        const elapsed = now - sceneStartTimeRef.current;
        const sceneDur = script.scenes[currentSceneIndex].duration * 1000;
        
        let newProgress = (elapsed / sceneDur) * 100;

        // Ensure we draw the frame
        drawFrame(currentSceneIndex, Math.min(newProgress, 100));

        if (newProgress >= 100) {
            // Scene Finished
            if (currentSceneIndex < script.scenes.length - 1) {
                // Next Scene
                setCurrentSceneIndex(prev => {
                    const next = prev + 1;
                    sceneStartTimeRef.current = Date.now();
                    playSceneAudio(next); // Play next audio
                    return next;
                });
                setProgress(0);
                timerRef.current = requestAnimationFrame(loop);
            } else {
                // Video Finished
                if (recordingMode) {
                    finishRecording();
                } else {
                    setIsPlaying(false);
                    stopAudio();
                    setProgress(100);
                }
            }
        } else {
            setProgress(newProgress);
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

    // Safety check for index
    const idx = Math.min(sceneIndex, script.scenes.length - 1);
    const scene = script.scenes[idx];
    const img = imageCache.current[scene.id];

    // Clear
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw Image (Zoom Effect)
    if (img) {
      const scale = 1 + (sceneProgressPercent / 100) * 0.10; 
      const scaledWidth = canvas.width * scale;
      const scaledHeight = canvas.height * scale;
      const x = (canvas.width - scaledWidth) / 2;
      const y = (canvas.height - scaledHeight) / 2;
      ctx.drawImage(img, x, y, scaledWidth, scaledHeight);
    } else {
        // Fallback Gradient if image missing
        const grd = ctx.createLinearGradient(0, 0, 0, canvas.height);
        grd.addColorStop(0, "#1e3a8a");
        grd.addColorStop(1, "#000000");
        ctx.fillStyle = grd;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    
    // Dark Overlay
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw Texts (Burn-in)
    const w = canvas.width;
    const h = canvas.height;

    // Main Text (Center)
    ctx.save();
    ctx.font = '900 56px Inter, sans-serif'; 
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'white';
    ctx.shadowColor = 'black';
    ctx.shadowBlur = 20;
    wrapText(ctx, scene.overlayText.toUpperCase(), w / 2, h / 2, w * 0.85, 70);
    ctx.restore();

    // Subtitles (Bottom)
    ctx.save();
    ctx.font = 'bold 28px Inter, sans-serif';
    ctx.textAlign = 'center';
    const narrY = h - 200;
    wrapTextWithBg(ctx, scene.narration, w/2, narrY, w * 0.9, 40);
    ctx.restore();
    
    // Progress Bar (Visual indicator during recording)
    if (isProcessing) {
        ctx.fillStyle = '#ef4444'; // Red recording dot
        ctx.beginPath();
        ctx.arc(40, 40, 15, 0, 2 * Math.PI);
        ctx.fill();
    }
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
         ctx.fillStyle = 'rgba(0,0,0,0.6)';
         ctx.fillRect(x - w/2 - 10, curY - 26, w + 20, 34);
         ctx.fillStyle = '#fde047'; 
         ctx.fillText(l, x, curY);
         curY += lineHeight;
     });
  }

  // --- RECORDING ---
  const handleDownload = async () => {
      if (!canvasRef.current || !destNodeRef.current || !audioCtxRef.current) {
          alert("Browser not supported.");
          return;
      }

      // 1. Prepare
      stopAudio();
      setIsProcessing(true); // UI Lock

      // 2. Setup Stream (Canvas + Audio)
      const canvasStream = canvasRef.current.captureStream(30); // 30 FPS
      const audioStream = destNodeRef.current.stream;
      const combinedStream = new MediaStream([
          ...canvasStream.getVideoTracks(),
          ...audioStream.getAudioTracks()
      ]);

      // 3. Setup Recorder
      const options = { mimeType: 'video/webm' }; // Most compatible
      const recorder = new MediaRecorder(combinedStream, options);

      recordedChunksRef.current = [];
      recorder.ondataavailable = (e) => {
          if (e.data.size > 0) recordedChunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
          // Create File
          const blob = new Blob(recordedChunksRef.current, { type: 'video/webm' });
          const url = URL.createObjectURL(blob);
          
          // Trigger Download
          const a = document.createElement('a');
          a.href = url;
          a.download = `${script.title.replace(/\s+/g, '_')}_ViralizePro.webm`;
          document.body.appendChild(a);
          a.click();
          window.URL.revokeObjectURL(url);
          
          // Cleanup
          setIsProcessing(false);
          setIsPlaying(false);
      };

      mediaRecorderRef.current = recorder;

      // 4. Start Everything
      recorder.start();
      startPlayback(true); // Start animation loop in recording mode
  };

  const finishRecording = () => {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
          mediaRecorderRef.current.stop();
          stopAudio();
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

        {isProcessing && (
             <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80 z-30 p-6 text-center backdrop-blur-sm">
                 <div className="w-16 h-16 border-4 border-red-500 border-t-transparent rounded-full animate-spin mb-4"></div>
                 <h3 className="text-xl font-bold text-white mb-2">Mixing & Recording...</h3>
                 <p className="text-sm text-gray-300">Please wait while the video plays through to capture quality.</p>
                 <p className="text-xs text-gray-500 mt-4 font-mono">Do not switch tabs</p>
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
              onClick={() => startPlayback(false)}
              disabled={isProcessing || !assetsLoaded}
              className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-xl font-semibold transition-all shadow-lg ${
                isPlaying && !isProcessing ? 'bg-gray-700' : 'bg-brand-600 hover:bg-brand-500'
              } disabled:opacity-50`}
            >
              {isPlaying && !isProcessing ? <Pause size={20} /> : <Play size={20} />}
              {isPlaying && !isProcessing ? 'Pause Preview' : 'Play Preview'}
            </button>
            <button 
              onClick={() => { stopAudio(); setIsPlaying(false); drawFrame(0,0); }}
              disabled={isProcessing || !assetsLoaded}
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
                onClick={handleDownload}
                disabled={isProcessing || !assetsLoaded}
                className={`w-full bg-white text-black font-bold text-lg rounded-xl p-4 flex items-center justify-center gap-3 transition-all ${
                    isProcessing ? 'opacity-70 cursor-wait' : 'hover:bg-gray-100 shadow-xl shadow-white/10'
                }`}
             >
               {isProcessing ? (
                   <>
                    <Loader2 className="animate-spin text-red-600" size={24} />
                    Processing Video (Mixing)...
                   </>
               ) : (
                   <>
                    <Download size={24} />
                    Mix & Download Video
                   </>
               )}
          </button>
          <p className="text-center text-xs text-gray-500 mt-2">
            Uses native browser recording. 100% Free. No Engine Errors.
          </p>
        </div>
        <button onClick={onEditRequest} disabled={isProcessing} className="text-sm text-gray-500 hover:text-white underline w-full text-center">
          Create New Video
        </button>
      </div>
    </div>
  );
};
