import { MODULE_ID } from "./constants.js";

/**
 * Merge the actor-type default sounds with the document's own sounds.
 * Type defaults are spread first; the document's own sounds override on key collision
 * (collision is near-impossible in practice since both use randomID()).
 * @param {Actor|TokenDocument} dataSource
 * @returns {object} Merged sound map keyed by soundId.
 */
export function getMergedSounds(dataSource) {
  const ownSounds = dataSource.getFlag(MODULE_ID, "sounds") ?? {};
  const actorType = dataSource.type ?? dataSource.actor?.type;
  if (!actorType) return ownSounds;
  const typeDefaults = (game.settings.get(MODULE_ID, "actorTypeDefaults") ?? {})[actorType] ?? {};
  return { ...typeDefaults, ...ownSounds };
}
