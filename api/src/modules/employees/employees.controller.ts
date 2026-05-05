import path from 'node:path';
import type { Request, Response } from 'express';
import { currentUser } from '@middleware/authenticate';
import { ApiError } from '@utils/ApiError';
import { asyncHandler } from '@utils/asyncHandler';
import { employeesService } from './employees.service';

export const employeesController = {
  directory: asyncHandler(async (req: Request, res: Response) => {
    const page = await employeesService.directory(req.query as never);
    res.status(200).json(page);
  }),

  me: asyncHandler(async (req: Request, res: Response) => {
    const employee = await employeesService.getMyProfile(currentUser(req));
    res.status(200).json({ employee });
  }),

  updateMe: asyncHandler(async (req: Request, res: Response) => {
    const employee = await employeesService.updateMyProfile(currentUser(req), req.body);
    res.status(200).json({ employee });
  }),

  getOne: asyncHandler(async (req: Request, res: Response) => {
    const employee = await employeesService.getById(Number(req.params.id));
    res.status(200).json({ employee });
  }),

  myTeam: asyncHandler(async (req: Request, res: Response) => {
    const reports = await employeesService.getDirectReports(currentUser(req));
    res.status(200).json({ data: reports });
  }),

  reportsOf: asyncHandler(async (req: Request, res: Response) => {
    const reports = await employeesService.getDirectReports(currentUser(req), Number(req.params.id));
    res.status(200).json({ data: reports });
  }),

  create: asyncHandler(async (req: Request, res: Response) => {
    const employee = await employeesService.create(currentUser(req), req.body);
    res.status(201).json({ employee });
  }),

  update: asyncHandler(async (req: Request, res: Response) => {
    const employee = await employeesService.update(currentUser(req), Number(req.params.id), req.body);
    res.status(200).json({ employee });
  }),

  uploadAvatar: asyncHandler(async (req: Request, res: Response) => {
    if (!req.file) throw ApiError.badRequest('No avatar file was provided');
    const employee = await employeesService.setAvatar(
      currentUser(req),
      Number(req.params.id),
      path.basename(req.file.filename),
    );
    res.status(200).json({ employee });
  }),
};
