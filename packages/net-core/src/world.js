/** Spawn, despawn, and query. Networked ids are assigned only on the host. */

import { createEntity } from "./entity.js";

/** @param {{ canSpawn: (local: boolean) => boolean, canDespawn: () => boolean, onSpawn: (e: any) => void, onDespawn: (e: any) => void }} hooks */
export function createWorld(hooks) {
  const ctx = { byId: new Map(), list: [], hooks, nextId: 1, localId: 0 };
  return {
    spawn(type, init, opts) {
      return spawn(ctx, type, init, opts);
    },
    despawn(entity) {
      despawn(ctx, entity);
    },
    remove(id) {
      drop(ctx, id);
    },
    ingest(entity) {
      add(ctx, entity);
    },
    live() {
      return ctx.list;
    },
    query(type) {
      const all = ctx.list.slice();
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
  add(ctx, entity);
  if (!local) ctx.hooks.onSpawn(entity);
  return entity;
}

/** @param {any} ctx @param {any} entity */
function add(ctx, entity) {
  if (ctx.byId.has(entity.id)) drop(ctx, entity.id);
  ctx.byId.set(entity.id, entity);
  ctx.list.push(entity);
}

/** @param {any} ctx @param {number} id */
function drop(ctx, id) {
  const found = ctx.byId.get(id);
  if (!found) return;
  ctx.byId.delete(id);
  const index = ctx.list.indexOf(found);
  if (index >= 0) ctx.list.splice(index, 1);
}

/** @param {any} ctx @param {any} entity */
function despawn(ctx, entity) {
  const id = typeof entity === "number" ? entity : entity && entity.id;
  const found = ctx.byId.get(id);
  if (!found) return;
  if (!found.local && !ctx.hooks.canDespawn())
    throw new Error("only the host despawns networked entities");
  drop(ctx, id);
  if (!found.local) ctx.hooks.onDespawn(found);
}
