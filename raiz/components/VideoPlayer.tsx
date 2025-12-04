/// <reference lib="dom" />
import React, { useState, useEffect, useRef } from 'react';
import { GeneratedScript } from '../types';
import { Play, Pause, Volume2, VolumeX, Download, Loader2, PlayCircle, RefreshCw } from 'lucide-react';
import { generateNarration, getStockImage } from '../services/geminiService';

interface VideoPlayerProps {
  script: GeneratedScript;
  onEditRequest: () => void;
}

export const VideoPlayer: React.FC<VideoPlayerProps> = ({ script, onEditRequest }) => {
  // --- STATE ---
  const [isReady, setIsReady] = useState(false);         
  const [hasUserInteracted, setHasUserInteracted] = useState(false); 
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState("Iniciando...");
  const [progress, setProgress] = useState(0);

  // --- REFS ---
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);
  
  // Audio Engine Refs
  const audioCtxRef = useRef<AudioContext | null>(null);
  const masterBufferRef = useRef<AudioBuffer | null>(null);
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const destNodeRef = useRef<MediaStreamAudioDestinationNode | null>(null); 
  
  // Assets Cache
  const imageCache = useRef<Record<number, HTMLImageElement>>({});

  // --- 1. INITIALIZE AUDIO ENGINE ---
  useEffect(() => {
    const initAudio = () => {
        const AudioContextClass = (window as any).AudioContext || (window as any).webkitAudioContext;
        const ctx = new AudioContextClass();
        const gain = ctx.createGain();
        const dest = ctx.createMediaStreamDestination();

        gain.connect(ctx.destination);
        gain.connect(dest);

        audioCtxRef.current = ctx;
        gainNodeRef.current = gain;
        destNodeRef.current = dest;
    };
    initAudio();
    return () => { audioCtxRef.current?.close(); };
  }, []);

  useEffect(() => {
    if (gainNodeRef.current) gainNodeRef.current.gain.value = isMuted ? 0 : 1;
  }, [isMuted]);

  // --- 2. ASSET LOADING ---
  useEffect(() => {
    let mounted = true;
    
    const loadAssets = async () => {
        setIsReady(false);
        setHasUserInteracted(false); 
        stopPlayback();
        
        // A. Load Images
        setLoadingStatus("Carregando Imagens...");
        const tempImages: Record<number, HTMLImageElement> = {};
        const imgPromises = script.scenes.map(async (scene) => {
            try {
                let url = await getStockImage(scene.imageKeyword);
                const safeUrl = url.includes('?') ? `${url}&t=${Date.now()}` : `${url}?t=${Date.now()}`;
                
                await new Promise<void>((resolve) => {
                    const img = new Image();
                    img.crossOrigin = "anonymous";
                    img.src = safeUrl;
                    img.onload = () => { tempImages[scene.id] = img; resolve(); };
                    img.onerror = () => { resolve(); }; 
                });
            } catch (e) {}
        });

        // B. Load Audio
        setLoadingStatus("Gerando Narração...");
        const tempAudioBuffers: Record<number, AudioBuffer> = {};
        if (audioCtxRef.current) {
            const ctx = audioCtxRef.current;
            for (const scene of script.scenes) {
                try {
                    const b64 = await generateNarration(scene.narration);
                    if (b64 !== "SILENCE") {
                        const bin = atob(b64);
                        const bytes = new Uint8Array(bin.length);
                        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
                        const buf = await ctx.decodeAudioData(bytes.buffer);
                        tempAudioBuffers[scene.id] = buf;
                    }
                } catch (e) { console.warn("Audio fail", e); }
            }

            setLoadingStatus("Mixando Áudio...");
            const totalDuration = script.scenes.reduce((acc, s) => acc + s.duration, 0);
            const sampleRate = ctx.sampleRate;
            const length = Math.ceil((totalDuration + 0.5) * sampleRate);
            const masterBuf = ctx.createBuffer(1, length, sampleRate);
            const data = masterBuf.getChannelData(0);

            let offset = 0;
            script.scenes.forEach(scene => {
                const clip = tempAudioBuffers[scene.id];
                if (clip) {
                    const clipData = clip.getChannelData(0);
                    const startSample = Math.floor(offset * sampleRate);
                    for (let i = 0; i < clipData.length; i++) {
                        if (startSample + i < length) data[startSample + i] = clipData[i];
                    }
                }
                offset += scene.duration;
            });
            masterBufferRef.current = masterBuf;
        }

        await Promise.all(imgPromises);
        imageCache.current = tempImages;

        if (mounted) {
            setLoadingStatus("Pronto");
            setIsReady(true);
            setTimeout(() => drawFrame(0), 100);
        }
    };

    loadAssets();
    return () => { mounted = false; stopPlayback(); };
  }, [script]);

  // --- 3. PLAYBACK ---
  const stopPlayback = () => {
      if (sourceNodeRef.current) {
          try { sourceNodeRef.current.stop(); } catch(e){}
          sourceNodeRef.current = null;
      }
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      setIsPlaying(false);
      setIsProcessing(false);
  };

  const startPlayback = async (forRecording = false) => {
      if (!audioCtxRef.current || !masterBufferRef.current || !gainNodeRef.current) return;
      const ctx = audioCtxRef.current;
      if (ctx.state === 'suspended') await ctx.resume();

      stopPlayback();
      setIsPlaying(true);
      if (forRecording) setIsProcessing(true);

      const source = ctx.createBufferSource();
      source.buffer = masterBufferRef.current;
      source.connect(gainNodeRef.current);
      source.start(0);
      sourceNodeRef.current = source;

      startTimeRef.current = Date.now();
      const totalDuration = script.scenes.reduce((acc, s) => acc + s.duration, 0);

      const loop = () => {
          const now = Date.now();
          const elapsed = (now - startTimeRef.current) / 1000;

          if (elapsed >= totalDuration) {
              stopPlayback();
              return;
          }

          setProgress(elapsed / totalDuration);
          drawFrame(elapsed);
          animationFrameRef.current = requestAnimationFrame(loop);
      };
      animationFrameRef.current = requestAnimationFrame(loop);
  };

  // --- 4. RENDERER ---
  const drawFrame = (elapsed: number) => {
      const cvs = canvasRef.current;
      const ctx = cvs?.getContext('2d');
      if (!cvs || !ctx) return;

      let t = 0;
      let activeScene = script.scenes[0];
      let sceneElapsed = 0;
      for (let s of script.scenes) {
          if (elapsed >= t && elapsed < t + s.duration) {
              activeScene = s;
              sceneElapsed = elapsed - t;
              break;
          }
          t += s.duration;
      }

      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, cvs.width, cvs.height);

      const img = imageCache.current[activeScene.id];
      if (img) {
          const scale = 1 + (sceneElapsed / activeScene.duration) * 0.1; 
          const w = cvs.width * scale;
          const h = cvs.height * scale;
          const x = (cvs.width - w) / 2;
          const y = (cvs.height - h) / 2;
          try { ctx.drawImage(img, x, y, w, h); } catch(e){}
      }

      ctx.fillStyle = "rgba(0,0,0,0.3)";
      ctx.fillRect(0, 0, cvs.width, cvs.height);

      const drawText = (txt: string, x: number, y: number, size: number, bg: boolean) => {
          ctx.font = `900 ${size}px Inter, sans-serif`;
          ctx.textAlign = "center";
          const maxWidth = cvs.width * 0.9;
          const words = txt.split(' ');
          let line = '';
          const lines = [];

          for (let n = 0; n < words.length; n++) {
              const test = line + words[n] + ' ';
              if (ctx.measureText(test).width > maxWidth && n > 0) { lines.push(line); line = words[n] + ' '; }
              else { line = test; }
          }
          lines.push(line);

          const lh = size * 1.2;
          let sy = y - ((lines.length - 1) * lh) / 2;
          
          lines.forEach(l => {
              if (bg) {
                  const tw = ctx.measureText(l).width;
                  ctx.fillStyle = "rgba(0,0,0,0.6)";
                  ctx.fillRect(x - tw/2 - 10, sy - size * 0.8, tw + 20, size * 1.2);
                  ctx.fillStyle = "#fbbf24"; 
              } else {
                  ctx.fillStyle = "white";
                  ctx.shadowColor = "black";
                  ctx.shadowBlur = 10;
              }
              ctx.fillText(l, x, sy);
              sy += lh;
          });
      };

      const cleanOverlay = activeScene.overlayText.replace(/[-_]/g, ' ').toUpperCase();
      drawText(cleanOverlay, cvs.width/2, cvs.height/2, 52, false);

      ctx.font = "bold 28px Inter, sans-serif";
      drawText(activeScene.narration, cvs.width/2, cvs.height - 150, 28, true);

      if (isProcessing) {
          ctx.fillStyle = "red";
          ctx.beginPath();
          ctx.arc(40, 40, 15, 0, Math.PI*2);
          ctx.fill();
      }
  };

  // --- 5. DOWNLOAD HANDLER ---
  const handleDownload = async () => {
      if (!isReady || !audioCtxRef.current || !destNodeRef.current || !canvasRef.current) return;
      
      if (audioCtxRef.current.state === 'suspended') await audioCtxRef.current.resume();

      // KEEP-ALIVE OSCILLATOR (Critical Fix)
      const osc = audioCtxRef.current.createOscillator();
      const oscGain = audioCtxRef.current.createGain();
      oscGain.gain.value = 0.001; 
      osc.connect(oscGain);
      oscGain.connect(destNodeRef.current);
      osc.start();

      await startPlayback(true);

      const videoStream = canvasRef.current.captureStream(30);
      const audioStream = destNodeRef.current.stream;
      const combined = new MediaStream([...videoStream.getVideoTracks(), ...audioStream.getAudioTracks()]);

      const mime = MediaRecorder.isTypeSupported("video/webm; codecs=vp9") ? "video/webm; codecs=vp9" : "video/webm";
      const recorder = new MediaRecorder(combined, { mimeType: mime });
      
      const chunks: Blob[] = [];
      recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
      
      recorder.onstop = () => {
          osc.stop(); 
          const blob = new Blob(chunks, { type: "video/webm" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          const filename = script.title.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
          a.download = `${filename}_viral.webm`;
          document.body.appendChild(a);
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 2000);
      };

      const checkEnd = setInterval(() => {
          if (!isPlaying && !sourceNodeRef.current) {
              if (recorder.state === "recording") recorder.stop();
              clearInterval(checkEnd);
          }
      }, 500);

      recorder.start();
  };

  const handleInteract = () => {
      if (audioCtxRef.current) audioCtxRef.current.resume();
      setHasUserInteracted(true);
      startPlayback(false);
  };

  return (
    <div className="flex flex-col lg:flex-row gap-8 items-start justify-center max-w-7xl mx-auto">
        <div className="relative shrink-0 w-[320px] h-[640px] bg-black rounded-[3rem] border-[8px] border-gray-800 shadow-2xl overflow-hidden group">
            
            {isReady && !hasUserInteracted && (
                <div onClick={handleInteract} className="absolute inset-0 z-50 bg-black/80 flex flex-col items-center justify-center cursor-pointer hover:bg-black/70 transition">
                    <PlayCircle size={64} className="text-brand-500 mb-4 animate-pulse" />
                    <h3 className="text-white font-bold text-xl">Clique para Iniciar</h3>
                    <p className="text-gray-400 text-sm mt-2">Ativar Áudio & Preview</p>
                </div>
            )}

            {!isReady && (
                <div className="absolute inset-0 z-40 bg-gray-900 flex flex-col items-center justify-center">
                    <Loader2 className="animate-spin text-brand-500 mb-4" size={32} />
                    <p className="text-gray-400 text-sm animate-pulse">{loadingStatus}</p>
                </div>
            )}

            <canvas ref={canvasRef} width={540} height={960} className="w-full h-full object-cover" />
        </div>

        <div className="flex-1 w-full space-y-6">
            <div className="bg-gray-800/50 border border-gray-700 rounded-2xl p-6 backdrop-blur-xl">
                <h3 className="text-2xl font-bold text-white mb-2">{script.title.replace(/[-_]/g, ' ')}</h3>
                
                <div className="flex gap-4 mb-6">
                    <button 
                        onClick={() => startPlayback(false)} 
                        disabled={!isReady || isProcessing || !hasUserInteracted} 
                        className="flex-1 bg-brand-600 hover:bg-brand-500 text-white py-3 rounded-xl font-bold flex items-center justify-center gap-2 transition disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {isPlaying ? <Pause size={20}/> : <Play size={20}/>}
                        {isPlaying ? "Pausar" : "Tocar Preview"}
                    </button>
                    <button onClick={() => setIsMuted(!isMuted)} className="p-3 bg-gray-700 rounded-xl hover:bg-gray-600">
                        {isMuted ? <VolumeX/> : <Volume2/>}
                    </button>
                </div>

                <button 
                    onClick={handleDownload} 
                    disabled={!isReady || isProcessing || !hasUserInteracted} 
                    className="w-full bg-white text-black py-4 rounded-xl font-black text-lg flex items-center justify-center gap-3 hover:bg-gray-200 transition shadow-lg disabled:opacity-50"
                >
                    {isProcessing ? <Loader2 className="animate-spin text-red-600"/> : <Download className="text-brand-600"/>}
                    {isProcessing ? "Gravando (Não feche)..." : "Baixar Vídeo (Com Áudio)"}
                </button>
                <p className="text-xs text-gray-500 text-center mt-3">
                    A gravação ocorre em tempo real para garantir sincronia perfeita.
                </p>
            </div>
            
            <button onClick={onEditRequest} className="w-full text-center text-gray-400 hover:text-white text-sm flex items-center justify-center gap-2">
                <RefreshCw size={14}/> Criar Novo Vídeo
            </button>
        </div>
    </div>
  );
};
