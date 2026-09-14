import type { RequestHandler } from "express";
import { z } from "zod";

export type Permission = "disputes:read" | "disputes:write";
export interface Actor {
  id: string;
  name: string;
  permissions: readonly Permission[];
}
export const localActor: Actor = {
  id: "local-operator",
  name: "Local operator",
  permissions: ["disputes:read", "disputes:write"],
};

// Replace with a verified identity provider session before enabling real data.
export const resolveActor: RequestHandler = (_req, res, next) => {
  res.locals.actor = localActor;
  next();
};

export const requireLocalHost: RequestHandler = (req, res, next) => {
  const allowed = ["localhost", "127.0.0.1", "[::1]"];
  if (process.env.APP_ORIGIN)
    allowed.push(new URL(process.env.APP_ORIGIN).hostname);
  if (!allowed.includes(req.hostname)) {
    res.status(403).json({ error: "Host is not allowed." });
    return;
  }
  next();
};

export function authorize(permission: Permission): RequestHandler {
  return (_req, res, next) => {
    const actor = res.locals.actor as Actor | undefined;
    if (!actor?.permissions.includes(permission)) {
      res
        .status(403)
        .json({ error: "You do not have permission to perform this action." });
      return;
    }
    next();
  };
}

export const protectMutation: RequestHandler = (req, res, next) => {
  if (
    req.get("X-Dispute-Client") !== "internal-web" ||
    !req.is("application/json") ||
    req.get("Sec-Fetch-Site") === "cross-site"
  ) {
    res
      .status(403)
      .json({ error: "Use the internal application to make changes." });
    return;
  }
  if (process.env.APP_ORIGIN && req.get("origin") !== process.env.APP_ORIGIN) {
    res.status(403).json({ error: "Origin is not allowed." });
    return;
  }
  next();
};

// A conservative guardrail, not a substitute for a production DLP system.
export const safeText = z
  .string()
  .refine(
    (value) =>
      !/(?:\d[ -]?){13,19}|\b\d{3}-\d{2}-\d{4}\b|\b(?:cvv|cvc|pin)\s*[:=]?\s*\d{3,6}\b/i.test(
        value,
      ),
    "Do not include payment card numbers, security codes, or national identifiers.",
  );
