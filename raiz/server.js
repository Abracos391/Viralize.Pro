import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

const app = express();
const PORT = process.env.PORT || 3000;

// Resolve paths relative to THIS file
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DIST_DIR = path.join(__dirname, 'dist');

console.log(`Starting server...`);
console.log(`Current directory: ${process.cwd()}`);
console.log(`Serving static files from: ${DIST_DIR}`);

// Serve static files from the dist directory
app.use(express.static(DIST_DIR));

// Handle React routing, return all requests to index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(DIST_DIR, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});