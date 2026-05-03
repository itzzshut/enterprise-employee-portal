import { Router } from 'express';
import { authenticate } from '@middleware/authenticate';
import { authorize } from '@middleware/authorize';
import { validate } from '@middleware/validate';
import { departmentsController } from './departments.controller';
import {
  createDepartmentSchema,
  departmentIdParamSchema,
  listDepartmentsQuerySchema,
  updateDepartmentSchema,
} from './departments.schema';

const router = Router();

router.use(authenticate);

router.get('/', validate({ query: listDepartmentsQuerySchema }), departmentsController.list);
router.get('/:id', validate({ params: departmentIdParamSchema }), departmentsController.getOne);

router.post(
  '/',
  authorize('HR_ADMIN', 'SUPER_ADMIN'),
  validate({ body: createDepartmentSchema }),
  departmentsController.create,
);

router.patch(
  '/:id',
  authorize('HR_ADMIN', 'SUPER_ADMIN'),
  validate({ params: departmentIdParamSchema, body: updateDepartmentSchema }),
  departmentsController.update,
);

export const departmentsRoutes = router;
