import { MODULE_ID } from "./constants.js";
import { SoundOfToken } from "./api.js";
import { registerTokenHooks } from "./token-hooks.js";

const SETTINGS = {
  nonRepeat: [],
};

Hooks.on("init", () => {
  game.settings.register(MODULE_ID, "nonRepeat", {
    scope: "world",
    config: false,
    type: Array,
    default: [],
    onChange: (val) => {
      SETTINGS.nonRepeat = val;
    },
  });
  SETTINGS.nonRepeat = game.settings.get(MODULE_ID, "nonRepeat");

  patchAmbientSound();
  registerTokenHooks();

  // Handle broadcasts forwarded by non-GM clients so the responsible GM performs the side effect.
  game.socket?.on(`module.${MODULE_ID}`, (message) => {
    if (!game.user.isGM) return;
    const isResponsibleGM = !game.users
      .filter((user) => user.isGM && (user.active || user.isActive))
      .some((other) => other.id < game.user.id);
    if (!isResponsibleGM) return;

    const args = message.args;

    if (message.handlerName === "sound" && message.type === "CREATE") {
      const token = game.scenes.get(args.sceneId)?.tokens.get(args.tokenId);
      if (token) createSound(token, args.sound, true);
    } else if (message.handlerName === "sound" && message.type === "DELETE") {
      const ambientSound = game.scenes.get(args.sceneId)?.sounds.get(args.ambientSoundId);
      if (ambientSound) ambientSound.delete();
      endNonRepeatEarly(args.tokenId, args.soundId, args.sceneId);
    } else if (message.handlerName === "sound" && message.type === "POSITIONS") {
      const scene = game.scenes.get(args.sceneId);
      if (scene) refreshSoundPosition(scene.tokens.get(args.tokenId));
    }
  });

  globalThis.SoundOfToken = SoundOfToken;
});

/**
 * Patch the canvas AmbientSound placeable so module-generated sounds:
 *  - honour their AmbientSoundDocument#repeat flag after every sync (core forces loop=true).
 *  - use a non-singleton audio instance, so multiple tokens can simultaneously play the same source.
 *
 * Calls the captured original methods so chained patches by other modules keep working.
 */
function patchAmbientSound() {
  const AmbientSoundCls = foundry.canvas.placeables.AmbientSound;

  const originalSync = AmbientSoundCls.prototype.sync;
  AmbientSoundCls.prototype.sync = async function (...args) {
    const result = await originalSync.apply(this, args);
    if (this.sound?.playing && this.document.getFlag(MODULE_ID, "autoGen")) {
      this.sound.loop = this.document.repeat;
    }
    return result;
  };

  // FIXME: _createSound is a private core method. No public hook exposes per-placeable audio
  // construction, so we must override it directly. Re-evaluate when v14 exposes a public hook.
  const originalCreateSound = AmbientSoundCls.prototype._createSound;
  AmbientSoundCls.prototype._createSound = function (...args) {
    if (this.document.getFlag(MODULE_ID, "autoGen")) {
      const path = this.document.path;
      if (!this.id || !path) return null;
      return game.audio.create({
        src: path,
        context: new AudioContext(game.audio.environment),
        singleton: false,
      });
    }
    return originalCreateSound.apply(this, args);
  };
}

/**
 * Resolve the soundboard list for a token (falling back to its actor) and start every entry
 * the token is currently marked as playing but does not yet have an attached AmbientSound for.
 * @param {TokenDocument} token
 * @param {string[]} [soundIds] Optional subset; defaults to every id in the playing flag.
 * @returns {Promise<void>}
 */
export async function playSounds(token, soundIds) {
  const dataSource = game.actors.get(token.actorId) ?? token;

  const sounds = dataSource.getFlag(MODULE_ID, "sounds") ?? {};
  const playing = token.getFlag(MODULE_ID, "playing") ?? {};

  if (!soundIds) soundIds = Object.keys(playing);
  const attached = token.getFlag(MODULE_ID, "attached") ?? {};

  for (const soundId of soundIds) {
    if (!attached[soundId] && playing[soundId] && sounds[soundId]) {
      await createSound(token, sounds[soundId]);
    }
  }

  refreshSoundPosition(token);
}

/**
 * Stop every sound on `token` that was previously playing but is no longer in the playing flag.
 * @param {TokenDocument} token
 * @param {string[]} [soundIds] Optional subset; defaults to every id in the playing flag.
 */
