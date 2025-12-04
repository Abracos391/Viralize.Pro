import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

// Robust path resolution for Render nested structures
const app = express();
const PORT = process.env.PORT || 3000;
const DIST_DIR = path.join(process.cwd(), 'dist');

// Serve static files from the dist directory
app.use(express.static(DIST_DIR));

// Handle React routing, return all requests to index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(DIST_DIR, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`Serving files from: ${DIST_DIR}`);
});
