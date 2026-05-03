import type { Request, Response } from 'express';
import { currentUser } from '@middleware/authenticate';
import { ApiError } from '@utils/ApiError';
import { asyncHandler } from '@utils/asyncHandler';
import { uploadDocumentSchema } from './documents.schema';
import { documentsService } from './documents.service';

export const documentsController = {
  list: asyncHandler(async (req: Request, res: Response) => {
    const page = await documentsService.list(currentUser(req), req.query as never);
    res.status(200).json(page);
  }),

  upload: asyncHandler(async (req: Request, res: Response) => {
    if (!req.file) throw ApiError.badRequest('No file was provided');
    // Multipart text fields are validated here rather than by the `validate`
    // middleware, because multer has to parse the body before the fields exist.
    const input = uploadDocumentSchema.parse(req.body);
    const document = await documentsService.upload(currentUser(req), input, req.file);
    res.status(201).json({ document });
  }),

  download: asyncHandler(async (req: Request, res: Response) => {
    const file = await documentsService.resolveForDownload(currentUser(req), Number(req.params.id));
    res.type(file.mimeType);
    res.download(file.absolutePath, file.filename);
  }),

  remove: asyncHandler(async (req: Request, res: Response) => {
    await documentsService.remove(currentUser(req), Number(req.params.id));
    res.status(204).send();
  }),
};
