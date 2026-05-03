import { Router } from 'express';
import { authenticate } from '@middleware/authenticate';
import { documentUpload } from '@middleware/upload';
import { validate } from '@middleware/validate';
import { documentsController } from './documents.controller';
import { documentIdParamSchema, listDocumentsQuerySchema } from './documents.schema';

const router = Router();

router.use(authenticate);

router.get('/', validate({ query: listDocumentsQuerySchema }), documentsController.list);
router.post('/', documentUpload, documentsController.upload);

router.get(
  '/:id/download',
  validate({ params: documentIdParamSchema }),
  documentsController.download,
);

router.delete('/:id', validate({ params: documentIdParamSchema }), documentsController.remove);

export const documentsRoutes = router;
