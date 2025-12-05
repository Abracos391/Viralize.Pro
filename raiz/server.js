import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';
import bodyParser from 'body-parser';
import cors from 'cors';

// CONFIGURAÇÃO DO AMBIENTE
const app = express();
const PORT = process.env.PORT || 3000;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// CONFIGURAR FFMPEG (O Segredo do Manus)
// Usa o binário estático baixado pelo npm, funciona no Render/Linux/Windows
if (ffmpegPath) {
    ffmpeg.setFfmpegPath(ffmpegPath);
    console.log(`FFmpeg binário configurado: ${ffmpegPath}`);
} else {
    console.error("ERRO CRÍTICO: ffmpeg-static não encontrado.");
}

// MIDDLEWARE
app.use(cors());
// Aumentar limites para aceitar upload de imagens HD + Áudio
app.use(bodyParser.json({ limit: '200mb' })); 
app.use(bodyParser.urlencoded({ extended: true, limit: '200mb' }));

// DIRETÓRIOS
let DIST_DIR = path.join(__dirname, 'dist');
// Fallback para encontrar a pasta dist
if (!fs.existsSync(DIST_DIR)) {
    DIST_DIR = path.join(process.cwd(), 'dist');
}

const TEMP_DIR = path.join(process.cwd(), 'temp_render');
const OUTPUT_DIR = path.join(process.cwd(), 'public_videos');

if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

// SERVIR ARQUIVOS ESTÁTICOS (Frontend)
app.use(express.static(DIST_DIR));

// ROTA PARA SERVIR VÍDEOS GERADOS
app.use('/videos', express.static(OUTPUT_DIR));

// --- API DE RENDERIZAÇÃO (Server-Side Mixing) ---
app.post('/api/render', async (req, res) => {
    const { script, audioBase64, imagesBase64 } = req.body;
    const jobId = `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const jobDir = path.join(TEMP_DIR, jobId);
    
    console.log(`[Job ${jobId}] Iniciando renderização... Cenas: ${script.scenes.length}`);

    try {
        if (!fs.existsSync(jobDir)) fs.mkdirSync(jobDir);

        // 1. SALVAR ÁUDIO (Master Track)
        const audioPath = path.join(jobDir, 'audio.wav');
        // Remover cabeçalho data URI se existir
        const audioData = audioBase64.split(';base64,').pop();
        fs.writeFileSync(audioPath, Buffer.from(audioData, 'base64'));
        console.log(`[Job ${jobId}] Áudio mestre salvo.`);

        // 2. SALVAR IMAGENS (Frames visuais com texto já queimado pelo frontend)
        const imageListPath = path.join(jobDir, 'images.txt');
        let fileContent = '';
        
        for (let i = 0; i < script.scenes.length; i++) {
            const scene = script.scenes[i];
            const imgData = imagesBase64[i].split(';base64,').pop();
            const imgPath = path.join(jobDir, `frame_${i}.jpg`);
            
            fs.writeFileSync(imgPath, Buffer.from(imgData, 'base64'));
            
            // Formato Concat do FFmpeg
            // file 'caminho'
            // duration segundos
            fileContent += `file '${imgPath}'\n`;
            fileContent += `duration ${scene.duration}\n`;
        }
        
        // Repetir o último frame para fechar o stream corretamente
        const lastImgPath = path.join(jobDir, `frame_${script.scenes.length - 1}.jpg`);
        fileContent += `file '${lastImgPath}'\n`;

        fs.writeFileSync(imageListPath, fileContent);
        console.log(`[Job ${jobId}] Frames visuais salvos.`);

        // 3. EXECUTAR FFMPEG (Mixagem Final)
        const outputFileName = `video_${jobId}.mp4`;
        const outputPath = path.join(OUTPUT_DIR, outputFileName);
        
        await new Promise((resolve, reject) => {
            ffmpeg()
                .input(imageListPath)
                .inputOptions(['-f', 'concat', '-safe', '0'])
                .input(audioPath)
                .outputOptions([
                    '-c:v libx264',       // Codec de vídeo universal
                    '-pix_fmt yuv420p',   // Compatibilidade máxima (Windows/QuickTime)
                    '-vf scale=1080:1920', // Garantir resolução vertical
                    '-c:a aac',           // Codec de áudio padrão MP4
                    '-b:a 192k',          // Qualidade de áudio
                    '-shortest',          // Cortar vídeo quando o áudio acabar (ou vice-versa)
                    '-r 30'               // 30 FPS fixo
                ])
                .save(outputPath)
                .on('start', (cmd) => console.log(`[Job ${jobId}] FFmpeg Cmd: ${cmd}`))
                .on('end', () => resolve())
                .on('error', (err) => reject(err));
        });

        console.log(`[Job ${jobId}] Renderização concluída!`);
        
        // Limpeza síncrona dos arquivos temporários para economizar espaço
        try {
            fs.rmSync(jobDir, { recursive: true, force: true });
        } catch (e) { console.warn("Erro ao limpar temp:", e); }

        // Retornar URL pública
        res.json({ success: true, url: `/videos/${outputFileName}` });

    } catch (error) {
        console.error(`[Job ${jobId}] FALHA FATAL:`, error);
        res.status(500).json({ success: false, error: error.message || "Erro interno de renderização" });
    }
});

// FALLBACK ROUTE
app.get('*', (req, res) => {
  const indexPath = path.join(DIST_DIR, 'index.html');
  if (fs.existsSync(indexPath)) res.sendFile(indexPath);
  else res.send("Servidor rodando. Aguardando build do frontend.");
});

app.listen(PORT, () => {
  console.log(`Servidor Viralize Pro (API + Frontend) rodando na porta ${PORT}`);
  console.log(`Diretório de trabalho: ${process.cwd()}`);
});
