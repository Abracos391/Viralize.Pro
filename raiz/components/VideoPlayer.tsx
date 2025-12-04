/// <reference lib="dom" />
import React, { useState, useEffect, useRef } from 'react';
import { GeneratedScript } from '../types';
import { Play, Pause, Volume2, VolumeX, Download, Loader2, PlayCircle, RefreshCw, AlertTriangle } from 'lucide-react';
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
  
  // Audio Refs
  const audioCtxRef = useRef<AudioContext | null>(null);
  const masterBufferRef = useRef<AudioBuffer | null>(null); // THE MASTER TRACK
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const destNodeRef = useRef<MediaStreamAudioDestinationNode | null>(null); 
  
  // Asset Cache
  const imageCache = useRef<Record<number, HTMLImageElement>>({});

  // --- 1. INITIALIZE AUDIO ENGINE ---
  useEffect(() => {
    const initAudio = () => {
        try {
            const AudioContextClass = (window as any).AudioContext || (window as any).webkitAudioContext;
            const ctx = new AudioContextClass();
            const gain = ctx.createGain();
            const dest = ctx.createMediaStreamDestination();

            gain.connect(ctx.destination); // For Hearing
            gain.connect(dest);            // For Recording

            audioCtxRef.current = ctx;
            gainNodeRef.current = gain;
            destNodeRef.current = dest;
            console.log("Audio Engine Ready");
        } catch (e) {
            console.error("Audio Init Failed", e);
        }
    };
    initAudio();
    return () => { audioCtxRef.current?.close(); };
  }, []);

  useEffect(() => {
    if (gainNodeRef.current) gainNodeRef.current.gain.value = isMuted ? 0 : 1;
  }, [isMuted]);

  // --- 2. ASSET LOADING & OFFLINE MIXING ---
  useEffect(() => {
    let mounted = true;
    
    const loadAssets = async () => {
        setIsReady(false);
        setHasUserInteracted(false); 
        stopPlayback();
        
        // A. Load Images
        setLoadingStatus("Baixando Imagens...");
        const tempImages: Record<number, HTMLImageElement> = {};
        const imgPromises = script.scenes.map(async (scene) => {
            try {
                let url = await getStockImage(scene.imageKeyword);
                // Cache Busting vital for Tainted Canvas
                const safeUrl = url.includes('?') ? `${url}&t=${Date.now()}` : `${url}?t=${Date.now()}`;
                
                await new Promise<void>((resolve) => {
                    const img = new Image();
                    img.crossOrigin = "anonymous"; // CRITICAL
                    img.src = safeUrl;
                    img.onload = () => { tempImages[scene.id] = img; resolve(); };
                    img.onerror = () => { resolve(); }; // Fail safe
                });
            } catch (e) {}
        });

        // B. Load & Mix Audio (THE KEY FIX)
        setLoadingStatus("Gerando Áudio...");
        if (audioCtxRef.current) {
            const ctx = audioCtxRef.current;
            const tempBuffers: Record<number, AudioBuffer> = {};

            // 1. Fetch all clips
            for (const scene of script.scenes) {
                try {
                    setLoadingStatus(`Gerando Áudio ${scene.id}/${script.scenes.length}...`);
                    const b64 = await generateNarration(scene.narration);
                    if (b64 !== "SILENCE") {
                        const bin = atob(b64);
                        const bytes = new Uint8Array(bin.length);
                        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
                        const buf = await ctx.decodeAudioData(bytes.buffer);
                        tempBuffers[scene.id] = buf;
                    }
                } catch (e) { console.warn("Audio Clip Failed", e); }
            }

            // 2. OFFLINE RENDERING (Mixer)
            // This creates a single mathematically perfect WAV buffer
            setLoadingStatus("Mixando Faixa Mestra...");
            const totalDuration = script.scenes.reduce((acc, s) => acc + s.duration, 0);
            
            // Create Offline Context
            const OfflineCtx = (window as any).OfflineAudioContext || (window as any).webkitOfflineAudioContext;
            // 44100Hz is most compatible
            const offlineCtx = new OfflineCtx(1, Math.ceil(totalDuration * 44100), 44100);
            
            let offsetTime = 0;
            script.scenes.forEach((scene) => {
                const buffer = tempBuffers[scene.id];
                if (buffer) {
                    const source = offlineCtx.createBufferSource();
                    source.buffer = buffer;
                    source.connect(offlineCtx.destination);
                    source.start(offsetTime);
                }
                offsetTime += scene.duration;
            });

            // Render the Master Track
            const renderedBuffer = await offlineCtx.startRendering();
            masterBufferRef.current = renderedBuffer;
            console.log("Master Track Created:", renderedBuffer.duration, "seconds");
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

  // --- 3. PLAYBACK ENGINE ---
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
      if (!audioCtxRef.current || !masterBufferRef.current || !gainNodeRef.current) {
          alert("Erro: Áudio não inicializado. Recarregue a página.");
          return;
      }
      
      const ctx = audioCtxRef.current;
      if (ctx.state === 'suspended') await ctx.resume();

      stopPlayback();
      setIsPlaying(true);
      if (forRecording) setIsProcessing(true);

      // Play Master Track
      const source = ctx.createBufferSource();
      source.buffer = masterBufferRef.current;
      source.connect(gainNodeRef.current);
      source.start(0);
      sourceNodeRef.current = source;

      startTimeRef.current = Date.now();
      const totalDuration = script.scenes.reduce((acc, s) => acc + s.duration, 0);

      // Animation Loop
      const loop = () => {
          const now = Date.now();
          const elapsed = (now - startTimeRef.current) / 1000;

          if (elapsed >= totalDuration) {
              if (!forRecording) stopPlayback();
              // If recording, recorder.onstop handles state
              return;
          }

          setProgress(elapsed / totalDuration);
          drawFrame(elapsed);
          animationFrameRef.current = requestAnimationFrame(loop);
      };
      animationFrameRef.current = requestAnimationFrame(loop);
  };

  // --- 4. VISUAL RENDERER ---
  const drawFrame = (elapsed: number) => {
      const cvs = canvasRef.current;
      const ctx = cvs?.getContext('2d');
      if (!cvs || !ctx) return;

      // Find Active Scene
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

      // Background
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, cvs.width, cvs.height);

      // Image with Ken Burns
      const img = imageCache.current[activeScene.id];
      if (img) {
          const scale = 1 + (sceneElapsed / activeScene.duration) * 0.1; 
          const w = cvs.width * scale;
          const h = cvs.height * scale;
          const x = (cvs.width - w) / 2;
          const y = (cvs.height - h) / 2;
          try { ctx.drawImage(img, x, y, w, h); } catch(e){}
      }

      // Overlay
      ctx.fillStyle = "rgba(0,0,0,0.3)";
      ctx.fillRect(0, 0, cvs.width, cvs.height);

      // Text Drawing Helper
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

      // Titles & Subtitles
      const cleanOverlay = activeScene.overlayText.replace(/[-_]/g, ' ').toUpperCase();
      drawText(cleanOverlay, cvs.width/2, cvs.height/2, 52, false);

      ctx.font = "bold 28px Inter, sans-serif";
      drawText(activeScene.narration, cvs.width/2, cvs.height - 150, 28, true);

      // Recording Indicator
      if (isProcessing) {
          ctx.fillStyle = "red";
          ctx.beginPath();
          ctx.arc(40, 40, 15, 0, Math.PI*2);
          ctx.fill();
      }
  };

  // --- 5. NATIVE RECORDING (The "Mixer") ---
  const handleDownload = async () => {
      if (!isReady || !audioCtxRef.current || !destNodeRef.current || !canvasRef.current) return;
      
      try {
        if (audioCtxRef.current.state === 'suspended') await audioCtxRef.current.resume();

        // 1. SILENT OSCILLATOR (Prevents "No Audio" bug in Chrome)
        // This keeps the audio track active even if the master track has tiny gaps (it shouldn't)
        const osc = audioCtxRef.current.createOscillator();
        const oscGain = audioCtxRef.current.createGain();
        oscGain.gain.value = 0.001; // Inaudible
        osc.connect(oscGain);
        oscGain.connect(destNodeRef.current);
        osc.start();

        // 2. START PLAYBACK (Visuals + Master Audio)
        await startPlayback(true);

        // 3. CAPTURE STREAMS
        const videoStream = canvasRef.current.captureStream(30);
        const audioStream = destNodeRef.current.stream;
        const combined = new MediaStream([...videoStream.getVideoTracks(), ...audioStream.getAudioTracks()]);

        // 4. CODEC SNIFFING
        let mime = "video/webm";
        if (MediaRecorder.isTypeSupported("video/webm; codecs=vp9")) mime = "video/webm; codecs=vp9";
        else if (MediaRecorder.isTypeSupported("video/mp4")) mime = "video/mp4";

        const recorder = new MediaRecorder(combined, { mimeType: mime });
        const chunks: Blob[] = [];

        recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
        
        recorder.onstop = () => {
            osc.stop(); 
            const blob = new Blob(chunks, { type: mime });
            
            // Check if file is valid
            if (blob.size < 1000) {
                alert("Erro: Gravação falhou (Arquivo vazio). Tente novamente.");
                setIsProcessing(false);
                return;
            }

            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            const filename = script.title.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
            a.download = `${filename}_viral.webm`;
            document.body.appendChild(a);
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 2000);
            
            setIsProcessing(false);
        };

        // 5. STOP CHECKER
        // Since play stops automatically via animation loop, we poll to stop recorder
        const totalDuration = script.scenes.reduce((acc, s) => acc + s.duration, 0) * 1000;
        
        recorder.start();
        
        setTimeout(() => {
            if (recorder.state === 'recording') recorder.stop();
        }, totalDuration + 500); // 500ms buffer

      } catch (e: any) {
          alert("Erro no Download: " + e.message);
          setIsProcessing(false);
      }
  };

  const handleInteract = () => {
      if (audioCtxRef.current) audioCtxRef.current.resume();
      setHasUserInteracted(true);
      startPlayback(false);
  };

  return (
    <div className="flex flex-col lg:flex-row gap-8 items-start justify-center max-w-7xl mx-auto">
        {/* VIEWPORT */}
        <div className="relative shrink-0 w-[320px] h-[640px] bg-black rounded-[3rem] border-[8px] border-gray-800 shadow-2xl overflow-hidden group">
            
            {/* OVERLAY: CLICK TO START (Mandatory for Audio) */}
            {isReady && !hasUserInteracted && (
                <div onClick={handleInteract} className="absolute inset-0 z-50 bg-black/80 flex flex-col items-center justify-center cursor-pointer hover:bg-black/70 transition">
                    <PlayCircle size={64} className="text-brand-500 mb-4 animate-pulse" />
                    <h3 className="text-white font-bold text-xl">Clique para Iniciar</h3>
                    <p className="text-gray-400 text-sm mt-2">Ativar Áudio & Preview</p>
                </div>
            )}

            {/* OVERLAY: LOADING */}
            {!isReady && (
                <div className="absolute inset-0 z-40 bg-gray-900 flex flex-col items-center justify-center text-center p-4">
                    <Loader2 className="animate-spin text-brand-500 mb-4" size={32} />
                    <p className="text-gray-400 text-sm animate-pulse">{loadingStatus}</p>
                </div>
            )}

            {/* CANVAS */}
            <canvas ref={canvasRef} width={540} height={960} className="w-full h-full object-cover" />
        </div>

        {/* CONTROLS */}
        <div className="flex-1 w-full space-y-6">
            <div className="bg-gray-800/50 border border-gray-700 rounded-2xl p-6 backdrop-blur-xl">
                <h3 className="text-2xl font-bold text-white mb-2">{script.title.replace(/[-_]/g, ' ')}</h3>
                
                {!hasUserInteracted && isReady && (
                    <div className="mb-4 bg-yellow-900/30 border border-yellow-600/50 p-3 rounded-lg flex items-center gap-2 text-yellow-200 text-sm">
                        <AlertTriangle size={16}/> Clique na tela do celular ao lado para desbloquear o áudio.
                    </div>
                )}

                <div className="flex gap-4 mb-6">
                    <button 
                        onClick={() => startPlayback(false)} 
                        disabled={!isReady || isProcessing || !hasUserInteracted} 
                        className="flex-1 bg-brand-600 hover:bg-brand-500 text-white py-3 rounded-xl font-bold flex items-center justify-center gap-2 transition disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {isPlaying && !isProcessing ? <Pause size={20}/> : <Play size={20}/>}
                        {isPlaying && !isProcessing ? "Pausar" : "Tocar Preview"}
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
            </div>
            
            <button onClick={onEditRequest} className="w-full text-center text-gray-400 hover:text-white text-sm flex items-center justify-center gap-2">
                <RefreshCw size={14}/> Criar Novo Vídeo
            </button>
        </div>
    </div>
  );
};
