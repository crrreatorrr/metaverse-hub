import type { RealmDefinition } from '../../core/realm';
import { STAND_Y } from '../../physics';
import { plazaSpawn } from './layout';
import { SPAWN_SPOTS } from '../../core/spawn-spread';
import { createPlazaContent, PLAZA_ENGINE_OPTIONS } from './content';

export const plazaRealm: RealmDefinition = {
  id: 'plaza',
  engine: PLAZA_ENGINE_OPTIONS,
  loadingText: 'Loading the plaza…',
  welcome: 'Welcome to the plaza. Press Enter to chat.',
  build: createPlazaContent,
  spawn(hash) { return { ...plazaSpawn(hash, Math.floor(Math.random() * SPAWN_SPOTS)), y: STAND_Y }; },
};
