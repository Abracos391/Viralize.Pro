/// <reference lib="dom" />
import React, { useState, useEffect, useRef } from 'react';
import { GeneratedScript } from '../types';
import { Play, Pause, Volume2, VolumeX, Loader2, PlayCircle, CloudLightning, Download } from 'lucide-react';
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
  const [isProcessing, setIsProcessing] = useState(false); // Renderizando no servidor
  const [loadingStatus, setLoadingStatus] = useState("Iniciando...");
  const [progress, setProgress] = useState(0);
  const [finalVideoUrl, setFinalVideoUrl] = useState<string | null>(null);

  // --- REFS ---
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);
  
  // Audio & Assets
  const audioCtxRef = useRef<AudioContext | null>(null);
  const masterBufferRef = useRef<AudioBuffer | null>(null);
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const imageCache = useRef<Record<number, HTMLImageElement>>({});

  // --- 1. INITIALIZE AUDIO ENGINE ---
  useEffect(() => {
    const initAudio = () => {
        try {
            const AudioContextClass = (window as any).AudioContext || (window as any).webkitAudioContext;
            const ctx = new AudioContextClass();
            const gain = ctx.createGain();
            gain.connect(ctx.destination);
            audioCtxRef.current = ctx;
            gainNodeRef.current = gain;
        } catch (e) { console.error(e); }
    };
    initAudio();
    return () => { audioCtxRef.current?.close(); };
  }, []);

  useEffect(() => {
    if (gainNodeRef.current) gainNodeRef.current.gain.value = isMuted ? 0 : 1;
  }, [isMuted]);

  // --- HELPER: AUDIO BUFFER TO BASE64 (WAV) ---
  const audioBufferToWavBase64 = (buffer: AudioBuffer): string => {
      const numOfChan = 1;
      const length = buffer.length * numOfChan * 2 + 44;
      const bufferArr = new ArrayBuffer(length);
      const view = new DataView(bufferArr);
      const channels = [];
      let i;
      let sample;
      let offset = 0;
      let pos = 0;

      // write WAVE header
      setUint32(0x46464952);                         // "RIFF"
      setUint32(length - 8);                         // file length - 8
      setUint32(0x45564157);                         // "WAVE"
      setUint32(0x20746d66);                         // "fmt " chunk
      setUint32(16);                                 // length = 16
      setUint16(1);                                  // PCM (uncompressed)
      setUint16(numOfChan);
      setUint32(buffer.sampleRate);
      setUint32(buffer.sampleRate * 2 * numOfChan);  // avg. bytes/sec
      setUint16(numOfChan * 2);                      // block-align
      setUint16(16);                                 // 16-bit 
      setUint32(0x61746164);                         // "data" - chunk
      setUint32(length - pos - 4);                   // chunk length

      for(i = 0; i < buffer.numberOfChannels; i++) channels.push(buffer.getChannelData(i));

      while(pos < buffer.length) {
          for(i = 0; i < numOfChan; i++) {
              sample = Math.max(-1, Math.min(1, channels[i][pos])); 
              sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767)|0; 
              view.setInt16(44 + offset, sample, true); 
              offset += 2;
          }
          pos++;
      }

      function setUint16(data: any) { view.setUint16(pos, data, true); pos += 2; }
      function setUint32(data: any) { view.setUint32(pos, data, true); pos += 4; }

      let binary = '';
      const bytes = new Uint8Array(bufferArr);
      const len = bytes.byteLength;
      for (let i = 0; i < len; i++) binary += String.fromCharCode(bytes[i]);
      return "data:audio/wav;base64," + window.btoa(binary);
  }

  // --- 2. LOAD ASSETS ---
  useEffect(() => {
    let mounted = true;
    const loadAssets = async () => {
        setIsReady(false);
        setHasUserInteracted(false); 
        setFinalVideoUrl(null);
        
        // A. Load Images
        setLoadingStatus("Carregando Imagens...");
        const tempImages: Record<number, HTMLImageElement> = {};
        
        for (const scene of script.scenes) {
             let url = "";
             try { url = await getStockImage(scene.imageKeyword); } 
             catch { url = `https://picsum.photos/seed/${scene.imageKeyword}/1080/1920`; }
             
             // Bypass cache para garantir que não tenhamos canvas "sujo"
             const safeUrl = `${url}?t=${Date.now()}`;

             await new Promise<void>((resolve) => {
                const img = new Image();
                img.crossOrigin = "anonymous"; // CRUCIAL para poder exportar a imagem depois
                img.src = safeUrl;
                img.onload = () => { tempImages[scene.id] = img; resolve(); };
                img.onerror = () => resolve();
             });
        }
        imageCache.current = tempImages;

        // B. Mix Audio
        setLoadingStatus("Gerando Voz...");
        if (audioCtxRef.current) {
            const ctx = audioCtxRef.current;
            const tempBuffers: Record<number, AudioBuffer> = {};

            for (const scene of script.scenes) {
                try {
                    const b64 = await generateNarration(scene.narration);
                    if (b64 !== "SILENCE") {
                        const bin = atob(b64);
                        const bytes = new Uint8Array(bin.length);
                        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
                        tempBuffers[scene.id] = await ctx.decodeAudioData(bytes.buffer);
                    } else {
                        const len = ctx.sampleRate * scene.duration;
                        const buf = ctx.createBuffer(1, len, ctx.sampleRate);
                        tempBuffers[scene.id] = buf;
                    }
                } catch (e) { console.warn("Audio fail", e); }
            }

            setLoadingStatus("Mixando...");
            const totalDuration = script.scenes.reduce((acc, s) => acc + s.duration, 0);
            const OfflineCtx = (window as any).OfflineAudioContext || (window as any).webkitOfflineAudioContext;
            const offlineCtx = new OfflineCtx(1, Math.ceil(totalDuration * 44100), 44100);
            
            let offset = 0;
            script.scenes.forEach(s => {
                const buf = tempBuffers[s.id];
                if (buf) {
                    const src = offlineCtx.createBufferSource();
                    src.buffer = buf;
                    src.connect(offlineCtx.destination);
                    src.start(offset);
                }
                offset += s.duration;
            });

            masterBufferRef.current = await offlineCtx.startRendering();
        }

        if (mounted) {
            setLoadingStatus("Pronto");
            setIsReady(true);
            setTimeout(() => drawPreviewFrame(0), 100);
        }
    };
    loadAssets();
    return () => { mounted = false; };
  }, [script]);

  // --- 3. CANVAS HELPERS ---
  const drawSceneToContext = (ctx: CanvasRenderingContext2D, sceneIdx: number, width: number, height: number) => {
      const scene = script.scenes[sceneIdx];
      
      // BG
      ctx.fillStyle = "black";
      ctx.fillRect(0,0,width,height);
      
      // Img
      const img = imageCache.current[scene.id];
      if (img) {
          // Object-cover logic
          const scale = Math.max(width / img.width, height / img.height);
          const x = (width / 2) - (img.width / 2) * scale;
          const y = (height / 2) - (img.height / 2) * scale;
          ctx.drawImage(img, x, y, img.width * scale, img.height * scale);
      }

      // Overlay Dim
      ctx.fillStyle = "rgba(0,0,0,0.3)";
      ctx.fillRect(0,0,width,height);

      // Text Overlay
      const fontSizeTitle = Math.floor(width * 0.08); // Responsive font
      ctx.font = `900 ${fontSizeTitle}px sans-serif`;
      ctx.fillStyle = "white";
      ctx.textAlign = "center";
      ctx.shadowColor = "black";
      ctx.shadowBlur = 10;
      
      // Simple text wrap for title
      const words = scene.overlayText.toUpperCase().split(' ');
      let line = '';
      let y = height / 2;
      for(let n=0; n<words.length; n++) {
        const testLine = line + words[n] + ' ';
        const metrics = ctx.measureText(testLine);
        if (metrics.width > width * 0.9 && n > 0) {
            ctx.fillText(line, width/2, y);
            line = words[n] + ' ';
            y += fontSizeTitle * 1.2;
        } else {
            line = testLine;
        }
      }
      ctx.fillText(line, width/2, y);

      // Subtitles (Bottom)
      const fontSizeSub = Math.floor(width * 0.05);
      ctx.font = `bold ${fontSizeSub}px sans-serif`;
      ctx.fillStyle = "#fbbf24";
      ctx.fillText(scene.narration.substring(0, 50) + "...", width/2, height - (height * 0.1));
  };

  const drawPreviewFrame = (elapsed: number) => {
      const cvs = canvasRef.current;
      const ctx = cvs?.getContext('2d');
      if (!cvs || !ctx) return;

      let t = 0;
      let activeIdx = 0;
      for (let i=0; i<script.scenes.length; i++) {
          const s = script.scenes[i];
          if (elapsed >= t && elapsed < t + s.duration) { activeIdx = i; break; }
          t += s.duration;
      }
      drawSceneToContext(ctx, activeIdx, cvs.width, cvs.height);
  };

  // --- 4. PREVIEW PLAYBACK ---
  const startPlayback = async () => {
      if (!audioCtxRef.current || !masterBufferRef.current) return;
      const ctx = audioCtxRef.current;
      if (ctx.state === 'suspended') await ctx.resume();

      if (sourceNodeRef.current) try{sourceNodeRef.current.stop()}catch(e){}
      
      const source = ctx.createBufferSource();
      source.buffer = masterBufferRef.current;
      source.connect(gainNodeRef.current!);
      source.start(0);
      sourceNodeRef.current = source;
      
      setIsPlaying(true);
      startTimeRef.current = Date.now();
      const totalDuration = masterBufferRef.current.duration;

      const loop = () => {
          const elapsed = (Date.now() - startTimeRef.current) / 1000;
          if (elapsed >= totalDuration) {
              setIsPlaying(false);
              return;
          }
          setProgress(elapsed / totalDuration);
          drawPreviewFrame(elapsed);
          animationFrameRef.current = requestAnimationFrame(loop);
      };
      animationFrameRef.current = requestAnimationFrame(loop);
  };

  // --- 5. SERVER RENDER (GENERATE PAYLOAD) ---
  const handleServerRender = async () => {
      if (!masterBufferRef.current) return;
      setIsProcessing(true);
      
      try {
          // A. Convert Master Audio to Base64
          const wavBase64 = audioBufferToWavBase64(masterBufferRef.current);
          
          // B. Generate Image Frames (With Text Burned In)
          const imagesBase64: string[] = [];
          
          // Create a temp canvas for HD rendering
          const renderCanvas = document.createElement('canvas');
          renderCanvas.width = 1080;
          renderCanvas.height = 1920;
          const ctx = renderCanvas.getContext('2d');
          
          if (!ctx) throw new Error("Canvas init failed");

          for (let i=0; i<script.scenes.length; i++) {
              drawSceneToContext(ctx, i, 1080, 1920);
              // Export as JPEG (lighter than PNG)
              imagesBase64.push(renderCanvas.toDataURL('image/jpeg', 0.85));
          }

          // C. Send to Backend
          const response = await fetch('/api/render', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                  script: script,
                  imagesBase64: imagesBase64, // Array of data:image/jpeg;base64,...
                  audioBase64: wavBase64     // data:audio/wav;base64,...
              })
          });

          if (!response.ok) {
              const err = await response.text();
              throw new Error("Erro no Servidor: " + err);
          }
          
          const data = await response.json();
          if (data.success && data.url) {
              setFinalVideoUrl(data.url);
              // Auto download trigger
              window.location.href = data.url; 
          } else {
              throw new Error(data.error || "Unknown Error");
          }

      } catch (e: any) {
          alert("Render Falhou: " + e.message);
          console.error(e);
      } finally {
          setIsProcessing(false);
      }
  };

  const handleInteract = () => {
      if (audioCtxRef.current) audioCtxRef.current.resume();
      setHasUserInteracted(true);
      startPlayback();
  };

  return (
    <div className="flex flex-col lg:flex-row gap-8 items-start justify-center max-w-7xl mx-auto">
        {/* PREVIEW */}
        <div className="relative shrink-0 w-[320px] h-[640px] bg-black rounded-3xl overflow-hidden border-4 border-gray-800 shadow-2xl">
            {!isReady && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-900 z-20">
                    <Loader2 className="animate-spin text-brand-500 mb-2"/>
                    <p className="text-gray-400 text-sm">{loadingStatus}</p>
                </div>
            )}
            
            {isReady && !hasUserInteracted && (
                <div onClick={handleInteract} className="absolute inset-0 z-30 bg-black/70 flex flex-col items-center justify-center cursor-pointer hover:bg-black/60 transition">
                    <PlayCircle size={64} className="text-brand-500 animate-pulse"/>
                    <p className="text-white font-bold mt-2">Toque para Iniciar</p>
                </div>
            )}

            <canvas ref={canvasRef} width={540} height={960} className="w-full h-full object-cover"/>
        </div>

        {/* CONTROLS */}
        <div className="flex-1 w-full space-y-6">
            <div className="bg-gray-800 p-8 rounded-2xl border border-gray-700">
                <h3 className="text-2xl font-bold text-white mb-2">{script.title}</h3>
                <p className="text-gray-400 text-sm mb-6">Preview em baixa resolução. O download gera vídeo HD.</p>
                
                <div className="flex gap-4 mb-6">
                     <button onClick={startPlayback} disabled={!hasUserInteracted} className="flex-1 bg-gray-700 hover:bg-gray-600 text-white py-3 rounded-xl font-bold flex items-center justify-center gap-2">
                        {isPlaying ? <Pause/> : <Play/>} Preview Rápido
                     </button>
                </div>

                <button 
                    onClick={handleServerRender} 
                    disabled={isProcessing || !isReady} 
                    className="w-full bg-brand-600 hover:bg-brand-500 text-white py-5 rounded-xl font-black text-xl flex items-center justify-center gap-3 shadow-lg disabled:opacity-50 transition transform hover:scale-[1.02]"
                >
                    {isProcessing ? <Loader2 className="animate-spin"/> : <CloudLightning/>}
                    {isProcessing ? "Gerando MP4 no Servidor..." : "BAIXAR VÍDEO FINAL (HD)"}
                </button>
                
                {finalVideoUrl && (
                    <div className="mt-6 p-4 bg-green-900/30 border border-green-500 rounded-xl text-center animate-in slide-in-from-top-2">
                        <p className="text-green-400 font-bold mb-2 flex items-center justify-center gap-2"><Download size={18}/> Vídeo Pronto!</p>
                        <a href={finalVideoUrl} download className="text-white font-bold underline">Clique aqui para baixar novamente</a>
                    </div>
                )}
            </div>
            
             <button onClick={onEditRequest} disabled={isProcessing} className="w-full text-center text-gray-500 hover:text-white text-sm">
                Voltar para Edição
            </button>
        </div>
    </div>
  );
};
