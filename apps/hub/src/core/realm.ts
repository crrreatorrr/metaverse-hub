import type { GameId, NakamaClient, RelicId } from '@metaverse/hub-sdk';
import type { Sprite, Vector3 } from 'three';
import type { Engine, EngineOptions } from './engine';
import type { Collider } from '../collider';
import type { PortalConfig } from '../config';

import type { RealmId } from './realm-id';
export { REALM_IDS, type RealmId } from './realm-id';
export interface SpawnPoint { x: number; y: number; z: number; yaw: number }
export interface FrameState { moving: boolean; sprint: boolean; position: Vector3 }
export interface RealmContext {
  engine: Engine;
  pageFor(id: GameId): string | null;
  travel(game: { id: GameId; label: string; color: string }): void;
  releasePointer(): void;
  isBlocked(): boolean;
}
export interface Interaction {
  /** Evaluated in realm order; the first active prompt wins. */
  active(): boolean;
  prompt(): string;
  showLook?: boolean;
  key?: string;
  interact?(): void;
}
export interface RealmContent {
  collider: Collider;
  cameraFloor(position: Vector3): number;
  update(dt: number, state: FrameState): void;
  onRelicsChanged?(relics: readonly RelicId[]): void;
  interactions?: readonly Interaction[];
  portals?: readonly PortalConfig[];
  portalsEnabled?(): boolean;
  labels?: readonly Sprite[];
  groundHeight?(position: Vector3): number;
  consumeWarp?(): SpawnPoint | null;
  handleKey?(event: KeyboardEvent): boolean;
  /** A realm overlay (the arcade picker) is open: it takes the controller and the avatar stands. */
  overlayOpen?(): boolean;
  /** A controller (true) or the keyboard / mouse (false) was the last device used: overlays switch prompts. */
  setPadPrompts?(on: boolean): void;
  onSession?(session: { client: NakamaClient; token: string }): Promise<void>;
}
export interface RealmDefinition {
  id: RealmId;
  engine: EngineOptions;
  loadingText: string;
  welcome: string;
  build(ctx: RealmContext): Promise<RealmContent>;
  spawn(hash: string): SpawnPoint;
}
