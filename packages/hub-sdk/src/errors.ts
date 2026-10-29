export class HubSdkError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'HubSdkError';
    this.code = code;
  }
}
