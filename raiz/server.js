import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegPath from 'ffmpeg-static';
import cors from 'cors';
import multer from 'multer';

// 1. CONFIGURAÇÃO DO SERVIDOR
const app = express();
const PORT = process.env.PORT || 3000;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// CONFIGURAR ENGINE
if (ffmpegPath) {
    ffmpeg.setFfmpegPath(ffmpegPath);
    console.log(`[System] Engine de Vídeo Pronto: ${ffmpegPath}`);
}

app.use(cors());
app.use(express.json()); // JSON apenas para metadados pequenos

// 2. SISTEMA DE ARQUIVOS (Staging Area)
let DIST_DIR = path.join(__dirname, 'dist');
if (!fs.existsSync(DIST_DIR)) DIST_DIR = path.join(process.cwd(), 'dist');

const UPLOADS_DIR = path.join(process.cwd(), 'temp_uploads');
const OUTPUT_DIR = path.join(process.cwd(), 'public_videos');

if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

// Configuração do Multer (Upload Manager)
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        // Cria uma pasta única por Job para não misturar arquivos
        const jobId = req.body.jobId || 'unknown_job';
        const jobDir = path.join(UPLOADS_DIR, jobId);
        if (!fs.existsSync(jobDir)) fs.mkdirSync(jobDir, { recursive: true });
        cb(null, jobDir);
    },
    filename: (req, file, cb) => {
        // Mantém o nome original que o frontend enviou (ex: frame_0.jpg, audio.wav)
        cb(null, file.originalname);
    }
});
const upload = multer({ storage: storage });

// Servir arquivos
app.use(express.static(DIST_DIR));
app.use('/videos', express.static(OUTPUT_DIR));

// 3. API: ROTA DE UPLOAD E RENDERIZAÇÃO
// Recebe todos os arquivos de uma vez via FormData
app.post('/api/render-job', upload.any(), async (req, res) => {
    const { jobId, scriptJson } = req.body;
    
    if (!jobId || !req.files || req.files.length === 0) {
        return res.status(400).json({ success: false, error: "Nenhum arquivo recebido." });
    }

    console.log(`[Job ${jobId}] 📦 Arquivos recebidos no servidor (Staging). Iniciando mixagem...`);

    const jobDir = path.join(UPLOADS_DIR, jobId);
    const outputFileName = `video_${jobId}.mp4`;
    const outputPath = path.join(OUTPUT_DIR, outputFileName);
    
    try {
        const script = JSON.parse(scriptJson);
        const imagesCount = script.scenes.length;

        // A. Preparar Lista de Concatenação para FFmpeg
        const listPath = path.join(jobDir, 'inputs.txt');
        let fileContent = '';
        
        // Ordenar e listar imagens
        for (let i = 0; i < imagesCount; i++) {
            const imgName = `frame_${i}.jpg`;
            const imgPath = path.join(jobDir, imgName);
            
            // Verificação de segurança
            if (!fs.existsSync(imgPath)) throw new Error(`Frame ${i} faltando no upload.`);

            const duration = script.scenes[i].duration;
            fileContent += `file '${imgPath}'\n`;
            fileContent += `duration ${duration}\n`;
        }
        // Bugfix FFmpeg: Repetir último frame
        fileContent += `file '${path.join(jobDir, `frame_${imagesCount-1}.jpg`)}'\n`;
        
        fs.writeFileSync(listPath, fileContent);
        
        // B. Localizar Áudio
        const audioPath = path.join(jobDir, 'audio.wav');
        if (!fs.existsSync(audioPath)) throw new Error("Arquivo de áudio mestre faltando.");

        // C. Executar FFmpeg (Mixagem)
        await new Promise((resolve, reject) => {
            ffmpeg()
                .input(listPath)
                .inputOptions(['-f', 'concat', '-safe', '0'])
                .input(audioPath)
                .outputOptions([
                    '-map 0:v',           // Vídeo das imagens
                    '-map 1:a',           // Áudio do WAV
                    '-c:v libx264',       // Codec H.264
                    '-pix_fmt yuv420p',   // Pixel format compatível
                    '-vf scale=1080:1920',// Resolução Vertical
                    '-c:a aac',           // Áudio AAC
                    '-b:a 192k',          // Bitrate
                    '-ac 2',              // Estéreo
                    '-shortest',          // Cortar excessos
                    '-r 30'               // 30 FPS
                ])
                .save(outputPath)
                .on('end', resolve)
                .on('error', reject);
        });

        console.log(`[Job ${jobId}] ✅ Vídeo Gerado: ${outputFileName}`);

        // Limpeza (Opcional - pode remover depois)
        // fs.rmSync(jobDir, { recursive: true, force: true });

        res.json({ success: true, url: `/videos/${outputFileName}` });

    } catch (error) {
        console.error(`[Job ${jobId}] ❌ Falha:`, error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Fallback
app.get('*', (req, res) => {
    const index = path.join(DIST_DIR, 'index.html');
    if (fs.existsSync(index)) res.sendFile(index);
    else res.send("Server Online. Building Frontend...");
});

app.listen(PORT, () => {
    console.log(`🚀 SERVIDOR DE RENDERIZAÇÃO ATIVO NA PORTA ${PORT}`);
    console.log(`📂 Staging Dir: ${UPLOADS_DIR}`);
});
