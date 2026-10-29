/** Sprite document format identifiers and hard limits. */

export const FORMAT = 'osh-pixel';
export const FORMAT_VERSION = 2;          // v2: RLE+base64 cels. v1 (hex rows) still loads.
export const LIMITS = Object.freeze({ minSize: 1, maxSize: 256, maxColors: 256, maxLayers: 64, maxFrames: 512, maxCelBytes: 48 * 1024 * 1024,
  maxOps: 200000, maxPixelsPerOp: 262144, maxNameLen: 64, maxCoord: 1e9, maxAnimations: 256 });
export const AUTHORS = Object.freeze(['user', 'ai']);
export const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
export const ID_LAYER = /^L\d{1,7}$/, ID_FRAME = /^F\d{1,7}$/;
