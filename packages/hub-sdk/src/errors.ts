export class HubSdkError extends Error {
  readonly code: string;
  readonly status?: number;
  /** Tickets still allowed under the cap that rejected the call. */
  readonly capLeft?: number;

  constructor(code: string, message: string, status?: number, capLeft?: number) {
    super(message);
    this.name = 'HubSdkError';
    this.code = code;
    this.status = status;
    this.capLeft = capLeft;
  }
}
