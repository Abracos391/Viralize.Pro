import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const app = express();
const PORT = process.env.PORT || 3000;

// Fix __dirname for ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Explicitly point to dist folder relative to THIS file
const DIST_DIR = path.join(__dirname, 'dist');

console.log("=== SERVER STARTUP ===");
console.log(`Working Directory: ${process.cwd()}`);
console.log(`Server Directory: ${__dirname}`);
console.log(`Serving Dist: ${DIST_DIR}`);

app.use(express.static(DIST_DIR));

app.get('*', (req, res) => {
  res.sendFile(path.join(DIST_DIR, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
