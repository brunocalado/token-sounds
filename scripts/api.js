import { MODULE_ID } from "./constants.js";

/**
 * Public macro/script API exposed on globalThis as `SoundOfToken`.
 */
export class SoundOfToken {
  /**
   * Mark every sound on the given token(s) with the matching `name` as playing.
   * @param {string|Token|TokenDocument|Actor} token
   * @param {string} name
   * @returns {Promise<void>}
   */
  static async play(token, name) {
    if (!name) throw Error("No sound name provided.");

    const tokens = _getTokens(token, name);
    for (const t of tokens) {
      const dataSource = game.actors.get(t.actorId) ?? t;
      const sounds = dataSource.getFlag(MODULE_ID, "sounds") ?? {};

      const soundId = Object.keys(sounds).find((id) => sounds[id].name === name);
      if (!soundId) continue;

      t.update({ [`flags.${MODULE_ID}.playing.${soundId}`]: true });
    }
  }

  /**
   * Mark every sound on the given token(s) with the matching `name` as stopped.
   * @param {string|Token|TokenDocument|Actor} token
   * @param {string} name
   * @returns {Promise<void>}
   */
  static async stop(token, name) {
    if (!name) throw Error("No sound name provided.");

    const tokens = _getTokens(token, name);
    for (const t of tokens) {
      const dataSource = game.actors.get(t.actorId) ?? t;
      const sounds = dataSource.getFlag(MODULE_ID, "sounds") ?? {};

      const soundId = Object.keys(sounds).find((id) => sounds[id].name === name);
      if (!soundId) continue;

      t.unsetFlag(MODULE_ID, `playing.${soundId}`);
    }
  }
}

/**
 * Resolve an input into the list of TokenDocuments the API should act on.
 * Accepts an id string, a Token, a TokenDocument, or an Actor.
 * @param {string|Token|TokenDocument|Actor} token
 * @param {string} name Forwarded only for use in the error message.
 * @returns {TokenDocument[]}
 */
function _getTokens(token, name) {
  if (foundry.utils.getType(token) === "string") token = canvas.tokens.get(token);

  const TokenCls = foundry.canvas.placeables.Token;
  const TokenDocumentCls = foundry.documents.TokenDocument;
  const ActorCls = foundry.documents.Actor;

  let tokens;
  if (token instanceof TokenCls) token = token.document;
  if (token instanceof TokenDocumentCls) tokens = [token];
  else if (token instanceof ActorCls) tokens = token.getActiveTokens(false, true);

  if (!tokens) throw Error(`Invalid token/actor. Unable to play sound: ${name}`);

  return tokens;
}
