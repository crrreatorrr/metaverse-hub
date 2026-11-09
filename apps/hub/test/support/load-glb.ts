// Node loader for the shipped GLBs: geometry, skins and clips. Textures are skipped (no DOM in Node).
import { readFileSync } from 'node:fs';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const g = globalThis as Record<string, unknown>;
g.self ??= { URL: { createObjectURL: () => 'blob:none', revokeObjectURL: () => undefined } };
g.document ??= { createElementNS: () => { throw new Error('no DOM in the Node test'); } };

export async function loadGLB(path: string): Promise<GLTF> {
  const bytes = readFileSync(path);
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const quietError = console.error;
  console.error = () => undefined; // "Couldn't load texture" for every image
  try {
    return await loader.parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
  } finally {
    console.error = quietError;
  }
}
