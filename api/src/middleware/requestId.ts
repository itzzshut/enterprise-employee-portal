import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { requestContext } from '@utils/logger';

const HEADER = 'x-request-id';

/**
 * Accepts an upstream correlation id (nginx / load balancer / another service)
 * or mints one, echoes it back on the response, and binds it to the
 * AsyncLocalStorage store so every log line in this request shares it.
 */
export function requestId(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header(HEADER);
  const id = incoming && incoming.length <= 64 ? incoming : randomUUID();

  req.requestId = id;
  res.setHeader('X-Request-Id', id);

  requestContext.run({ requestId: id }, () => next());
}
