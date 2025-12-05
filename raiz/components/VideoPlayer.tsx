/// <reference lib="dom" />
import React, { useState, useEffect, useRef } from 'react';
import { GeneratedScript } from '../types';
import { Play, Pause, Loader2, PlayCircle, Download, CloudLightning, RefreshCw } from 'lucide-react';
import { generateNarration, getStockImage } from '../services/geminiService';

interface VideoPlayerProps {
  script: GeneratedScript;
  onEditRequest: () => void;
}

export const VideoPlayer: React.FC<VideoPlayerProps> = ({ script, onEditRequest }) => {
  const [isReady, setIsReady] = useState(false);         
  const [isPlaying, setIsPlaying] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false); 
  const [loadingStatus, setLoadingStatus] = useState("Iniciando...");
  const [finalVideoUrl, setFinalVideoUrl] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);
  
  const audioCtxRef = useRef<AudioContext | null>(null);
  const masterBufferRef = useRef<AudioBuffer | null>(null); 
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const imageCache = useRef<Record<number, HTMLImageElement>>({});

  // 1. INICIALIZAR MOTOR DE ÁUDIO
  useEffect(() => {
    const initAudio = () => {
        try {
            const AudioContextClass = (window as any).AudioContext || (window as any).webkitAudioContext;
            const ctx = new AudioContextClass();
            audioCtxRef.current = ctx;
        } catch (e) { console.error(e); }
    };
    initAudio();
    return () => { audioCtxRef.current?.close(); };
  }, []);

  // 2. CONVERSOR WAV (Para enviar ao servidor)
  const audioBufferToWavBlob = (buffer: AudioBuffer): Blob => {
      const numOfChan = 1;
      const length = buffer.length * numOfChan * 2 + 44;
      const bufferArr = new ArrayBuffer(length);
      const view = new DataView(bufferArr);
      const channels = [];
      let i, sample, offset = 0, pos = 0;

      // Header WAV Padrão
      setUint32(0x46464952); // "RIFF"
      setUint32(length - 8);
      setUint32(0x45564157); // "WAVE"
      setUint32(0x20746d66); // "fmt "
      setUint32(16);
      setUint16(1); // PCM
      setUint16(numOfChan);
      setUint32(buffer.sampleRate);
      setUint32(buffer.sampleRate * 2 * numOfChan);
      setUint16(numOfChan * 2);
      setUint16(16);
      setUint32(0x61746164); // "data"
      setUint32(length - pos - 4);

      for(i=0; i<buffer.numberOfChannels; i++) channels.push(buffer.getChannelData(i));

      while(pos < buffer.length) {
          for(i=0; i<numOfChan; i++) {
              sample = Math.max(-1, Math.min(1, channels[i][pos])); 
              sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767)|0; 
              view.setInt16(44 + offset, sample, true); 
              offset += 2;
          }
          pos++;
      }
      
      function setUint16(data: any) { view.setUint16(pos, data, true); pos += 2; }
      function setUint32(data: any) { view.setUint32(pos, data, true); pos += 4; }

      return new Blob([view], { type: 'audio/wav' });
  }

  // 3. CARREGAMENTO DE ATIVOS (PREPARAÇÃO)
  useEffect(() => {
    let mounted = true;
    const loadAssets = async () => {
        setIsReady(false);
        setFinalVideoUrl(null);
        
        // A. Imagens
        setLoadingStatus("Baixando Imagens...");
        const tempImages: Record<number, HTMLImageElement> = {};
        for (const scene of script.scenes) {
             let url = "";
             try { url = await getStockImage(scene.imageKeyword); } 
             catch { url = `https://picsum.photos/seed/${scene.imageKeyword}/1080/1920`; }
             const safeUrl = `${url}?t=${Date.now()}`;
             await new Promise<void>((resolve) => {
                const img = new Image();
                img.crossOrigin = "anonymous"; 
                img.src = safeUrl;
                img.onload = () => { tempImages[scene.id] = img; resolve(); };
                img.onerror = () => resolve();
             });
        }
        imageCache.current = tempImages;

        // B. Áudio (Mixagem Offline)
        setLoadingStatus("Preparando Áudio...");
        if (audioCtxRef.current) {
            const ctx = audioCtxRef.current;
            const tempBuffers: Record<number, AudioBuffer> = {};

            // Baixar TTS
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
                        tempBuffers[scene.id] = ctx.createBuffer(1, len, ctx.sampleRate);
                    }
                } catch (e) { console.warn("Audio fail", e); }
            }

            // Mixar tudo em um único Buffer (Master Track)
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

  // 4. DESENHO DO CANVAS (PREVIEW & RENDER FRAME)
  const drawSceneToContext = (ctx: CanvasRenderingContext2D, sceneIdx: number, width: number, height: number) => {
      const scene = script.scenes[sceneIdx];
      
      // Fundo Preto
      ctx.fillStyle = "black";
      ctx.fillRect(0,0,width,height);
      
      // Imagem
      const img = imageCache.current[scene.id];
      if (img) {
          const scale = Math.max(width / img.width, height / img.height);
          const x = (width / 2) - (img.width / 2) * scale;
          const y = (height / 2) - (img.height / 2) * scale;
          ctx.drawImage(img, x, y, img.width * scale, img.height * scale);
      }

      // Filtro Escuro
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.fillRect(0,0,width,height);

      // TÍTULO (Queimado na imagem)
      const cleanTitle = scene.overlayText.toUpperCase().replace(/[-_]/g, ' ');
      // Ajuste de fonte baseado no tamanho do canvas
      const fontSizeTitle = width * 0.08; 
      ctx.fillStyle = "white";
      ctx.font = `900 ${fontSizeTitle}px Inter, sans-serif`;
      ctx.textAlign = "center";
      ctx.shadowColor = "black";
      ctx.shadowBlur = 15;
      
      const words = cleanTitle.split(' ');
      let line = '';
      let y = height / 2;
      for (let n = 0; n < words.length; n++) {
        const testLine = line + words[n] + ' ';
        if (ctx.measureText(testLine).width > width * 0.9 && n > 0) {
            ctx.fillText(line, width/2, y);
            line = words[n] + ' ';
            y += fontSizeTitle * 1.2;
        } else { line = testLine; }
      }
      ctx.fillText(line, width/2, y);

      // LEGENDA (Queimada na imagem)
      const fontSizeSub = width * 0.05;
      ctx.font = `bold ${fontSizeSub}px Inter, sans-serif`;
      ctx.fillStyle = "#fbbf24"; // Amarelo
      const text = scene.narration.length > 80 ? scene.narration.substring(0, 80) + "..." : scene.narration;
      
      // Fundo da legenda
      const tw = ctx.measureText(text).width;
      ctx.fillStyle = "rgba(0,0,0,0.7)";
      const pad = 20;
      const subY = height - (height * 0.15);
      ctx.fillRect((width/2) - (tw/2) - pad, subY - fontSizeSub, tw + (pad*2), fontSizeSub * 1.5);
      
      ctx.fillStyle = "#fbbf24";
      ctx.fillText(text, width/2, subY);
  };

  const drawPreviewFrame = (elapsed: number) => {
      const cvs = canvasRef.current;
      const ctx = cvs?.getContext('2d');
      if (!cvs || !ctx) return;
      
      // Achar cena atual
      let t = 0; let idx = 0;
      for (let i=0; i<script.scenes.length; i++) {
          if (elapsed >= t && elapsed < t + script.scenes[i].duration) { idx = i; break; }
          t += script.scenes[i].duration;
      }
      drawSceneToContext(ctx, idx, cvs.width, cvs.height);
  };

  // 5. FUNÇÃO DE RENDERIZAÇÃO NO SERVIDOR (A MÁGICA)
  const handleServerRender = async () => {
      if (!masterBufferRef.current) return;
      setIsProcessing(true);
      
      try {
          const jobId = `job_${Date.now()}`;
          const formData = new FormData();
          formData.append('jobId', jobId);
          formData.append('scriptJson', JSON.stringify(script));

          // 1. Enviar Áudio Mestre
          const audioBlob = audioBufferToWavBlob(masterBufferRef.current);
          formData.append('audio', audioBlob, 'audio.wav');

          // 2. Renderizar Frames em HD (1080p) e Enviar
          const renderCanvas = document.createElement('canvas');
          renderCanvas.width = 1080;
          renderCanvas.height = 1920;
          const ctx = renderCanvas.getContext('2d');
          
          if (!ctx) throw new Error("Falha no Canvas");

          setLoadingStatus("Preparando Frames HD...");
          for (let i=0; i<script.scenes.length; i++) {
              drawSceneToContext(ctx, i, 1080, 1920);
              
              await new Promise<void>(resolve => {
                  renderCanvas.toBlob(blob => {
                      if (blob) formData.append(`frame_${i}`, blob, `frame_${i}.jpg`);
                      resolve();
                  }, 'image/jpeg', 0.95);
              });
          }

          // 3. Enviar para o Backend
          setLoadingStatus("Enviando para Servidor...");
          const response = await fetch('/api/render-job', {
              method: 'POST',
              body: formData
          });

          if (!response.ok) {
              const err = await response.text();
              throw new Error("Erro Servidor: " + err);
          }

          const data = await response.json();
          if (data.success && data.url) {
              setFinalVideoUrl(data.url);
          } else {
              throw new Error(data.error);
          }

      } catch (e: any) {
          alert("Erro: " + e.message);
      } finally {
          setIsProcessing(false);
          setLoadingStatus("Pronto");
      }
  };

  const togglePreview = async () => {
      if (!audioCtxRef.current || !masterBufferRef.current) return;
      const ctx = audioCtxRef.current;
      if (ctx.state === 'suspended') await ctx.resume();

      if (isPlaying) {
          sourceNodeRef.current?.stop();
          setIsPlaying(false);
          if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      } else {
          const source = ctx.createBufferSource();
          source.buffer = masterBufferRef.current;
          source.connect(ctx.destination);
          source.start(0);
          sourceNodeRef.current = source;
          
          setIsPlaying(true);
          startTimeRef.current = Date.now();
          const dur = masterBufferRef.current.duration;

          const loop = () => {
              const elapsed = (Date.now() - startTimeRef.current) / 1000;
              if (elapsed >= dur) { setIsPlaying(false); return; }
              drawPreviewFrame(elapsed);
              animationFrameRef.current = requestAnimationFrame(loop);
          };
          animationFrameRef.current = requestAnimationFrame(loop);
      }
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
            <canvas ref={canvasRef} width={540} height={960} className="w-full h-full object-cover"/>
            
            {isReady && !isPlaying && (
                <div onClick={togglePreview} className="absolute inset-0 flex items-center justify-center bg-black/30 cursor-pointer z-10 hover:bg-black/20 transition">
                    <PlayCircle size={64} className="text-white opacity-80"/>
                </div>
            )}
        </div>

        {/* CONTROLS */}
        <div className="flex-1 w-full space-y-6">
            <div className="bg-gray-800 p-8 rounded-2xl border border-gray-700">
                <h3 className="text-2xl font-bold text-white mb-2">{script.title}</h3>
                
                <div className="flex gap-4 mb-6">
                     <button onClick={togglePreview} className="flex-1 bg-gray-700 hover:bg-gray-600 text-white py-3 rounded-xl font-bold flex items-center justify-center gap-2">
                        {isPlaying ? <Pause/> : <Play/>} Preview
                     </button>
                </div>

                {!finalVideoUrl ? (
                    <button 
                        onClick={handleServerRender} 
                        disabled={isProcessing || !isReady} 
                        className="w-full bg-brand-600 hover:bg-brand-500 text-white py-5 rounded-xl font-black text-xl flex items-center justify-center gap-3 shadow-lg disabled:opacity-50 transition hover:scale-[1.02]"
                    >
                        {isProcessing ? <Loader2 className="animate-spin"/> : <CloudLightning/>}
                        {isProcessing ? "Renderizando no Servidor..." : "GERAR VÍDEO FINAL (HD)"}
                    </button>
                ) : (
                    <div className="bg-green-900/30 border border-green-500 rounded-xl p-6 text-center animate-in slide-in-from-top-2">
                        <h4 className="text-green-400 font-bold text-lg mb-2">Vídeo Renderizado com Sucesso!</h4>
                        <div className="flex gap-4 justify-center">
                            <a href={finalVideoUrl} download className="bg-green-600 hover:bg-green-500 text-white px-8 py-3 rounded-lg font-bold flex items-center gap-2 shadow-lg">
                                <Download/> Baixar MP4
                            </a>
                            <button onClick={() => setFinalVideoUrl(null)} className="bg-gray-700 hover:bg-gray-600 px-4 rounded-lg">
                                <RefreshCw/>
                            </button>
                        </div>
                    </div>
                )}
            </div>
            
            <button onClick={onEditRequest} className="w-full text-center text-gray-500 hover:text-white text-sm">
                Voltar para Edição
            </button>
        </div>
    </div>
  );
};
