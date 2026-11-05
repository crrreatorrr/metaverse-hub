import { boot } from '../../boot';

boot(async () => {
  const [{ startRealm }, { sandboxRealm }] = await Promise.all([import('../../core/shell'), import('./index')]);
  await startRealm(sandboxRealm);
}, 'The sandbox failed to download. Reload to try again.');
