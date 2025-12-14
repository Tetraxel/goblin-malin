import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const PROJECT_ROOT = path.join(__dirname, '..');
export const CACHE_DIR = path.join(PROJECT_ROOT, 'cache');
export const DOWNLOAD_DIR = path.join(PROJECT_ROOT, 'downloads');
