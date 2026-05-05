import { Router } from 'express';
import { authenticate } from '@middleware/authenticate';
import { authorize } from '@middleware/authorize';
import { validate } from '@middleware/validate';
import { leaveController } from './leave.controller';
import {
  balanceQuerySchema,
  calendarQuerySchema,
  cancelSchema,
  createLeaveRequestSchema,
  decisionSchema,
  leaveIdParamSchema,
  listLeaveQuerySchema,
} from './leave.schema';

const router = Router();

router.use(authenticate);

router.get('/types', leaveController.listTypes);
router.get('/balances', validate({ query: balanceQuerySchema }), leaveController.balances);
router.get('/calendar', validate({ query: calendarQuerySchema }), leaveController.calendar);

router.get('/requests', validate({ query: listLeaveQuerySchema }), leaveController.myRequests);
router.post(
  '/requests',
  validate({ body: createLeaveRequestSchema }),
  leaveController.submit,
);

router.get(
  '/team',
  authorize('MANAGER', 'HR_ADMIN', 'SUPER_ADMIN'),
  validate({ query: listLeaveQuerySchema }),
  leaveController.teamRequests,
);

router.get(
  '/approvals',
  authorize('MANAGER', 'HR_ADMIN', 'SUPER_ADMIN'),
  validate({ query: listLeaveQuerySchema }),
  leaveController.approvalQueue,
);

router.get('/requests/:id', validate({ params: leaveIdParamSchema }), leaveController.getOne);

// The state machine decides whether this is the MANAGER or HR stage; the route
// only needs to keep plain employees out.
router.post(
  '/requests/:id/decision',
  authorize('MANAGER', 'HR_ADMIN', 'SUPER_ADMIN'),
  validate({ params: leaveIdParamSchema, body: decisionSchema }),
  leaveController.decide,
);

router.post(
  '/requests/:id/cancel',
  validate({ params: leaveIdParamSchema, body: cancelSchema }),
  leaveController.cancel,
);

export const leaveRoutes = router;
