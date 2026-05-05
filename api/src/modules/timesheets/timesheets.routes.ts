import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '@middleware/authenticate';
import { authorize } from '@middleware/authorize';
import { validate } from '@middleware/validate';
import { timesheetsController } from './timesheets.controller';
import {
  saveWeekSchema,
  summaryQuerySchema,
  timesheetDecisionSchema,
  timesheetIdParamSchema,
  weekQuerySchema,
} from './timesheets.schema';

const router = Router();

router.use(authenticate);

router.get('/projects', timesheetsController.projects);
router.get('/summary', validate({ query: summaryQuerySchema }), timesheetsController.summary);

router.get('/week', validate({ query: weekQuerySchema }), timesheetsController.getWeek);
router.put('/week', validate({ body: saveWeekSchema }), timesheetsController.saveWeek);

router.post(
  '/week/submit',
  validate({ body: z.object({ weekStart: z.string() }).strict() }),
  timesheetsController.submitWeek,
);

router.get(
  '/pending',
  authorize('MANAGER', 'HR_ADMIN', 'SUPER_ADMIN'),
  timesheetsController.pending,
);

router.post(
  '/:id/decision',
  authorize('MANAGER', 'HR_ADMIN', 'SUPER_ADMIN'),
  validate({ params: timesheetIdParamSchema, body: timesheetDecisionSchema }),
  timesheetsController.decide,
);

export const timesheetsRoutes = router;
