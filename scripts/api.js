import { MODULE_ID } from "./constants.js";

/**
 * Public macro/script API exposed on globalThis as `SoundOfToken`.
 */
export class SoundOfToken {
  /**
   * Mark every sound on the given token(s) with the matching `description` as playing.
   * @param {string|Token|TokenDocument|Actor} token
   * @param {string} description
   * @returns {Promise<void>}
   */
  static async play(token, description) {
    if (!description) throw Error("No sound description provided.");

    const tokens = _getTokens(token, description);
    for (const t of tokens) {
      const dataSource = game.actors.get(t.actorId) ?? t;
      const sounds = dataSource.getFlag(MODULE_ID, "sounds") ?? {};

      const soundId = Object.keys(sounds).find((id) => sounds[id].description === description);
      if (!soundId) continue;

      t.update({ [`flags.${MODULE_ID}.playing.${soundId}`]: true });
    }
  }

  /**
   * Mark every sound on the given token(s) with the matching `description` as stopped.
   * @param {string|Token|TokenDocument|Actor} token
   * @param {string} description
   * @returns {Promise<void>}
   */
  static async stop(token, description) {
    if (!description) throw Error("No sound description provided.");

    const tokens = _getTokens(token, description);
    for (const t of tokens) {
      const dataSource = game.actors.get(t.actorId) ?? t;
      const sounds = dataSource.getFlag(MODULE_ID, "sounds") ?? {};

      const soundId = Object.keys(sounds).find((id) => sounds[id].description === description);
      if (!soundId) continue;

      t.update({ [`flags.${MODULE_ID}.playing.${soundId}`]: foundry.data.operators.ForcedDeletion });
    }
  }
}

/**
 * Resolve an input into the list of TokenDocuments the API should act on.
 * Accepts an id string, a Token, a TokenDocument, or an Actor.
 * @param {string|Token|TokenDocument|Actor} token
 * @param {string} description Forwarded only for use in the error message.
 * @returns {TokenDocument[]}
 */
function _getTokens(token, description) {
  if (foundry.utils.getType(token) === "string") token = canvas.tokens.get(token);

  const TokenCls = foundry.canvas.placeables.Token;
  const TokenDocumentCls = foundry.documents.TokenDocument;
  const ActorCls = foundry.documents.Actor;

  let tokens;
  if (token instanceof TokenCls) token = token.document;
  if (token instanceof TokenDocumentCls) tokens = [token];
  else if (token instanceof ActorCls) tokens = token.getActiveTokens(false, true);

  if (!tokens) throw Error(`Invalid token/actor. Unable to play sound: ${description}`);

  return tokens;
}
