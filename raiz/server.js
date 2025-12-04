import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const app = express();
const PORT = process.env.PORT || 3000;

// Fix __dirname for ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Robust Dist Folder Detection
let DIST_DIR = path.join(__dirname, 'dist');

// Fallback: If 'dist' is not found in current dir, check parent (sometimes happens in nested repos)
if (!fs.existsSync(DIST_DIR)) {
    const parentDist = path.join(__dirname, '..', 'dist');
    if (fs.existsSync(parentDist)) {
        DIST_DIR = parentDist;
    }
}

console.log("=== SERVER STARTUP ===");
console.log(`Node Version: ${process.version}`);
console.log(`Serving Static Files From: ${DIST_DIR}`);

if (!fs.existsSync(DIST_DIR)) {
    console.error("CRITICAL: 'dist' folder not found. Build may have failed.");
}

app.use(express.static(DIST_DIR));

// SPA Fallback: Serve index.html for any unknown route
app.get('*', (req, res) => {
  const indexPath = path.join(DIST_DIR, 'index.html');
  if (fs.existsSync(indexPath)) {
      res.sendFile(indexPath);
  } else {
      res.status(404).send("Application build not found. Please check deployment logs.");
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
