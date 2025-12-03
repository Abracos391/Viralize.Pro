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
    
    // Stable Version 0.12.6
    const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd';
    
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

export const renderVideoWithFFmpeg = async (
    script: GeneratedScript, 
    images: Record<number, Uint8Array>,
    masterAudioWav: Uint8Array,
    onProgress: (p: number, msg: string) => void
): Promise<Blob> => {
    
    onProgress(10, "Loading Video Engine...");
    const ff = await loadFFmpeg((msg) => { 
        if (msg.includes('frame=')) onProgress(70, "Rendering Video..."); 
    });
    
    // 1. Setup Fonts
    onProgress(20, "Loading Fonts...");
    try {
        await ff.writeFile('Roboto-Bold.ttf', await fetchFile('https://cdn.jsdelivr.net/npm/roboto-font@0.1.0/fonts/Roboto/roboto-bold.ttf'));
    } catch (e) {}

    // 2. Write Assets
    onProgress(30, "Writing Assets...");
    const imageFiles: string[] = [];

    await ff.writeFile('subtitles.srt', generateSubtitleFile(script));
    await ff.writeFile('audio.wav', masterAudioWav);

    for (let i = 0; i < script.scenes.length; i++) {
        const scene = script.scenes[i];
        const imgName = `img${i}.jpg`;
        await ff.writeFile(imgName, images[scene.id]);
        imageFiles.push(imgName);
    }

    // 3. STEP 1: GENERATE VIDEO ONLY (SILENT)
    // This isolates the visual rendering from audio issues.
    onProgress(40, "Phase 1: Generating Visuals...");
    
    let inputArgs: string[] = [];
    script.scenes.forEach((s, i) => {
        inputArgs.push('-loop', '1', '-t', s.duration.toString(), '-i', imageFiles[i]);
    });

    let filterComplex = "";
    // Simple concat of video streams
    for(let i=0; i<script.scenes.length; i++) {
        filterComplex += `[${i}:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920[v${i}];`;
    }
    
    let concatStr = "";
    for(let i=0; i<script.scenes.length; i++) concatStr += `[v${i}]`;
    
    filterComplex += `${concatStr}concat=n=${script.scenes.length}:v=1:a=0[vbase];`;
    
    // Add subtitles to video
    const style = `Fontname=Roboto,Fontsize=24,PrimaryColour=&H00FFFF,BackColour=&H80000000,BorderStyle=3,Outline=1,Shadow=0,Alignment=2,MarginV=100`;
    filterComplex += `[vbase]subtitles=subtitles.srt:fontsdir=/:force_style='${style}'[vfinal]`;

    try { await ff.deleteFile("temp_video.mp4"); } catch (e) {}

    await ff.exec([
        ...inputArgs,
        '-filter_complex', filterComplex,
        '-map', '[vfinal]',
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-pix_fmt', 'yuv420p',
        'temp_video.mp4'
    ]);

    // 4. STEP 2: MERGE AUDIO (MUXING)
    // Taking the silent video and adding the WAV file
    onProgress(80, "Phase 2: Adding Audio...");
    
    try { await ff.deleteFile("output.mp4"); } catch (e) {}

    await ff.exec([
        '-i', 'temp_video.mp4',
        '-i', 'audio.wav',
        '-c:v', 'copy', // Copy video stream (super fast, no re-encode)
        '-c:a', 'aac',  // Encode audio
        '-map', '0:v',
        '-map', '1:a',
        '-shortest',
        'output.mp4'
    ]);

    onProgress(95, "Finalizing...");
    const data = await ff.readFile('output.mp4');
    
    // Cleanup
    try {
        await ff.deleteFile("temp_video.mp4");
        await ff.deleteFile("audio.wav");
        imageFiles.forEach(async f => { try { await ff.deleteFile(f) } catch(e){} });
    } catch(e) {}

    return new Blob([data], { type: 'video/mp4' });
};

// --- HELPER: WAV HEADER GENERATOR ---
export function audioBufferToWav(buffer: AudioBuffer): Uint8Array {
    const numChannels = 1; 
    const sampleRate = buffer.sampleRate;
    const format = 1; 
    const bitDepth = 16;
    
    const length = buffer.length * numChannels;
    const result = new Int16Array(length);
    const channel0 = buffer.getChannelData(0);
    
    for (let i = 0; i < buffer.length; i++) {
        const sample = Math.max(-1, Math.min(1, channel0[i]));
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
