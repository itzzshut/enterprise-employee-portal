import type { Request, Response } from 'express';
import { currentUser } from '@middleware/authenticate';
import { asyncHandler } from '@utils/asyncHandler';
import { announcementsService } from './announcements.service';

export const announcementsController = {
  feed: asyncHandler(async (req: Request, res: Response) => {
    const page = await announcementsService.feed(currentUser(req), req.query as never);
    res.status(200).json(page);
  }),

  unreadCount: asyncHandler(async (req: Request, res: Response) => {
    const unread = await announcementsService.unreadCount(currentUser(req));
    res.status(200).json({ unread });
  }),

  getOne: asyncHandler(async (req: Request, res: Response) => {
    const announcement = await announcementsService.getById(currentUser(req), Number(req.params.id));
    res.status(200).json({ announcement });
  }),

  markRead: asyncHandler(async (req: Request, res: Response) => {
    const announcement = await announcementsService.markRead(currentUser(req), Number(req.params.id));
    res.status(200).json({ announcement });
  }),

  create: asyncHandler(async (req: Request, res: Response) => {
    const announcement = await announcementsService.create(currentUser(req), req.body);
    res.status(201).json({ announcement });
  }),

  receipts: asyncHandler(async (req: Request, res: Response) => {
    const data = await announcementsService.receipts(currentUser(req), Number(req.params.id));
    res.status(200).json({ data });
  }),
};
