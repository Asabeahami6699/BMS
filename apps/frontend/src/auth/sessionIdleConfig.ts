/** Idle time before the stay-signed-in prompt appears. */
export const SESSION_IDLE_MS = 25 * 60 * 1000;

/** Time to respond before automatic sign-out. */
export const SESSION_GRACE_MS = 5 * 60 * 1000;

/** Minimum gap between activity events that reset the idle timer. */
export const SESSION_ACTIVITY_THROTTLE_MS = 1000;

/** How often to check JWT hard expiry while signed in. */
export const SESSION_TOKEN_CHECK_MS = 30 * 1000;

export const SESSION_UNAUTHORIZED_EVENT = "bms:session-unauthorized";
