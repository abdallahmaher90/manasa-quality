import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const svgPath = path.join(__dirname, '../public/logo.svg');
const icon192Path = path.join(__dirname, '../public/icon-192.png');
const icon512Path = path.join(__dirname, '../public/icon-512.png');

async function generate() {
  try {
    const svgBuffer = fs.readFileSync(svgPath);
    
    // Generate 192x192
    await sharp(svgBuffer)
      .resize(192, 192, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
      .png()
      .toFile(icon192Path);
    console.log('Created icon-192.png');

    // Generate 512x512
    await sharp(svgBuffer)
      .resize(512, 512, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
      .png()
      .toFile(icon512Path);
    console.log('Created icon-512.png');
    
  } catch (err) {
    console.error('Error generating icons:', err);
  }
}

generate();