export function stopSounds(token, soundIds) {
  const playing = token.getFlag(MODULE_ID, "playing") ?? {};
  if (!soundIds) soundIds = Object.keys(playing);
  const attached = token.getFlag(MODULE_ID, "attached") ?? {};

  for (const soundId of soundIds) {
    if (attached[soundId] && !playing[soundId]) {
      deleteSound(token, soundId, attached[soundId]);
    }
  }
}

/**
 * Tear down every AmbientSound attached to a token when the token itself is removed.
 * @param {TokenDocument} token
 */
export function deleteToken(token) {
  const attached = token.getFlag(MODULE_ID, "attached") ?? {};

  for (const [soundId, ambientSoundId] of Object.entries(attached)) {
    const ambientSound = token.parent?.sounds.get(ambientSoundId);
    if (ambientSound) deleteSoundDocument(ambientSound, token, soundId);
  }
}

/**
 * Delete a single attached sound and clear its reference from the token flag.
 * @param {TokenDocument} token
 * @param {string} soundId
 * @param {string} ambientSoundId
 */
export function deleteSound(token, soundId, ambientSoundId) {
  const ambientSound = token.parent?.sounds.get(ambientSoundId);
  if (ambientSound) deleteSoundDocument(ambientSound, token, soundId);
  token.update({ [`flags.${MODULE_ID}.attached.-=${soundId}`]: null });
}

/**
 * GM-only delete of an AmbientSound document. Non-GM clients forward the request via socket so
 * the responsible GM performs the deletion.
 * @param {AmbientSoundDocument} doc
 * @param {TokenDocument} token
 * @param {string} soundId
 */
function deleteSoundDocument(doc, token, soundId) {
  if (!game.user.isGM) {
    const message = {
      handlerName: "sound",
      args: { ambientSoundId: doc.id, tokenId: token.id, sceneId: token.parent.id, soundId },
      type: "DELETE",
    };
    game.socket?.emit(`module.${MODULE_ID}`, message);
    return;
  }

  endNonRepeatEarly(token.id, soundId, token.parent.id);

  doc.delete();
}

/**
 * Remove a non-repeat tracker entry early, e.g. when its sound was manually stopped.
 * @param {string} tokenId
 * @param {string} soundId
 * @param {string} sceneId
 */
function endNonRepeatEarly(tokenId, soundId, sceneId) {
  const newRepeat = SETTINGS.nonRepeat.filter(
    (o) => o.soundId !== soundId || o.tokenId !== tokenId || o.sceneId !== sceneId,
  );
  if (SETTINGS.nonRepeat.length !== newRepeat.length) {
    SETTINGS.nonRepeat = newRepeat;
    game.settings.set(MODULE_ID, "nonRepeat", newRepeat);
  }
}

/**
 * Remove a non-repeat tracker entry and clear the token's playing flag.
 * Safe to call when the entry was already removed (stale timer after a manual stop).
 * @param {string} sceneId
 * @param {string} tokenId
 * @param {string} soundId
 */
function _cleanupNonRepeat(sceneId, tokenId, soundId) {
  const before = SETTINGS.nonRepeat.length;
  SETTINGS.nonRepeat = SETTINGS.nonRepeat.filter(
    (e) => !(e.sceneId === sceneId && e.tokenId === tokenId && e.soundId === soundId),
  );
  if (SETTINGS.nonRepeat.length === before) return;

  game.settings.set(MODULE_ID, "nonRepeat", SETTINGS.nonRepeat);
  const token = game.scenes.get(sceneId)?.tokens.get(tokenId);
  if (token) token.update({ [`flags.${MODULE_ID}.playing.-=${soundId}`]: null });
}

/**
 * Persist a non-repeat entry and schedule its cleanup via setTimeout.
 * Called only on the responsible GM after creating a non-looping AmbientSound.
 * @param {TokenDocument} token
 * @param {string} soundId
 * @param {number} endTime Epoch ms when the sound is expected to finish.
 * @returns {Promise<void>}
 */
async function scheduleNonRepeatCleanup(token, soundId, endTime) {
  SETTINGS.nonRepeat.push({ sceneId: token.parent.id, tokenId: token.id, soundId, endTime });
  await game.settings.set(MODULE_ID, "nonRepeat", SETTINGS.nonRepeat);
  setTimeout(
    () => _cleanupNonRepeat(token.parent.id, token.id, soundId),
    Math.max(0, endTime - Date.now()),
  );
}

