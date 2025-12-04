import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const app = express();
const PORT = process.env.PORT || 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Robust Dist Folder Detection for Render
let DIST_DIR = path.join(__dirname, 'dist');
if (!fs.existsSync(DIST_DIR)) {
    // Try parent directory if we are inside a subfolder
    const parentDist = path.join(__dirname, '..', 'dist');
    if (fs.existsSync(parentDist)) {
        DIST_DIR = parentDist;
    }
}

console.log(`Serving Static Files From: ${DIST_DIR}`);

if (!fs.existsSync(DIST_DIR)) {
    console.error("CRITICAL: 'dist' folder not found. Build likely failed.");
}

app.use(express.static(DIST_DIR));

app.get('*', (req, res) => {
  const indexPath = path.join(DIST_DIR, 'index.html');
  if (fs.existsSync(indexPath)) {
      res.sendFile(indexPath);
  } else {
      res.status(404).send("Application build not found.");
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
