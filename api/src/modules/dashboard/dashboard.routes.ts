import { Router } from 'express';
import { authenticate } from '@middleware/authenticate';
import { dashboardController } from './dashboard.controller';

const router = Router();

router.use(authenticate);
router.get('/summary', dashboardController.summary);

export const dashboardRoutes = router;
