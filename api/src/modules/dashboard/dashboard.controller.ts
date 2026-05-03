import type { Request, Response } from 'express';
import { currentUser } from '@middleware/authenticate';
import { asyncHandler } from '@utils/asyncHandler';
import { dashboardService } from './dashboard.service';

export const dashboardController = {
  summary: asyncHandler(async (req: Request, res: Response) => {
    const summary = await dashboardService.summary(currentUser(req));
    res.status(200).json(summary);
  }),
};
