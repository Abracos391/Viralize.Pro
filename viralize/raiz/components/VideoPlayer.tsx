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
  // UI State
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentSceneIndex, setCurrentSceneIndex] = useState(0);
  const [progress, setProgress] = useState(0); 
  const [isMuted, setIsMuted] = useState(false);
  
  // Loading State
  const [assetsLoaded, setAssetsLoaded] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState("Initializing...");
  const [isProcessing, setIsProcessing] = useState(false); 
  
  // Refs for Logic
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number | null>(null);
  const sceneStartTimeRef = useRef<number>(0);
  
  // Asset Cache
  const imageCache = useRef<Record<number, HTMLImageElement>>({});
  const audioBufferCache = useRef<Record<number, AudioBuffer>>({});
  
  // Web Audio Context
  const audioCtxRef = useRef<AudioContext | null>(null); 
  const masterGainRef = useRef<GainNode | null>(null);
  const activeSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const destNodeRef = useRef<MediaStreamAudioDestinationNode | null>(null); // Recorder Input

  // Recorder State
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);

  // 1. INITIALIZE AUDIO ENGINE
  useEffect(() => {
    const initAudio = () => {
        try {
            const AudioContextClass = (window as any).AudioContext || (window as any).webkitAudioContext;
            if (!AudioContextClass) return;
            
            const ctx = new AudioContextClass();
            const masterGain = ctx.createGain();
            masterGain.gain.value = 1;

            // Connect to Speakers (Hearing)
            masterGain.connect(ctx.destination);
            
            // Connect to Recorder Destination (Recording)
            // This node "collects" all audio for the video file
            const dest = ctx.createMediaStreamDestination();
            masterGain.connect(dest);
            
            audioCtxRef.current = ctx;
            masterGainRef.current = masterGain;
            destNodeRef.current = dest;
            console.log("Audio Engine Initialized");
        } catch (e) {
            console.error("Audio Engine Failed:", e);
        }
    };
    initAudio();
    return () => { audioCtxRef.current?.close(); };
  }, []);

  useEffect(() => {
    if (masterGainRef.current) masterGainRef.current.gain.value = isMuted ? 0 : 1;
  }, [isMuted]);

  // 2. ASSET HELPERS
  const createSilentBuffer = (ctx: AudioContext | null, duration: number = 2.0) => {
      const rate = ctx ? ctx.sampleRate : 44100;
      const len = Math.ceil(rate * duration);
      const buf = ctx ? ctx.createBuffer(1, len, rate) : new AudioBuffer({length: len, sampleRate: rate, numberOfChannels: 1});
      // Tiny noise to keep track active
      const data = buf.getChannelData(0);
      for(let i=0; i<len; i++) data[i] = (Math.random() * 0.0002) - 0.0001; 
      return buf;
  };

  const decodeAudioData = async (base64: string, ctx: AudioContext) => {
      if (base64 === "SILENCE") return createSilentBuffer(ctx);
      try {
          const bin = atob(base64);
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          return await ctx.decodeAudioData(bytes.buffer);
      } catch (e) {
          console.warn("Audio Decode Failed, using silence");
          return createSilentBuffer(ctx);
      }
  };

  // 3. LOAD ASSETS
  useEffect(() => {
    setAssetsLoaded(false);
    setIsPlaying(false);
    imageCache.current = {};
    audioBufferCache.current = {};

    const load = async () => {
        setLoadingStatus("Preparing Assets...");
        
        // Load Images
        const imgPromises = script.scenes.map(async (scene) => {
            let url = "";
            try { url = await getStockImage(scene.imageKeyword); } 
            catch { url = `https://picsum.photos/seed/${scene.imageKeyword}/1080/1920`; }
            
            // Cache Busting + CrossOrigin is VITAL for Tainted Canvas prevention
            const safeUrl = url.includes('?') ? `${url}&t=${Date.now()}` : `${url}?t=${Date.now()}`;
            
            return new Promise<void>(resolve => {
                const img = new Image();
                img.crossOrigin = "anonymous";
                img.onload = () => { imageCache.current[scene.id] = img; resolve(); };
                img.onerror = () => { resolve(); }; // Continue even if failed
                img.src = safeUrl;
            });
        });

        // Load Audio
        for (let i=0; i<script.scenes.length; i++) {
            setLoadingStatus(`Synthesizing Audio ${i+1}/${script.scenes.length}...`);
            const s = script.scenes[i];
            try {
                const b64 = await generateNarration(s.narration);
                if (audioCtxRef.current) {
                    audioBufferCache.current[s.id] = await decodeAudioData(b64, audioCtxRef.current);
                }
            } catch (e) {
                if (audioCtxRef.current) audioBufferCache.current[s.id] = createSilentBuffer(audioCtxRef.current);
            }
        }

        await Promise.all(imgPromises);
        setAssetsLoaded(true);
        setLoadingStatus("Ready");
        setTimeout(() => drawFrame(0, 0), 100);
    };
    load();
    return () => { stopAudio(); if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current); };
  }, [script]);

  // 4. PLAYBACK CONTROLS
  const stopAudio = () => {
    if (activeSourceRef.current) {
        try { activeSourceRef.current.stop(); } catch(e) {}
        activeSourceRef.current = null;
    }
  };

  const playSceneAudio = (index: number) => {
    if (!audioCtxRef.current || !masterGainRef.current) return;
    stopAudio();
    const id = script.scenes[index].id;
    const buf = audioBufferCache.current[id];
    if (buf) {
        const src = audioCtxRef.current.createBufferSource();
        src.buffer = buf;
        src.connect(masterGainRef.current);
        src.start(0);
        activeSourceRef.current = src;
    }
  };

  // 5. ANIMATION LOOP
  const startPlayback = async (recording = false) => {
      // Ensure AudioContext is running (Chrome policy)
      if (audioCtxRef.current?.state === 'suspended') await audioCtxRef.current.resume();
      
      setCurrentSceneIndex(0);
      setProgress(0);
      sceneStartTimeRef.current = Date.now();
      setIsPlaying(true);
      if (recording) setIsProcessing(true);

      playSceneAudio(0);
      
      const loop = () => {
          const now = Date.now();
          const elapsed = now - sceneStartTimeRef.current;
          const currentScene = script.scenes[currentSceneIndex];
          const durationMs = currentScene.duration * 1000;
          
          let pct = (elapsed / durationMs) * 100;
          
          drawFrame(currentSceneIndex, Math.min(pct, 100));

          if (pct >= 100) {
              if (currentSceneIndex < script.scenes.length - 1) {
                  setCurrentSceneIndex(prev => {
                      const next = prev + 1;
                      sceneStartTimeRef.current = Date.now();
                      playSceneAudio(next);
                      return next;
                  });
                  animationFrameRef.current = requestAnimationFrame(loop);
              } else {
                  // End of Video
                  if (recording) {
                      setTimeout(() => finishRecording(), 500); // Buffer for last audio frame
                  } else {
                      setIsPlaying(false);
                      stopAudio();
                  }
              }
          } else {
              animationFrameRef.current = requestAnimationFrame(loop);
          }
      };
      animationFrameRef.current = requestAnimationFrame(loop);
  };

  // 6. RENDERER
  const drawFrame = (sceneIdx: number, pct: number) => {
      const cvs = canvasRef.current;
      if (!cvs || !assetsLoaded) return;
      const ctx = cvs.getContext('2d');
      if (!ctx) return;

      const scene = script.scenes[sceneIdx];
      const img = imageCache.current[scene.id];

      // Background
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, cvs.width, cvs.height);

      if (img) {
          // Ken Burns Effect
          const scale = 1 + (pct / 100) * 0.1;
          const sw = cvs.width * scale;
          const sh = cvs.height * scale;
          const dx = (cvs.width - sw) / 2;
          const dy = (cvs.height - sh) / 2;
          try {
             ctx.drawImage(img, dx, dy, sw, sh);
          } catch(e) {}
      } else {
          // Fallback
          ctx.fillStyle = '#333';
          ctx.fillRect(0,0,cvs.width, cvs.height);
      }

      // Overlay
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(0,0,cvs.width,cvs.height);

      const w = cvs.width; 
      const h = cvs.height;
      
      // Main Title
      ctx.save();
      ctx.font = '900 52px Inter, sans-serif';
      ctx.fillStyle = 'white';
      ctx.textAlign = 'center';
      ctx.shadowColor = 'black';
      ctx.shadowBlur = 15;
      wrapText(ctx, scene.overlayText.toUpperCase(), w/2, h/2, w*0.85, 65);
      ctx.restore();

      // Subtitles (Captions)
      ctx.save();
      ctx.font = 'bold 28px Inter, sans-serif';
      ctx.textAlign = 'center';
      wrapTextBg(ctx, scene.narration, w/2, h-200, w*0.9, 40);
      ctx.restore();

      // Recording Indicator
      if (isProcessing) {
          ctx.fillStyle = 'red';
          ctx.beginPath();
          ctx.arc(30, 30, 10, 0, Math.PI*2);
          ctx.fill();
      }
  };

  const wrapText = (ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number) => {
      const words = text.split(' ');
      let line = '';
      const lines = [];
      for(let n=0; n<words.length; n++) {
          const test = line + words[n] + ' ';
          if (ctx.measureText(test).width > maxWidth && n > 0) { lines.push(line); line = words[n] + ' '; }
          else { line = test; }
      }
      lines.push(line);
      let sy = y - ((lines.length-1)*lineHeight)/2;
      lines.forEach(l => { ctx.fillText(l, x, sy); sy+=lineHeight; });
  };

  const wrapTextBg = (ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number) => {
      const words = text.split(' ');
      let line = '';
      const lines = [];
      for(let n=0; n<words.length; n++) {
          const test = line + words[n] + ' ';
          if (ctx.measureText(test).width > maxWidth && n > 0) { lines.push(line); line = words[n] + ' '; }
          else { line = test; }
      }
      lines.push(line);
      let cy = y;
      lines.forEach(l => {
          const w = ctx.measureText(l).width;
          ctx.fillStyle = 'rgba(0,0,0,0.6)';
          ctx.fillRect(x - w/2 - 10, cy - 24, w + 20, 32);
          ctx.fillStyle = '#fbbf24';
          ctx.fillText(l, x, cy);
          cy += lineHeight;
      });
  };

  // 7. RECORDING ENGINE (Fixed)
  const getSupportedMimeType = () => {
    const types = [
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp8,opus',
        'video/webm',
        'video/mp4'
    ];
    for (const t of types) {
        if (MediaRecorder.isTypeSupported(t)) return t;
    }
    return ''; // Fallback to browser default
  };

  const handleDownload = async () => {
      if (!canvasRef.current || !destNodeRef.current || !audioCtxRef.current) {
          alert("Error: Browser does not support required features.");
          return;
      }

      try {
          // A. Stop everything & Lock UI
          stopAudio();
          if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
          setIsProcessing(true);

          // B. Wake up Audio Context (Critical)
          if (audioCtxRef.current.state === 'suspended') await audioCtxRef.current.resume();

          // C. Keep-Alive Oscillator (Fixes Silent Video bug)
          // Forces the audio track to be active from t=0
          const osc = audioCtxRef.current.createOscillator();
          const gain = audioCtxRef.current.createGain();
          gain.gain.value = 0.001; // Inaudible but active
          osc.connect(gain);
          gain.connect(destNodeRef.current);
          osc.start();

          // D. Setup Streams
          const canvasStream = canvasRef.current.captureStream(30); 
          const audioStream = destNodeRef.current.stream;
          const combined = new MediaStream([...canvasStream.getVideoTracks(), ...audioStream.getAudioTracks()]);

          // E. Init Recorder with Safe MimeType
          const mimeType = getSupportedMimeType();
          console.log("Recording with:", mimeType || "default");
          
          const options = mimeType ? { mimeType } : undefined;
          const recorder = new MediaRecorder(combined, options);
          recordedChunksRef.current = [];

          recorder.ondataavailable = (e) => {
              if (e.data && e.data.size > 0) recordedChunksRef.current.push(e.data);
          };

          recorder.onerror = (e: any) => {
              alert("Recorder Error: " + e.error);
              osc.stop();
              setIsProcessing(false);
          };

          recorder.onstop = () => {
              osc.stop(); 
              const blob = new Blob(recordedChunksRef.current, { type: mimeType || 'video/webm' });
              
              if (blob.size < 1000) {
                  alert("Download failed: File is empty. Please try Chrome/Edge.");
              } else {
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `${script.title.replace(/\s+/g, '_')}_Viralize.webm`;
                  document.body.appendChild(a);
                  a.click();
                  setTimeout(() => URL.revokeObjectURL(url), 2000);
              }
              setIsProcessing(false);
              setIsPlaying(false);
          };

          mediaRecorderRef.current = recorder;

          // F. Start
          recorder.start(1000); // Slice chunks every 1s
          
          // G. Wait a moment for audio track to initialize before starting visuals
          setTimeout(() => {
              startPlayback(true);
          }, 100);

      } catch (e: any) {
          alert("Start Error: " + e.message);
          setIsProcessing(false);
      }
  };

  const finishRecording = () => {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
          mediaRecorderRef.current.stop();
          stopAudio();
          if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      }
  };

  return (
    <div className="flex flex-col lg:flex-row gap-8 items-start justify-center max-w-7xl mx-auto">
        {/* PLAYER PREVIEW */}
        <div className="relative shrink-0 w-[320px] h-[640px] bg-black rounded-[3rem] border-[8px] border-gray-800 shadow-2xl overflow-hidden">
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-32 h-6 bg-black rounded-b-xl z-20" />
            
            {!assetsLoaded && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-900 text-center p-4 z-30">
                    <Loader2 className="animate-spin text-brand-500 mb-4" size={32} />
                    <p className="text-gray-400 text-sm animate-pulse">{loadingStatus}</p>
                </div>
            )}

            {isProcessing && (
                <div className="absolute inset-0 z-40 bg-black/80 backdrop-blur flex flex-col items-center justify-center text-center p-6">
                    <div className="w-16 h-16 border-4 border-red-500 border-t-transparent rounded-full animate-spin mb-4" />
                    <h3 className="text-xl font-bold text-white">Recording...</h3>
                    <p className="text-xs text-gray-400 mt-2">Wait for playback to finish.</p>
                </div>
            )}

            <canvas ref={canvasRef} width={540} height={960} className="w-full h-full object-cover" />
        </div>

        {/* CONTROLS */}
        <div className="flex-1 w-full space-y-6">
            <div className="bg-gray-800/50 border border-gray-700 rounded-2xl p-6 backdrop-blur-xl">
                <h3 className="text-2xl font-bold text-white mb-2">{script.title}</h3>
                <div className="flex gap-4 mb-6">
                    <button onClick={() => startPlayback(false)} disabled={!assetsLoaded || isProcessing} className="flex-1 bg-brand-600 hover:bg-brand-500 text-white py-3 rounded-xl font-bold flex items-center justify-center gap-2 transition disabled:opacity-50">
                        {isPlaying && !isProcessing ? <Pause size={20}/> : <Play size={20}/>}
                        {isPlaying && !isProcessing ? "Pause" : "Play Preview"}
                    </button>
                    <button onClick={() => setIsMuted(!isMuted)} className="p-3 bg-gray-700 rounded-xl hover:bg-gray-600">
                        {isMuted ? <VolumeX/> : <Volume2/>}
                    </button>
                </div>

                <button onClick={handleDownload} disabled={!assetsLoaded || isProcessing} className="w-full bg-white text-black py-4 rounded-xl font-black text-lg flex items-center justify-center gap-3 hover:bg-gray-200 transition shadow-lg disabled:opacity-50">
                    {isProcessing ? <Loader2 className="animate-spin text-red-600"/> : <Download className="text-brand-600"/>}
                    {isProcessing ? "Recording..." : "Download Video"}
                </button>
                <p className="text-xs text-gray-500 text-center mt-3">Recording runs in real-time. Do not close tab.</p>
            </div>
            
            <button onClick={onEditRequest} disabled={isProcessing} className="w-full text-center text-gray-400 hover:text-white text-sm underline">
                Create New Video
            </button>
        </div>
    </div>
  );
};
