/** Spawn, despawn, and query. Networked ids are assigned only on the host. */

import { createEntity } from "./entity.js";

/** @param {{ canSpawn: (local: boolean) => boolean, canDespawn: () => boolean, onSpawn: (e: any) => void, onDespawn: (e: any) => void }} hooks */
export function createWorld(hooks) {
  const ctx = { byId: new Map(), hooks, nextId: 1, localId: 0 };
  return {
    spawn(type, init, opts) {
      return spawn(ctx, type, init, opts);
    },
    despawn(entity) {
      despawn(ctx, entity);
    },
    remove(id) {
      ctx.byId.delete(id);
    },
    ingest(entity) {
      ctx.byId.set(entity.id, entity);
    },
    query(type) {
      const all = [...ctx.byId.values()];
      return type == null ? all : all.filter((entity) => entity.type === type);
    },
    get(id) {
      return ctx.byId.get(id) || null;
    },
  };
}

/** @param {any} ctx @param {string} type @param {any} init @param {any} opts */
function spawn(ctx, type, init, opts) {
  const local = !!(opts && opts.local);
  if (!ctx.hooks.canSpawn(local)) throw new Error("only the host spawns networked entities");
  const id = local ? (ctx.localId -= 1) : ctx.nextId++;
  const entity = createEntity(id, type, init, local);
  ctx.byId.set(id, entity);
  if (!local) ctx.hooks.onSpawn(entity);
  return entity;
}

/** @param {any} ctx @param {any} entity */
function despawn(ctx, entity) {
  const id = typeof entity === "number" ? entity : entity && entity.id;
  const found = ctx.byId.get(id);
  if (!found) return;
  if (!found.local && !ctx.hooks.canDespawn())
    throw new Error("only the host despawns networked entities");
  ctx.byId.delete(id);
  if (!found.local) ctx.hooks.onDespawn(found);
}
