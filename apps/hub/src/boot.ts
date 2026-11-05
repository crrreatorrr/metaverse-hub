import { gate } from './login';

/** Paint the login gate while the realm's large chunk downloads. */
export function boot(load: () => Promise<unknown>, failureText: string): void {
  load().catch((error: unknown) => {
    console.error(error);
    gate.failed(failureText);
  });
}
