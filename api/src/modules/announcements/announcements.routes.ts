import { Router } from 'express';
import { authenticate } from '@middleware/authenticate';
import { authorize } from '@middleware/authorize';
import { validate } from '@middleware/validate';
import { announcementsController } from './announcements.controller';
import {
  announcementIdParamSchema,
  createAnnouncementSchema,
  listAnnouncementsQuerySchema,
} from './announcements.schema';

const router = Router();

router.use(authenticate);

router.get('/', validate({ query: listAnnouncementsQuerySchema }), announcementsController.feed);
router.get('/unread-count', announcementsController.unreadCount);
router.get('/:id', validate({ params: announcementIdParamSchema }), announcementsController.getOne);

router.post(
  '/:id/read',
  validate({ params: announcementIdParamSchema }),
  announcementsController.markRead,
);

router.post(
  '/',
  authorize('HR_ADMIN', 'SUPER_ADMIN'),
  validate({ body: createAnnouncementSchema }),
  announcementsController.create,
);

router.get(
  '/:id/receipts',
  authorize('HR_ADMIN', 'SUPER_ADMIN'),
  validate({ params: announcementIdParamSchema }),
  announcementsController.receipts,
);

export const announcementsRoutes = router;
