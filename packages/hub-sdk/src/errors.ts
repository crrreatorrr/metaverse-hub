export class HubSdkError extends Error {
  readonly code: string;
  readonly status?: number;
  /** Tickets still allowed under the cap that rejected the call. */
  readonly capLeft?: number;
  readonly sessionCapLeft?: number;
  readonly dailyCapLeft?: number;

  constructor(
    code: string,
    message: string,
    status?: number,
    capLeft?: number,
    sessionCapLeft?: number,
    dailyCapLeft?: number,
  ) {
    super(message);
    this.name = 'HubSdkError';
    this.code = code;
    this.status = status;
    this.capLeft = capLeft;
    this.sessionCapLeft = sessionCapLeft ?? (code === 'session_ticket_cap' ? capLeft : undefined);
    this.dailyCapLeft = dailyCapLeft ?? (code === 'daily_ticket_cap' ? capLeft : undefined);
  }
}
