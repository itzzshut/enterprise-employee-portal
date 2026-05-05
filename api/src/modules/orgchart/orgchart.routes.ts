import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '@middleware/authenticate';
import { validate } from '@middleware/validate';
import { orgChartController } from './orgchart.controller';

const router = Router();

const orgChartQuerySchema = z.object({
  rootEmployeeId: z.coerce.number().int().positive().optional(),
  // Bounded to keep the recursive CTE cheap and the payload predictable.
  maxDepth: z.coerce.number().int().min(1).max(10).optional(),
});

router.use(authenticate);

router.get('/', validate({ query: orgChartQuerySchema }), orgChartController.getChart);

export const orgChartRoutes = router;
