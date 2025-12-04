/// <reference lib="dom" />
import React, { useState, useEffect, useRef } from 'react';
import { GeneratedScript } from '../types';
import { Play, Pause, Volume2, VolumeX, Download, Loader2, RefreshCw } from 'lucide-react';
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
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  
  // Refs
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);
  
  // Assets
  const imageCache = useRef<Record<number, HTMLImageElement>>({});
  const audioCtxRef = useRef<AudioContext | null>(null);
  const masterAudioBufferRef = useRef<AudioBuffer | null>(null);
  const masterSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);

  // Recorder
  const destNodeRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  // 1. INITIALIZE AUDIO ENGINE
  useEffect(() => {
      const AudioContextClass = (window as any).AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioContextClass();
      audioCtxRef.current = ctx;

      const gain = ctx.createGain();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 32;
      
      const dest = ctx.createMediaStreamDestination(); // For Recording

      // Routing: Source -> Gain -> Analyser -> Destination (Recorder) AND Speakers
      gain.connect(analyser);
      analyser.connect(ctx.destination); // To Speakers
      analyser.connect(dest);            // To Recorder

      gainNodeRef.current = gain;
      analyserRef.current = analyser;
      destNodeRef.current = dest;

      return () => { ctx.close(); };
  }, []);

  useEffect(() => {
      if (gainNodeRef.current) gainNodeRef.current.gain.value = isMuted ? 0 : 1;
  }, [isMuted]);

  // 2. HELPER: CREATE MASTER AUDIO TRACK (STITCHING)
  const createMasterTrack = async (clips: Record<number, AudioBuffer>) => {
      if (!audioCtxRef.current) return null;
      const ctx = audioCtxRef.current;
      
      // Calculate total duration based on script
      const totalDuration = script.scenes.reduce((acc, s) => acc + s.duration, 0);
      const sampleRate = ctx.sampleRate;
      const length = Math.ceil(totalDuration * sampleRate);
      
      // Create empty master buffer
      const masterBuffer = ctx.createBuffer(1, length, sampleRate); // Mono is safer
      const channelData = masterBuffer.getChannelData(0);

      // Mix clips into master
      let offsetTime = 0;
      script.scenes.forEach((scene) => {
          const clip = clips[scene.id];
          if (clip) {
              const clipData = clip.getChannelData(0);
              const startSample = Math.floor(offsetTime * sampleRate);
              // Copy clip data, respecting boundaries
              for (let i = 0; i < clipData.length; i++) {
                  if (startSample + i < length) {
                      channelData[startSample + i] = clipData[i];
                  }
              }
          }
          offsetTime += scene.duration;
      });

      return masterBuffer;
  };

  // 3. LOAD ASSETS
  useEffect(() => {
      let mounted = true;
      const load = async () => {
          setIsReady(false);
          setLoadingStatus("Loading Assets...");
          stopPlayback();

          const tempImgCache: Record<number, HTMLImageElement> = {};
          const tempAudioClips: Record<number, AudioBuffer> = {};

          // A. Load Images
          const imgPromises = script.scenes.map(async (s) => {
              try {
                  const url = await getStockImage(s.imageKeyword);
                  const safeUrl = url.includes('?') ? `${url}&t=${Date.now()}` : `${url}?t=${Date.now()}`;
                  const img = new Image();
                  img.crossOrigin = "anonymous";
                  img.src = safeUrl;
                  await new Promise(r => { img.onload = r; img.onerror = r; });
                  tempImgCache[s.id] = img;
              } catch(e) {}
          });

          // B. Load Audio Clips
          const audioPromises = script.scenes.map(async (s) => {
              if (!audioCtxRef.current) return;
              try {
                  setLoadingStatus(`Synthesizing Voice for Scene ${s.id}...`);
                  const b64 = await generateNarration(s.narration);
                  if (b64 === "SILENCE") return;
                  
                  const bin = atob(b64);
                  const len = bin.length;
                  const bytes = new Uint8Array(len);
                  for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
                  
                  const buf = await audioCtxRef.current.decodeAudioData(bytes.buffer);
                  tempAudioClips[s.id] = buf;
              } catch (e) { console.warn("Audio fail scene " + s.id); }
          });

          await Promise.all([...imgPromises, ...audioPromises]);

          // C. Stitch Audio
          setLoadingStatus("Mastering Audio...");
          const master = await createMasterTrack(tempAudioClips);
          masterAudioBufferRef.current = master;
          imageCache.current = tempImgCache;

          if (mounted) {
              setLoadingStatus("Ready");
              setIsReady(true);
              setTimeout(() => drawFrame(0), 100);
          }
      };
      load();
      return () => { mounted = false; stopPlayback(); };
  }, [script]);

  // 4. PLAYBACK ENGINE
  const stopPlayback = () => {
      if (masterSourceRef.current) {
          try { masterSourceRef.current.stop(); } catch(e){}
          masterSourceRef.current = null;
      }
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      setIsPlaying(false);
      setIsProcessing(false);
  };

  const startPlayback = async (recording = false) => {
      if (!audioCtxRef.current || !gainNodeRef.current || !masterAudioBufferRef.current) return;
      if (audioCtxRef.current.state === 'suspended') await audioCtxRef.current.resume();

      stopPlayback();
      setIsPlaying(true);
      if (recording) setIsProcessing(true);

      // Play Master Track
      const source = audioCtxRef.current.createBufferSource();
      source.buffer = masterAudioBufferRef.current;
      source.connect(gainNodeRef.current);
      source.start(0);
      masterSourceRef.current = source;

      startTimeRef.current = Date.now();
      
      const totalDuration = script.scenes.reduce((acc, s) => acc + s.duration, 0);

      const loop = () => {
          const now = Date.now();
          const elapsed = (now - startTimeRef.current) / 1000; // in seconds
          
          if (elapsed >= totalDuration) {
              stopPlayback();
              if (recording && mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
                  mediaRecorderRef.current.stop();
              }
              return;
          }

          setProgress(elapsed / totalDuration);
          drawFrame(elapsed);
          
          animationFrameRef.current = requestAnimationFrame(loop);
      };
      animationFrameRef.current = requestAnimationFrame(loop);
  };

  // 5. RENDERER (CANVAS)
  const drawFrame = (elapsed: number) => {
      const cvs = canvasRef.current;
      const ctx = cvs?.getContext('2d');
      if (!cvs || !ctx) return;

      // Find active scene
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

      // Draw Background
      ctx.fillStyle = 'black';
      ctx.fillRect(0,0,cvs.width, cvs.height);

      // Draw Image (Ken Burns)
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
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(0,0,cvs.width, cvs.height);

      // Text
      const cx = cvs.width / 2;
      const cy = cvs.height / 2;

      // Title
      ctx.save();
      ctx.fillStyle = "white";
      ctx.shadowColor = "black";
      ctx.shadowBlur = 15;
      ctx.textAlign = "center";
      ctx.font = "900 52px Inter, sans-serif";
      wrapText(ctx, activeScene.overlayText.toUpperCase(), cx, cy, cvs.width * 0.85, 65);
      ctx.restore();

      // Subtitles
      ctx.save();
      ctx.font = 'bold 28px Inter, sans-serif';
      ctx.textAlign = 'center';
      wrapTextBg(ctx, activeScene.narration, cx, cvs.height - 200, cvs.width * 0.9, 40);
      ctx.restore();
      
      // Recording Dot
      if (isProcessing) {
          ctx.fillStyle = 'red';
          ctx.beginPath();
          ctx.arc(30, 30, 10, 0, Math.PI*2);
          ctx.fill();
      }
  };

  // Text Helpers
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

  const wrapTextBg = (ctx: CanvasRenderingContext2D, text: string, x: number, y: number, mw: number, lh: number) => {
      const words = text.split(' ');
      let line = '', lines = [];
      for(let w of words) {
          let test = line + w + ' ';
          if (ctx.measureText(test).width > mw && line !== '') { lines.push(line); line = w + ' '; }
          else line = test;
      }
      lines.push(line);
      let cy = y;
      lines.forEach(l => {
          const w = ctx.measureText(l).width;
          ctx.fillStyle = 'rgba(0,0,0,0.6)';
          ctx.fillRect(x - w/2 - 10, cy - 24, w + 20, 32);
          ctx.fillStyle = '#fbbf24';
          ctx.fillText(l, x, cy);
          cy += lh;
      });
  };

  // 6. DOWNLOAD HANDLER (MEDIA RECORDER)
  const handleDownload = async () => {
      if (!canvasRef.current || !audioCtxRef.current || !destNodeRef.current) return;
      
      // A. Setup Streams
      const canvasStream = canvasRef.current.captureStream(30);
      const audioStream = destNodeRef.current.stream;
      
      // B. Keep-Alive Oscillator (Fixes Silent Video Bug)
      const osc = audioCtxRef.current.createOscillator();
      const oscGain = audioCtxRef.current.createGain();
      oscGain.gain.value = 0.001; // Tiny signal to keep track active
      osc.connect(oscGain);
      oscGain.connect(destNodeRef.current);
      osc.start();

      const combined = new MediaStream([...canvasStream.getVideoTracks(), ...audioStream.getAudioTracks()]);

      // C. Detect Codec
      let mimeType = 'video/webm';
      if (MediaRecorder.isTypeSupported('video/webm; codecs=vp9')) mimeType = 'video/webm; codecs=vp9';
      else if (MediaRecorder.isTypeSupported('video/mp4')) mimeType = 'video/mp4';

      // D. Record
      chunksRef.current = [];
      const recorder = new MediaRecorder(combined, { mimeType });
      
      recorder.ondataavailable = (e) => {
          if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
          osc.stop();
          const blob = new Blob(chunksRef.current, { type: mimeType });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `${script.title}_viral.webm`;
          document.body.appendChild(a);
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 2000);
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      startPlayback(true);
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
            
            {isProcessing && (
                <div className="absolute inset-0 z-40 bg-black/80 flex flex-col items-center justify-center">
                    <div className="w-16 h-16 border-4 border-red-500 border-t-transparent rounded-full animate-spin mb-4" />
                    <p className="text-white font-bold">Recording Video...</p>
                    <p className="text-xs text-gray-400">Please wait</p>
                </div>
            )}

            <canvas ref={canvasRef} width={540} height={960} className="w-full h-full object-cover" />
        </div>

        {/* CONTROLS */}
        <div className="flex-1 w-full max-w-md space-y-6">
            <div className="bg-gray-800/60 border border-gray-700 rounded-2xl p-6 backdrop-blur-xl">
                <h3 className="text-2xl font-bold text-white mb-2">{script.title}</h3>
                <div className="flex gap-4 mb-4">
                    <button onClick={() => isPlaying ? stopPlayback() : startPlayback(false)} disabled={!isReady || isProcessing} className="flex-1 bg-brand-600 hover:bg-brand-500 text-white py-3 rounded-xl font-bold flex items-center justify-center gap-2 transition disabled:opacity-50">
                        {isPlaying ? <Pause size={20}/> : <Play size={20}/>}
                        {isPlaying ? "Pause" : "Preview"}
                    </button>
                    <button onClick={() => setIsMuted(!isMuted)} className="p-3 bg-gray-700 rounded-xl hover:bg-gray-600">
                        {isMuted ? <VolumeX/> : <Volume2/>}
                    </button>
                </div>

                <button 
                    onClick={handleDownload}
                    disabled={!isReady || isProcessing}
                    className="w-full bg-white text-black py-4 rounded-xl font-black text-lg flex items-center justify-center gap-3 hover:bg-gray-200 transition shadow-lg disabled:opacity-50"
                >
                    {isProcessing ? <Loader2 className="animate-spin text-red-600"/> : <Download className="text-brand-600"/>}
                    {isProcessing ? "Recording..." : "Download Video"}
                </button>
            </div>
            <button onClick={onEditRequest} disabled={isProcessing} className="w-full text-center text-gray-400 underline hover:text-white text-sm">
                Back to Editor
            </button>
        </div>
    </div>
  );
};
