import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from "@nestjs/common";
import type { Request, Response } from "express";
import { FixedWindowLimiter } from "./fixed-window-limiter.js";

/** Requests one address may make to the link routes per minute: a whole inspection is about 40 requests, retries included. */
export const TOKEN_ROUTE_LIMIT_PER_MINUTE = 300;

/**
 * Rate limit for the public link routes `/i/:token...` and nothing else (spec p. 13: rate limiting on token endpoints).
 * The key is the caller's address. Behind Railway's proxy the socket address is the proxy's, so the first `X-Forwarded-For`
 * entry is used when present. A client can invent that header, which only lets it dodge its own limit: the tokens are 256 random
 * bits, so this limit blunts abuse and noise, it is not what keeps links secret. A shared address (the garage wifi) is shared
 * by its drivers, which is why the limit is generous.
 *
 * Express comparison: a middleware mounted on one router (`router.use(limiter)`), written as a Nest guard so it is attached
 * to this controller only.
 */
@Injectable()
export class TokenRateLimitGuard implements CanActivate {
  /** A property so a test can use a small limit. */
  limiter = new FixedWindowLimiter(TOKEN_ROUTE_LIMIT_PER_MINUTE, 60_000);

  canActivate(context: ExecutionContext): boolean {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const key = clientAddress(request);
    if (this.limiter.hit(key)) return true;
    http
      .getResponse<Response>()
      .setHeader("Retry-After", String(this.limiter.retryAfterSeconds(key)));
    throw new HttpException(
      "Too many requests. Please wait a minute and try again.",
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

/** The caller's address: first `X-Forwarded-For` entry, else the socket's. */
export function clientAddress(request: Request): string {
  const forwarded = request.headers["x-forwarded-for"];
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)
    ?.split(",")[0]
    ?.trim();
  return first || request.ip || request.socket?.remoteAddress || "unknown";
}
