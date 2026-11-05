import type { RelicId } from '@metaverse/hub-sdk';
import type { Group, PerspectiveCamera, Scene, Vector3, WebGLRenderer } from 'three';
import type { Collider } from '../collider';
import type { PortalConfig } from '../config';
import type { AvatarLook } from '../look';

export const REALM_IDS = ['plaza', 'sandbox'] as const;
export type RealmId = (typeof REALM_IDS)[number];
export interface SpawnPoint { x: number; y: number; z: number; yaw: number }
export interface FrameState { moving: boolean; sprint: boolean; position: Vector3 }
export interface RealmContext {
  scene: Scene;
  camera: PerspectiveCamera;
  renderer: WebGLRenderer;
  rig: Group;
  initialLook?: AvatarLook;
}
export interface Interaction {
  /** Evaluated in realm order; the first active prompt wins. */
  active(): boolean;
  prompt(): string;
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
}
export interface RealmDefinition {
  id: RealmId;
  build(ctx: RealmContext): Promise<RealmContent>;
  spawn(hash: string): SpawnPoint;
}
