import type { RealmDefinition } from '../../core/realm';
import { STAND_Y } from '../../physics';
import { spawnForArrival } from './layout';
import { createPlazaContent, PLAZA_ENGINE_OPTIONS } from './content';

export const plazaRealm: RealmDefinition = {
  id: 'plaza',
  engine: PLAZA_ENGINE_OPTIONS,
  loadingText: 'Loading the plaza…',
  welcome: 'Welcome to the plaza. Press Enter to chat.',
  build: createPlazaContent,
  spawn(hash) { return { ...spawnForArrival(hash), y: STAND_Y }; },
};