/**
 * Called on canvasReady by the responsible GM. Reschedules pending non-repeat cleanups that
 * survived a page reload, and immediately clears entries that already expired while offline.
 * Must be awaited before playSounds so expired tokens are clean before new sounds are created.
 * @returns {Promise<void>}
 */
export async function reconcileNonRepeat() {
  const isResponsibleGM =
    game.user.isGM &&
    !game.users
      .filter((u) => u.isGM && (u.active || u.isActive))
      .some((other) => other.id < game.user.id);
  if (!isResponsibleGM) return;

  const now = Date.now();
  const expired = SETTINGS.nonRepeat.filter((e) => e.endTime <= now);
  const pending = SETTINGS.nonRepeat.filter((e) => e.endTime > now);

  for (const entry of pending) {
    setTimeout(
      () => _cleanupNonRepeat(entry.sceneId, entry.tokenId, entry.soundId),
      entry.endTime - now,
    );
  }

  if (!expired.length) return;

  SETTINGS.nonRepeat = pending;
  game.settings.set(MODULE_ID, "nonRepeat", pending);

  await Promise.all(
    expired.map(({ sceneId, tokenId, soundId }) => {
      const token = game.scenes.get(sceneId)?.tokens.get(tokenId);
      return token?.update({ [`flags.${MODULE_ID}.playing.-=${soundId}`]: null });
    }),
  );
}

/**
 * GM-only creation of an AmbientSound attached to `token`. Non-GM clients forward via socket.
 * @param {TokenDocument} token
 * @param {object} sound Sound definition stored on the actor's `sounds` flag.
 * @param {boolean} [setPosition=false] Re-anchor sound positions after creation.
 * @returns {Promise<void>}
 */
export async function createSound(token, sound, setPosition = false) {
  if (!game.user.isGM) {
    const message = {
      handlerName: "sound",
      args: { tokenId: token.id, sceneId: token.parent.id, sound },
      type: "CREATE",
    };
    game.socket?.emit(`module.${MODULE_ID}`, message);
    return;
  }

  const s = foundry.utils.deepClone(sound);
  if (!s.radius) s.radius = 30;
  s[`flags.${MODULE_ID}.autoGen`] = true;

  const audio = game.audio.create({ src: s.path });
  if (audio && !audio.loaded) await audio.load().catch(() => {});

  const doc = (await token.parent.createEmbeddedDocuments("AmbientSound", [s]))[0];

  await token.update({ [`flags.${MODULE_ID}.attached.${sound.soundId}`]: doc.id });

  if (setPosition) refreshSoundPosition(token);

  const duration = audio?.duration;
  if (duration && !doc.repeat) {
    scheduleNonRepeatCleanup(token, sound.soundId, Date.now() + duration * 1000 + 1000);
  }
}

/**
 * Re-anchor every AmbientSound attached to `token` at the token's current centre, batching all
 * updates into a single embedded-document write.
 * @param {TokenDocument} token
 */
export function refreshSoundPosition(token) {
  const scene = token.parent;
  if (!game.user.isGM) {
    const message = {
      handlerName: "sound",
      args: { sceneId: scene.id, tokenId: token.id },
      type: "POSITIONS",
    };
    game.socket?.emit(`module.${MODULE_ID}`, message);
    return;
  }

  const attached = token.getFlag(MODULE_ID, "attached") ?? {};
  const ambientSounds = [];
  for (const [soundId, ambientSoundId] of Object.entries(attached)) {
    const ambientSound = scene.sounds.get(ambientSoundId);
    if (ambientSound) ambientSounds.push(ambientSound);
    else token.update({ [`flags.${MODULE_ID}.attached.-=${soundId}`]: null });
  }

  if (ambientSounds.length) {
    const center = {
      x: token._source.x + (token.width * canvas.dimensions.size) / 2,
      y: token._source.y + (token.height * canvas.dimensions.size) / 2,
    };

    const updates = [];
    for (const ambientSound of ambientSounds) {
      updates.push({ _id: ambientSound.id, ...center });
    }
    scene.updateEmbeddedDocuments("AmbientSound", updates);
  }
}
