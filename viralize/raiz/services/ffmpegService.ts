/// <reference lib="dom" />
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import { GeneratedScript } from '../types';

let ffmpeg: FFmpeg | null = null;

const formatSrtTime = (seconds: number): string => {
    const date = new Date(0);
    date.setMilliseconds(seconds * 1000);
    return date.toISOString().substr(11, 12).replace('.', ',');
};

const generateSubtitleFile = (script: GeneratedScript): string => {
    let srtContent = "";
    let currentTime = 0;
    script.scenes.forEach((scene, index) => {
        const start = formatSrtTime(currentTime);
        const end = formatSrtTime(currentTime + scene.duration);
        const cleanText = scene.overlayText.replace(/\n/g, ' ').trim();
        srtContent += `${index + 1}\n${start} --> ${end}\n${cleanText}\n\n`; 
        currentTime += scene.duration;
    });
    return srtContent;
};

export const loadFFmpeg = async (onLog?: (msg: string) => void): Promise<FFmpeg> => {
    if (ffmpeg) return ffmpeg;
    const instance = new FFmpeg();
    instance.on('log', ({ message }) => { if (onLog) onLog(message); });
    
    // Switch to jsDelivr and specific stable version 0.12.6 to avoid COEP issues with unpkg
    const baseURL = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd';
    
    try {
        await instance.load({
            coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
            wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
        });
        ffmpeg = instance;
        return instance;
    } catch (e: any) {
        console.error("FFmpeg Load Error:", e);
        throw new Error(`Video Engine Load Failed: ${e.message}`);
    }
};

// --- STANDARD WAV ENCODER (16-bit PCM) ---
export function audioBufferToWav(buffer: AudioBuffer): Uint8Array {
    const numChannels = 1; // Force MONO for stability and file size
    const sampleRate = buffer.sampleRate;
    const format = 1; // PCM
    const bitDepth = 16;
    
    const length = buffer.length * numChannels;
    const result = new Int16Array(length);
    
    // Mix down to mono if needed or just take channel 0
    const channel0 = buffer.getChannelData(0);
    
    for (let i = 0; i < buffer.length; i++) {
        const sample = Math.max(-1, Math.min(1, channel0[i]));
        // 16-bit signed conversion
        result[i] = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
    }

    const bufferData = new Uint8Array(result.buffer);
    const wavHeader = new ArrayBuffer(44);
    const view = new DataView(wavHeader);
    const writeString = (offset: number, string: string) => {
        for (let i = 0; i < string.length; i++) view.setUint8(offset + i, string.charCodeAt(i));
    };

    writeString(0, 'RIFF');
    view.setUint32(4, 36 + bufferData.byteLength, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, format, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numChannels * 2, true);
    view.setUint16(32, numChannels * 2, true);
    view.setUint16(34, bitDepth, true);
    writeString(36, 'data');
    view.setUint32(40, bufferData.byteLength, true);

    const wavBytes = new Uint8Array(wavHeader.byteLength + bufferData.byteLength);
    wavBytes.set(new Uint8Array(wavHeader), 0);
    wavBytes.set(bufferData, 44);

    return wavBytes;
}

export const renderVideoWithFFmpeg = async (
    script: GeneratedScript, 
    images: Record<number, Uint8Array>,
    masterAudioWav: Uint8Array,
    onProgress: (p: number, msg: string) => void
): Promise<Blob> => {
    // Force reset if needed
    if (ffmpeg) {
        try { 
            // Optional: ffmpeg.terminate() if supported, but usually keeping instance is faster
        } catch(e) {}
    }

    onProgress(5, "Loading Video Engine...");
    const ff = await loadFFmpeg((msg) => { 
        if (msg.includes('frame=')) onProgress(60, "Rendering frames..."); 
    });
    
    onProgress(15, "Loading Fonts...");
    try {
        await ff.writeFile('Roboto-Bold.ttf', await fetchFile('https://cdn.jsdelivr.net/npm/roboto-font@0.1.0/fonts/Roboto/roboto-bold.ttf'));
    } catch (e) {
        console.warn("Font load failed", e);
    }

    onProgress(25, "Writing Assets...");
    const imageFiles: string[] = [];

    await ff.writeFile('subtitles.srt', generateSubtitleFile(script));
    await ff.writeFile('master_audio.wav', masterAudioWav);

    for (let i = 0; i < script.scenes.length; i++) {
        const scene = script.scenes[i];
        const imgName = `img${i}.jpg`;
        // Ensure we have data
        if (!images[scene.id]) throw new Error(`Missing image data for scene ${i+1}`);
        await ff.writeFile(imgName, images[scene.id]);
        imageFiles.push(imgName);
    }

    onProgress(40, "Configuring Filters...");
    let inputArgs: string[] = [];
    let concatVideo = "";
    
    // Inputs (Images)
    script.scenes.forEach((s, i) => inputArgs.push('-loop', '1', '-t', s.duration.toString(), '-i', imageFiles[i]));
    
    // Input (Master Audio) is the LAST input
    const audioInputIndex = script.scenes.length;
    inputArgs.push('-i', 'master_audio.wav');

    const N = script.scenes.length;

    for (let i = 0; i < N; i++) {
        // Video processing chain
        concatVideo += `[${i}:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1[v${i}];`;
    }

    // Video Concat
    let filterComplex = concatVideo;
    let videoStreamMap = "";
    for(let i=0; i<N; i++) videoStreamMap += `[v${i}]`;
    filterComplex += `${videoStreamMap}concat=n=${N}:v=1:a=0[vbase];`;
    
    // Subtitles
    const style = `Fontname=Roboto,Fontsize=24,PrimaryColour=&H00FFFF,BackColour=&H80000000,BorderStyle=3,Outline=1,Shadow=0,Alignment=2,MarginV=100`;
    filterComplex += `[vbase]subtitles=subtitles.srt:fontsdir=/:force_style='${style}'[vfinal]`;

    onProgress(50, "Starting Render...");
    const outputName = "output.mp4";
    try { await ff.deleteFile(outputName); } catch (e) {}

    // Execute
    // Strategy: Map [vfinal] video stream and the direct audio stream from master_audio.wav
    await ff.exec([
        ...inputArgs,
        '-filter_complex', filterComplex,
        '-map', '[vfinal]',             // Video stream from filter
        '-map', `${audioInputIndex}:a`, // Audio stream directly from WAV input
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-shortest',                    // End when audio ends
        outputName
    ]);

    onProgress(90, "Finalizing...");
    const data = await ff.readFile(outputName);
    return new Blob([data], { type: 'video/mp4' });
};
