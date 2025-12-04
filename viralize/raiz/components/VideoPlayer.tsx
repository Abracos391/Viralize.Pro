/// <reference lib="dom" />
import React, { useState, useEffect, useRef } from 'react';
import { GeneratedScript } from '../types';
import { Play, Pause, Volume2, VolumeX, Download, Loader2 } from 'lucide-react';
import { generateNarration, getStockImage } from '../services/geminiService';

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
  const [isRecording, setIsRecording] = useState(false);
  
  // Refs for Assets
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageCache = useRef<Record<number, HTMLImageElement>>({});
  
  // Audio Engine Refs
  const audioCtxRef = useRef<AudioContext | null>(null);
  const masterGainRef = useRef<GainNode | null>(null);
  const destNodeRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  
  // THE KEY FIX: Single Master Buffer instead of array of clips
  const masterBufferRef = useRef<AudioBuffer | null>(null);
  const activeSourceRef = useRef<AudioBufferSourceNode | null>(null);
  
  // Animation Refs
  const reqIdRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  // 1. INIT AUDIO ENGINE
  useEffect(() => {
    const init = () => {
        const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
        if (!Ctx) return;
        
        const ctx = new Ctx();
        const gain = ctx.createGain();
        const dest = ctx.createMediaStreamDestination();
        
        gain.connect(ctx.destination); // Speaker output
        gain.connect(dest);            // Recorder output
        
        audioCtxRef.current = ctx;
        masterGainRef.current = gain;
        destNodeRef.current = dest;
    };
    init();
    return () => { audioCtxRef.current?.close(); };
  }, []);

  useEffect(() => {
    if (masterGainRef.current) masterGainRef.current.gain.value = isMuted ? 0 : 1;
  }, [isMuted]);

  // 2. STITCHING LOGIC (The "Jurisprudence" Fix)
  // Combine small clips into one continuous 15s/30s track
  const createMasterTrack = (buffers: Record<number, AudioBuffer>, scenes: typeof script.scenes) => {
      const ctx = audioCtxRef.current;
      if (!ctx) return null;

      // Calculate total duration exactly based on script
      const totalDuration = scenes.reduce((acc, s) => acc + s.duration, 0);
      const sampleRate = ctx.sampleRate;
      const length = Math.ceil(totalDuration * sampleRate);
      
      // Create one big empty buffer
      const master = ctx.createBuffer(1, length, sampleRate); // Mono is safer for consistency
      const channelData = master.getChannelData(0);

      let offsetTime = 0;
      
      scenes.forEach((scene) => {
          const clip = buffers[scene.id];
          if (clip) {
              const clipData = clip.getChannelData(0);
              const startSample = Math.floor(offsetTime * sampleRate);
              
              // Copy clip into master, but don't overflow the scene duration
              // This ensures Scene 2 starts EXACTLY when Scene 1 is supposed to end visually
              const maxSamples = Math.floor(scene.duration * sampleRate);
              const copyLength = Math.min(clipData.length, maxSamples);
              
              for (let i = 0; i < copyLength; i++) {
                  if (startSample + i < length) {
                      channelData[startSample + i] = clipData[i];
                  }
              }
          }
          offsetTime += scene.duration;
      });
      
      return master;
  };

  // 3. ASSET LOADER
  useEffect(() => {
      let mounted = true;
      const load = async () => {
          setIsReady(false);
          setLoadingStatus("Downloading Visuals...");
          
          // A. Images
          for (const s of script.scenes) {
              if (!mounted) return;
              try {
                  const url = await getStockImage(s.imageKeyword);
                  const safeUrl = `${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`; // Cache bust
                  const img = new Image();
                  img.crossOrigin = "anonymous";
                  img.src = safeUrl;
                  await new Promise(r => { img.onload = r; img.onerror = r; });
                  imageCache.current[s.id] = img;
              } catch(e) {}
          }

          // B. Audio Clips
          setLoadingStatus("Synthesizing Audio...");
          const tempBuffers: Record<number, AudioBuffer> = {};
          
          for (const s of script.scenes) {
              if (!mounted) return;
              try {
                  const b64 = await generateNarration(s.narration);
                  if (audioCtxRef.current && b64 !== "SILENCE") {
                      const bin = atob(b64);
                      const arr = new Uint8Array(bin.length);
                      for(let k=0; k<bin.length; k++) arr[k] = bin.charCodeAt(k);
                      const buf = await audioCtxRef.current.decodeAudioData(arr.buffer);
                      tempBuffers[s.id] = buf;
                  }
              } catch(e) {}
          }

          // C. Stitch Master Track
          setLoadingStatus("Mixing Audio Track...");
          if (audioCtxRef.current) {
              const master = createMasterTrack(tempBuffers, script.scenes);
              masterBufferRef.current = master;
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

  // 4. DRAWING ENGINE
  const drawFrame = (elapsedTime: number) => {
      const cvs = canvasRef.current;
      const ctx = cvs?.getContext('2d');
      if (!cvs || !ctx) return;

      // Determine current scene based on time
      let t = 0;
      let activeScene = script.scenes[0];
      let sceneIndex = 0;
      let sceneProgress = 0; // 0 to 1

      for (let i = 0; i < script.scenes.length; i++) {
          const s = script.scenes[i];
          if (elapsedTime >= t && elapsedTime < t + s.duration) {
              activeScene = s;
              sceneIndex = i;
              sceneProgress = (elapsedTime - t) / s.duration;
              break;
          }
          t += s.duration;
      }

      // Draw Logic
      const img = imageCache.current[activeScene.id];
      
      // Black BG
      ctx.fillStyle = "black";
      ctx.fillRect(0,0,cvs.width, cvs.height);

      // Image with Zoom
      if (img) {
          const scale = 1 + (sceneProgress * 0.1); // 10% zoom over duration
          const w = cvs.width * scale;
          const h = cvs.height * scale;
          const x = (cvs.width - w) / 2;
          const y = (cvs.height - h) / 2;
          try { ctx.drawImage(img, x, y, w, h); } catch(e){}
      }

      // Dimmer
      ctx.fillStyle = "rgba(0,0,0,0.3)";
      ctx.fillRect(0,0,cvs.width, cvs.height);

      // Text Overlay
      const cx = cvs.width / 2;
      const cy = cvs.height / 2;
      
      ctx.save();
      ctx.fillStyle = "white";
      ctx.shadowColor = "black";
      ctx.shadowBlur = 15;
      ctx.textAlign = "center";
      
      // Title
      ctx.font = "900 48px Inter, sans-serif";
      wrapText(ctx, activeScene.overlayText.toUpperCase(), cx, cy, cvs.width * 0.9, 60);

      // Subtitles (Narration)
      ctx.font = "600 24px Inter, sans-serif";
      wrapSubtitle(ctx, activeScene.narration, cx, cvs.height - 160, cvs.width * 0.85, 34);
      
      ctx.restore();

      // Rec Dot
      if (isRecording) {
          ctx.fillStyle = "red";
          ctx.beginPath();
          ctx.arc(30, 30, 10, 0, Math.PI*2);
          ctx.fill();
      }
  };

  // Text Utils
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

  const wrapSubtitle = (ctx: CanvasRenderingContext2D, text: string, x: number, y: number, mw: number, lh: number) => {
      const words = text.split(' ');
      let line = '', lines = [];
      for(let w of words) {
          let test = line + w + ' ';
          if (ctx.measureText(test).width > mw && line !== '') { lines.push(line); line = w + ' '; }
          else line = test;
      }
      lines.push(line);
      let sy = y;
      lines.forEach(l => {
         const w = ctx.measureText(l).width;
         ctx.fillStyle = "rgba(0,0,0,0.6)";
         ctx.fillRect(x - w/2 - 8, sy - 20, w + 16, 28);
         ctx.fillStyle = "#fbbf24";
         ctx.fillText(l, x, sy);
         sy+=lh;
      });
  };

  // 5. PLAYBACK CONTROLLER
  const startPlayback = async (recordMode: boolean) => {
      if (!audioCtxRef.current || !masterBufferRef.current) return;
      
      if (audioCtxRef.current.state === 'suspended') await audioCtxRef.current.resume();

      // Stop previous
      if (activeSourceRef.current) { try{activeSourceRef.current.stop();}catch(e){} }
      if (reqIdRef.current) cancelAnimationFrame(reqIdRef.current);

      setIsPlaying(true);
      startTimeRef.current = Date.now();

      // Play Master Track
      const src = audioCtxRef.current.createBufferSource();
      src.buffer = masterBufferRef.current;
      src.connect(masterGainRef.current!);
      src.start(0);
      activeSourceRef.current = src;
      
      // If recording, we need a keep-alive osc just in case the master track has silence at start
      let osc: OscillatorNode | null = null;
      if (recordMode) {
          osc = audioCtxRef.current.createOscillator();
          const g = audioCtxRef.current.createGain();
          g.gain.value = 0.001; 
          osc.connect(g);
          g.connect(destNodeRef.current!);
          osc.start();
      }

      const totalDuration = masterBufferRef.current.duration * 1000;

      const loop = () => {
          const now = Date.now();
          const elapsed = now - startTimeRef.current;
          
          if (elapsed >= totalDuration) {
              if (recordMode) stopRecording(osc);
              else {
                  setIsPlaying(false);
                  if (activeSourceRef.current) { try{activeSourceRef.current.stop();}catch(e){} }
              }
              return;
          }

          drawFrame(elapsed / 1000); // Pass seconds
          reqIdRef.current = requestAnimationFrame(loop);
      };

      reqIdRef.current = requestAnimationFrame(loop);
  };

  const stopPlayback = () => {
      if (activeSourceRef.current) { try{activeSourceRef.current.stop();}catch(e){} }
      if (reqIdRef.current) cancelAnimationFrame(reqIdRef.current);
      setIsPlaying(false);
  };

  // 6. RECORDING
  const startRecording = () => {
      if (!canvasRef.current || !destNodeRef.current) return;
      setIsRecording(true);
      chunksRef.current = [];

      const vStream = canvasRef.current.captureStream(30);
      const aStream = destNodeRef.current.stream;
      const combined = new MediaStream([...vStream.getVideoTracks(), ...aStream.getAudioTracks()]);

      // Codec Sniffer
      let mime = '';
      if (MediaRecorder.isTypeSupported('video/webm;codecs=vp9')) mime = 'video/webm;codecs=vp9';
      else if (MediaRecorder.isTypeSupported('video/webm')) mime = 'video/webm';
      else if (MediaRecorder.isTypeSupported('video/mp4')) mime = 'video/mp4';

      const rec = new MediaRecorder(combined, mime ? { mimeType: mime } : undefined);
      rec.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      
      recorderRef.current = rec;
      rec.start(100); // 100ms slices

      startPlayback(true);
  };

  const stopRecording = (osc: OscillatorNode | null) => {
      if (osc) { try{osc.stop();}catch(e){} }
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
          recorderRef.current.onstop = saveFile;
          recorderRef.current.stop();
      }
      setIsRecording(false);
      setIsPlaying(false);
  };

  const saveFile = () => {
      const blob = new Blob(chunksRef.current, { type: 'video/webm' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${script.title.replace(/\s/g, '_')}_viral.webm`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
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
                <div className="flex gap-3 mb-4">
                    <button 
                        onClick={() => isPlaying ? stopPlayback() : startPlayback(false)}
                        disabled={!isReady || isRecording}
                        className="flex-1 bg-brand-600 hover:bg-brand-500 disabled:opacity-50 text-white font-bold py-3 rounded-xl flex items-center justify-center gap-2"
                    >
                        {isPlaying ? <Pause/> : <Play/>}
                        {isPlaying ? "Pause" : "Play Preview"}
                    </button>
                    <button onClick={() => setIsMuted(!isMuted)} className="bg-gray-700 rounded-xl p-3">
                        {isMuted ? <VolumeX/> : <Volume2/>}
                    </button>
                </div>
                <button 
                    onClick={startRecording}
                    disabled={!isReady || isRecording}
                    className="w-full bg-white text-black hover:bg-gray-100 disabled:opacity-50 font-black text-lg py-4 rounded-xl flex items-center justify-center gap-2 shadow-lg"
                >
                    {isRecording ? <Loader2 className="animate-spin text-red-600"/> : <Download className="text-brand-600"/>}
                    {isRecording ? "Creating Video..." : "Download Video"}
                </button>
            </div>
            <button onClick={onEditRequest} disabled={isRecording} className="w-full text-center text-gray-400 underline hover:text-white text-sm">
                Back to Editor
            </button>
        </div>
    </div>
  );
};
