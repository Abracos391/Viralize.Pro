/// <reference lib="dom" />
import React, { useState, useEffect, useRef } from 'react';
import { GeneratedScript } from '../types';
import { Play, Pause, Volume2, VolumeX, Download, Loader2, CloudLightning } from 'lucide-react';
import { generateNarration, getStockImage } from '../services/geminiService';
import { renderWithShotstack, getShotstackKey } from '../services/shotstackService';

interface VideoPlayerProps {
  script: GeneratedScript;
  onEditRequest: () => void;
}

export const VideoPlayer: React.FC<VideoPlayerProps> = ({ script, onEditRequest }) => {
  // UI State
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState("Initializing...");
  const [isReady, setIsReady] = useState(false);
  const [isRendering, setIsRendering] = useState(false);
  
  // Refs
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageCache = useRef<Record<number, HTMLImageElement>>({});
  
  // Simple Audio (Preview Only)
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // 1. ASSET LOADER (For Preview)
  useEffect(() => {
      let mounted = true;
      const load = async () => {
          setIsReady(false);
          setLoadingStatus("Loading Preview...");
          
          // A. Images
          for (const s of script.scenes) {
              if (!mounted) return;
              try {
                  const url = await getStockImage(s.imageKeyword);
                  const img = new Image();
                  img.crossOrigin = "anonymous";
                  img.src = url;
                  await new Promise(r => { img.onload = r; img.onerror = r; });
                  imageCache.current[s.id] = img;
              } catch(e) {}
          }
          
          if (mounted) {
              setIsReady(true);
              setLoadingStatus("Ready");
              setTimeout(() => drawFrame(0), 100);
          }
      };
      load();
      return () => { mounted = false; };
  }, [script]);

  // 2. DRAWING ENGINE (Preview Only)
  const drawFrame = (elapsedTime: number) => {
      const cvs = canvasRef.current;
      const ctx = cvs?.getContext('2d');
      if (!cvs || !ctx) return;

      let t = 0;
      let activeScene = script.scenes[0];
      let sceneProgress = 0;

      for (let i = 0; i < script.scenes.length; i++) {
          const s = script.scenes[i];
          if (elapsedTime >= t && elapsedTime < t + s.duration) {
              activeScene = s;
              sceneProgress = (elapsedTime - t) / s.duration;
              break;
          }
          t += s.duration;
      }

      const img = imageCache.current[activeScene.id];
      
      ctx.fillStyle = "black";
      ctx.fillRect(0,0,cvs.width, cvs.height);

      if (img) {
          const scale = 1 + (sceneProgress * 0.1); 
          const w = cvs.width * scale;
          const h = cvs.height * scale;
          const x = (cvs.width - w) / 2;
          const y = (cvs.height - h) / 2;
          try { ctx.drawImage(img, x, y, w, h); } catch(e){}
      }

      ctx.fillStyle = "rgba(0,0,0,0.3)";
      ctx.fillRect(0,0,cvs.width, cvs.height);

      const cx = cvs.width / 2;
      const cy = cvs.height / 2;
      
      ctx.save();
      ctx.fillStyle = "white";
      ctx.shadowColor = "black";
      ctx.shadowBlur = 15;
      ctx.textAlign = "center";
      
      ctx.font = "900 48px Inter, sans-serif";
      wrapText(ctx, activeScene.overlayText.toUpperCase(), cx, cy, cvs.width * 0.9, 60);
      
      ctx.restore();
  };

  const wrapText = (ctx: CanvasRenderingContext2D, text: string, x: number, y: number, mw: number, lh: number) => {
      const words = text.split(' ');
      let line = '', lines = [];
      for(let w of words) {
          let test = line + w + ' ';
          if (ctx.measureText(test).width > mw && line !== '') { lines.push(line); line = w + ' '; }
          else line = test;
      }
      lines.push(line);
      let sy = y - ((lines.length-1)*lh)/2;
      lines.forEach(l => { ctx.fillText(l, x, sy); sy+=lh; });
  };

  // 3. CLOUD RENDER HANDLER
  const handleCloudRender = async () => {
      const key = getShotstackKey();
      if (!key) {
          alert("Please enter a Shotstack API Key in the settings (top right) to use Cloud Rendering.");
          return;
      }

      setIsRendering(true);
      try {
          const url = await renderWithShotstack(script, (msg) => setLoadingStatus(msg));
          // Trigger Download
          const a = document.createElement('a');
          a.href = url;
          a.download = `${script.title}_viral.mp4`;
          a.target = "_blank";
          document.body.appendChild(a);
          a.click();
          setLoadingStatus("Download Started!");
      } catch (e: any) {
          alert("Render Failed: " + e.message);
          setLoadingStatus("Failed.");
      }
      setIsRendering(false);
  };

  return (
    <div className="flex flex-col lg:flex-row gap-8 items-start justify-center max-w-7xl mx-auto p-4">
        {/* PLAYER */}
        <div className="relative shrink-0 w-[320px] h-[640px] bg-black rounded-[2.5rem] border-[8px] border-gray-800 shadow-2xl overflow-hidden ring-4 ring-gray-900/50">
            {!isReady && (
                <div className="absolute inset-0 z-30 bg-gray-900 flex flex-col items-center justify-center p-6 text-center">
                    <Loader2 className="animate-spin text-brand-500 mb-4" size={40} />
                    <p className="text-gray-300 font-medium">{loadingStatus}</p>
                </div>
            )}
            <canvas ref={canvasRef} width={540} height={960} className="w-full h-full object-cover" />
        </div>

        {/* CONTROLS */}
        <div className="flex-1 w-full max-w-md space-y-6">
            <div className="bg-gray-800/60 border border-gray-700 rounded-2xl p-6 backdrop-blur-xl">
                <h3 className="text-2xl font-bold text-white mb-2">{script.title}</h3>
                <div className="mb-4 text-gray-400 text-sm">
                    Preview Mode (No Audio in Preview - Audio added in Cloud Render)
                </div>

                <button 
                    onClick={handleCloudRender}
                    disabled={!isReady || isRendering}
                    className="w-full bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-black text-lg py-4 rounded-xl flex items-center justify-center gap-3 shadow-lg transform transition hover:-translate-y-1"
                >
                    {isRendering ? <Loader2 className="animate-spin text-white"/> : <CloudLightning className="text-yellow-300"/>}
                    {isRendering ? "Rendering in Cloud..." : "Render Final Video (MP4)"}
                </button>
                <p className="text-xs text-center text-gray-500 mt-2">Powered by Shotstack API</p>
            </div>
            <button onClick={onEditRequest} disabled={isRendering} className="w-full text-center text-gray-400 underline hover:text-white text-sm">
                Back to Editor
            </button>
        </div>
    </div>
  );
};
