import { readBounded } from "./security.js";

export class VerificationError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

export async function verifyVisitor(request, env, token, action) {
  try {
    const check = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST", signal: AbortSignal.timeout(10000), headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token, remoteip: request.headers.get("CF-Connecting-IP") || "" }),
    });
    const verification = JSON.parse(await readBounded(check, 8000));
    if (!check.ok || verification.success !== true || verification.action !== action || verification.hostname !== env.TURNSTILE_HOSTNAME) {
      throw new VerificationError("Bot verification failed. Complete it again.", 403);
    }
  } catch (error) {
    if (error instanceof VerificationError) throw error;
    throw new VerificationError("Bot verification is unavailable. Try again.", 503);
  }
}
