import { gate } from './login';

// The login gate is in this small chunk so it paints and takes input right away.
// The plaza (Three.js, models, physics) downloads and builds behind it.
import('./main').catch((error: unknown) => {
  console.error(error);
  gate.failed('The plaza failed to download. Reload to try again.');
});
