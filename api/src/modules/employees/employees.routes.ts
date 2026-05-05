import { Router } from 'express';
import { authenticate } from '@middleware/authenticate';
import { authorize } from '@middleware/authorize';
import { avatarUpload } from '@middleware/upload';
import { validate } from '@middleware/validate';
import { employeesController } from './employees.controller';
import {
  createEmployeeSchema,
  directoryQuerySchema,
  employeeIdParamSchema,
  updateEmployeeSchema,
  updateSelfProfileSchema,
} from './employees.schema';

const router = Router();

// Every employee route requires a session; RBAC is applied per-route below.
router.use(authenticate);

router.get('/', validate({ query: directoryQuerySchema }), employeesController.directory);

router.get('/me', employeesController.me);
router.patch('/me', validate({ body: updateSelfProfileSchema }), employeesController.updateMe);

router.get('/me/team', authorize('MANAGER', 'HR_ADMIN', 'SUPER_ADMIN'), employeesController.myTeam);

router.get('/:id', validate({ params: employeeIdParamSchema }), employeesController.getOne);

router.get(
  '/:id/reports',
  authorize('MANAGER', 'HR_ADMIN', 'SUPER_ADMIN'),
  validate({ params: employeeIdParamSchema }),
  employeesController.reportsOf,
);

router.post(
  '/',
  authorize('HR_ADMIN', 'SUPER_ADMIN'),
  validate({ body: createEmployeeSchema }),
  employeesController.create,
);

router.patch(
  '/:id',
  authorize('MANAGER', 'HR_ADMIN', 'SUPER_ADMIN'),
  validate({ params: employeeIdParamSchema, body: updateEmployeeSchema }),
  employeesController.update,
);

router.post(
  '/:id/avatar',
  validate({ params: employeeIdParamSchema }),
  avatarUpload,
  employeesController.uploadAvatar,
);

export const employeesRoutes = router;
