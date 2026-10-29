/** Built-in palettes. Index 0 of every document palette is reserved for transparency. */

export function deepFreeze(o) { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const k of Object.keys(o)) deepFreeze(o[k]); } return o; }
// Palettes via lospec.com/palette-list. Index 0 of every document palette is reserved for transparency.
export const PALETTES = deepFreeze({
  'Sweetie 16': { credit: 'Sweetie 16 by GrafxKid (lospec.com/palette-list/sweetie-16)',
    colors: ['1a1c2c','5d275d','b13e53','ef7d57','ffcd75','a7f070','38b764','257179','29366f','3b5dc9','41a6f6','73eff7','f4f4f4','94b0c2','566c86','333c57'] },
  'PICO-8': { credit: 'PICO-8 palette by Lexaloffle Games (lospec.com/palette-list/pico-8)',
    colors: ['000000','1d2b53','7e2553','008751','ab5236','5f574f','c2c3c7','fff1e8','ff004d','ffa300','ffec27','00e436','29adff','83769c','ff77a8','ffccaa'] },
  'ENDESGA 32': { credit: 'ENDESGA 32 by Endesga (lospec.com/palette-list/endesga-32)',
    colors: ['be4a2f','d77643','ead4aa','e4a672','b86f50','733e39','3e2731','a22633','e43b44','f77622','feae34','fee761','63c74d','3e8948','265c42','193c3e','124e89','0099db','2ce8f5','ffffff','c0cbdc','8b9bb4','5a6988','3a4466','262b44','181425','ff0044','68386c','b55088','f6757a','e8b796','c28569'] },
});
export const DEFAULT_PALETTE = 'Sweetie 16';
