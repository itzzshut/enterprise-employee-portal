import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import multer, { type FileFilterCallback } from 'multer';
import type { Request } from 'express';
import { env } from '@config/env';
import { ApiError } from '@utils/ApiError';

fs.mkdirSync(path.join(env.uploadDir, 'avatars'), { recursive: true });
fs.mkdirSync(path.join(env.uploadDir, 'documents'), { recursive: true });

/**
 * Filenames are always regenerated as `<uuid><ext>`: the client-supplied name
 * is stored in the database for display only. That removes path traversal and
 * collision handling from the storage layer entirely.
 */
function diskStorage(subdirectory: string): multer.StorageEngine {
  return multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, path.join(env.uploadDir, subdirectory)),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase().slice(0, 10);
      cb(null, `${randomUUID()}${ext}`);
    },
  });
}

function mimeFilter(allowed: string[]) {
  return (_req: Request, file: Express.Multer.File, cb: FileFilterCallback): void => {
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
      return;
    }
    cb(ApiError.badRequest(`Unsupported file type ${file.mimetype}. Allowed: ${allowed.join(', ')}`));
  };
}

export const avatarUpload = multer({
  storage: diskStorage('avatars'),
  limits: { fileSize: env.maxUploadBytes, files: 1 },
  fileFilter: mimeFilter(['image/png', 'image/jpeg', 'image/webp']),
}).single('avatar');

export const documentUpload = multer({
  storage: diskStorage('documents'),
  limits: { fileSize: env.maxUploadBytes, files: 1 },
  fileFilter: mimeFilter([
    'application/pdf',
    'image/png',
    'image/jpeg',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ]),
}).single('file');
