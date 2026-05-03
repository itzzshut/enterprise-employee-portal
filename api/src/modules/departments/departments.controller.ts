import type { Request, Response } from 'express';
import { currentUser } from '@middleware/authenticate';
import { asyncHandler } from '@utils/asyncHandler';
import { departmentsService } from './departments.service';

export const departmentsController = {
  list: asyncHandler(async (req: Request, res: Response) => {
    const data = await departmentsService.list(Boolean(req.query.includeInactive));
    res.status(200).json({ data });
  }),

  getOne: asyncHandler(async (req: Request, res: Response) => {
    const department = await departmentsService.getById(Number(req.params.id));
    res.status(200).json({ department });
  }),

  create: asyncHandler(async (req: Request, res: Response) => {
    const department = await departmentsService.create(currentUser(req), req.body);
    res.status(201).json({ department });
  }),

  update: asyncHandler(async (req: Request, res: Response) => {
    const department = await departmentsService.update(
      currentUser(req),
      Number(req.params.id),
      req.body,
    );
    res.status(200).json({ department });
  }),
};
