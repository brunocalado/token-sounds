import { AUDIO_EXTENSIONS, MODULE_ID } from "./constants.js";
import { SoundOfToken } from "./api.js";
import { registerTokenHooks } from "./token-hooks.js";

/**
 * Client-side cache of currently audible one-shot Sound instances, keyed by
 * `<sourceTokenId>:<soundId>`. Lets us cancel mid-flight playback when the user
 * toggles the soundboard tile off before the natural end.
 * @type {Map<string, foundry.audio.Sound>}
 */
const _activeOneShots = new Map();

Hooks.on("init", () => {
  game.settings.register(MODULE_ID, "channel", {
    name: "Audio Channel",
    hint: "Mixer channel used to route module sounds (interface, music, or environment).",
    scope: "world",
    config: true,
    type: String,
    default: "environment",
    choices: { interface: "Interface", music: "Music", environment: "Environment" },
  });

  patchAmbientSound();
  registerTokenHooks();

  game.socket?.on(`module.${MODULE_ID}`, _onSocketMessage);

  globalThis.SoundOfToken = SoundOfToken;
});

/**
 * Single entry point for module socket messages. Broadcast types (ONESHOT_PLAY, ONESHOT_STOP)
 * run on every client; request types only on the responsible GM.
 * @param {object} message
 */
function _onSocketMessage(message) {
  if (message?.handlerName !== "sound") return;

  switch (message.type) {
    case "ONESHOT_PLAY":  _onOneShotPlay(message.args);  return;
    case "ONESHOT_STOP":  _onOneShotStop(message.args);  return;
  }

  if (!game.user.isGM) return;
  const isResponsibleGM = !game.users
    .filter((user) => user.isGM && (user.active || user.isActive))
    .some((other) => other.id < game.user.id);
  if (!isResponsibleGM) return;

  const args = message.args ?? {};
  switch (message.type) {
    case "CREATE": {
      const token = game.scenes.get(args.sceneId)?.tokens.get(args.tokenId);
      if (token) createSound(token, args.sound, true);
      break;
    }
    case "DELETE": {
      const ambientSound = game.scenes.get(args.sceneId)?.sounds.get(args.ambientSoundId);
      if (ambientSound) ambientSound.delete();
      break;
    }
    case "POSITIONS": {
      const scene = game.scenes.get(args.sceneId);
      if (scene) refreshSoundPosition(scene.tokens.get(args.tokenId));
      break;
    }
    case "ONESHOT_REQUEST": {
      const token = game.scenes.get(args.sceneId)?.tokens.get(args.tokenId);
      if (!token) return;
      const dataSource = game.actors.get(token.actorId) ?? token;
      const sound = (dataSource.getFlag(MODULE_ID, "sounds") ?? {})[args.soundId];
      if (sound) playOneShot(token, sound);
      break;
    }
    case "ONESHOT_STOP_REQUEST": {
      const token = game.scenes.get(args.sceneId)?.tokens.get(args.tokenId);
      if (token) stopOneShot(token, args.soundId);
      break;
    }
  }
}

/**
 * Patch the canvas AmbientSound placeable so module-generated sounds:
 *  - honour their AmbientSoundDocument#repeat flag after every sync (core forces loop=true).
 *  - use a non-singleton audio instance, so multiple tokens can simultaneously play the same source.
 *
 * Only repeat sounds reach this code path now; non-repeat is handled entirely via socket play.
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
 * Resolve the soundboard list for a token and start every repeat entry the token is
 * currently marked as playing but does not yet have an attached AmbientSound for.
 * Non-repeat entries are ignored here — they are one-shots dispatched at click time.
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
    const sound = sounds[soundId];
    if (!sound?.repeat) continue;
    if (!attached[soundId] && playing[soundId]) {
      await createSound(token, sound);
    }
  }

  refreshSoundPosition(token);
}

/**
 * Stop every repeat-mode sound on `token` whose `attached` reference is still set but
 * whose `playing` flag has been cleared.
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
 * Delete a single attached AmbientSound and clear its reference from the token flag.
 * @param {TokenDocument} token
 * @param {string} soundId
 * @param {string} ambientSoundId
 */
export function deleteSound(token, soundId, ambientSoundId) {
  const ambientSound = token.parent?.sounds.get(ambientSoundId);
  if (ambientSound) deleteSoundDocument(ambientSound, token, soundId);
  token.update({ [`flags.${MODULE_ID}.attached.${soundId}`]: foundry.data.operators.ForcedDeletion });
}

/**
 * GM-only delete of an AmbientSound document. Non-GM clients forward via socket.
 * @param {AmbientSoundDocument} doc
 * @param {TokenDocument} token
 * @param {string} soundId
 */
function deleteSoundDocument(doc, token, soundId) {
  if (!game.user.isGM) {
    game.socket?.emit(`module.${MODULE_ID}`, {
      handlerName: "sound",
      args: { ambientSoundId: doc.id, tokenId: token.id, sceneId: token.parent.id, soundId },
      type: "DELETE",
    });
    return;
  }
  doc.delete();
}

/**
 * GM-only creation of a repeat-mode AmbientSound attached to `token`. Non-GM clients
 * forward via socket. Only fields the module actually configures are forwarded — the
 * rest fall back to AmbientSoundDocument schema defaults.
 * @param {TokenDocument} token
 * @param {object} sound Sound definition stored on the actor's `sounds` flag.
 * @param {boolean} [setPosition=false] Re-anchor sound positions after creation.
 * @returns {Promise<void>}
 */
export async function createSound(token, sound, setPosition = false) {
  if (!game.user.isGM) {
    game.socket?.emit(`module.${MODULE_ID}`, {
      handlerName: "sound",
      args: { tokenId: token.id, sceneId: token.parent.id, sound },
      type: "CREATE",
    });
    return;
  }

  const channel = game.settings.get(MODULE_ID, "channel");
  const s = {
    path: sound.path,
    radius: sound.radius ?? 30,
    walls: !!sound.walls,
    volume: sound.volume ?? 0.5,
    repeat: true,
    channel,
    [`flags.${MODULE_ID}.autoGen`]: true,
  };

  const doc = (await token.parent.createEmbeddedDocuments("AmbientSound", [s]))[0];
  await token.update({ [`flags.${MODULE_ID}.attached.${sound.soundId}`]: doc.id });

  if (setPosition) refreshSoundPosition(token);
}

/**
 * Re-anchor every AmbientSound attached to `token` at the token's current centre,
 * batching all updates into a single embedded-document write.
 * @param {TokenDocument} token
 */
export function refreshSoundPosition(token) {
  const scene = token.parent;
  if (!game.user.isGM) {
    game.socket?.emit(`module.${MODULE_ID}`, {
      handlerName: "sound",
      args: { sceneId: scene.id, tokenId: token.id },
      type: "POSITIONS",
    });
    return;
  }

  const attached = token.getFlag(MODULE_ID, "attached") ?? {};
  const ambientSounds = [];
  for (const [soundId, ambientSoundId] of Object.entries(attached)) {
    const ambientSound = scene.sounds.get(ambientSoundId);
    if (ambientSound) ambientSounds.push(ambientSound);
    else token.update({ [`flags.${MODULE_ID}.attached.${soundId}`]: foundry.data.operators.ForcedDeletion });
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

/* ────────────────────────────────────────────────────────────────────────────
 *  One-shot (non-repeat) playback
 *  No AmbientSound document is ever created. Listener tokens are snapshotted at
 *  click time, every client plays locally if it owns at least one listener, and
 *  the GM schedules a single flag-clear after the audio's duration elapses.
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Resolve the audio URL (folder mode → random pick from the root of the folder),
 * compute listener tokens within radius at click time, and broadcast a play message
 * to every client. Non-GM forwards the request to the responsible GM.
 * @param {TokenDocument} token
 * @param {object} sound
 * @returns {Promise<void>}
 */
export async function playOneShot(token, sound) {
  if (!game.user.isGM) {
    game.socket?.emit(`module.${MODULE_ID}`, {
      handlerName: "sound",
      type: "ONESHOT_REQUEST",
      args: { sceneId: token.parent.id, tokenId: token.id, soundId: sound.soundId },
    });
    return;
  }

  let url = sound.path;
  if (sound.sourceMode === "folder") {
    url = await _pickRandomFromFolder(sound.path);
    if (!url) {
      ui.notifications?.warn(`Token Sounds: no audio files in folder "${sound.path}"`);
      await token.update({
        [`flags.${MODULE_ID}.playing.${sound.soundId}`]: foundry.data.operators.ForcedDeletion,
      });
      return;
    }
  }
  if (!url) {
    await token.update({
      [`flags.${MODULE_ID}.playing.${sound.soundId}`]: foundry.data.operators.ForcedDeletion,
    });
    return;
  }

  const channel = game.settings.get(MODULE_ID, "channel");
  const tokenIds = _computeListenersInRange(token, sound.radius ?? 30);

  const payload = {
    sceneId: token.parent.id,
    tokenId: token.id,
    soundId: sound.soundId,
    url,
    volume: sound.volume ?? 0.5,
    channel,
    tokenIds,
  };

  game.socket?.emit(`module.${MODULE_ID}`, {
    handlerName: "sound",
    type: "ONESHOT_PLAY",
    args: payload,
  });
  // game.socket.emit does not loop back; play locally for the GM.
  _onOneShotPlay(payload);

  await _scheduleOneShotEnd(token.parent.id, token.id, sound.soundId, url);
}

/**
 * Cancel a one-shot before its natural end (user toggled the tile off, or the
 * cleanup timer fires after duration). GM broadcasts; non-GM forwards.
 * @param {TokenDocument} token
 * @param {string} soundId
 */
export function stopOneShot(token, soundId) {
  if (!game.user.isGM) {
    game.socket?.emit(`module.${MODULE_ID}`, {
      handlerName: "sound",
      type: "ONESHOT_STOP_REQUEST",
      args: { sceneId: token.parent.id, tokenId: token.id, soundId },
    });
    return;
  }
  const payload = { sceneId: token.parent.id, tokenId: token.id, soundId };
  game.socket?.emit(`module.${MODULE_ID}`, {
    handlerName: "sound",
    type: "ONESHOT_STOP",
    args: payload,
  });
  _onOneShotStop(payload);
}

/**
 * Decide whether this client plays the broadcast one-shot. Plays for the GM
 * unconditionally; for players, only if they own at least one listener token.
 * @param {object} payload
 */
async function _onOneShotPlay(payload) {
  const { sceneId, tokenId, soundId, url, volume, channel, tokenIds } = payload;
  const scene = game.scenes.get(sceneId);
  if (!scene) return;

  const shouldPlay = game.user.isGM
    || tokenIds.some((id) => scene.tokens.get(id)?.isOwner);
  if (!shouldPlay) return;

  const key = `${tokenId}:${soundId}`;
  _stopLocalOneShot(key);

  const ctxSrc = game.audio?.[channel] ?? game.audio?.environment;
  const sound = game.audio.create({
    src: url,
    context: ctxSrc ? new AudioContext(ctxSrc) : undefined,
    singleton: false,
  });
  if (!sound) return;

  try {
    if (!sound.loaded) await sound.load();
    sound.play({ volume, loop: false });
    _activeOneShots.set(key, sound);
    const duration = sound.duration > 0 ? sound.duration : 0;
    // Local belt-and-suspenders cleanup, in case STOP broadcast races the natural end.
    setTimeout(() => _stopLocalOneShot(key), (duration + 1) * 1000);
  } catch (e) {
    console.warn(`${MODULE_ID} | Failed to play one-shot ${url}`, e);
    _activeOneShots.delete(key);
  }
}

/**
 * Cancel the local Sound for `<tokenId>:<soundId>` if one is registered.
 * @param {object} payload
 */
function _onOneShotStop(payload) {
  _stopLocalOneShot(`${payload.tokenId}:${payload.soundId}`);
}

/**
 * Stop and unregister the local one-shot Sound bound to `key`, if any.
 * @param {string} key
 */
function _stopLocalOneShot(key) {
  const sound = _activeOneShots.get(key);
  if (!sound) return;
  _activeOneShots.delete(key);
  try {
    if (sound.playing) sound.stop();
  } catch (e) {
    /* swallow: stopping a sound that already ended is harmless */
  }
}

/**
 * GM-side: probe the audio's duration once (loaded into the local audio context)
 * and schedule a single flag-clear after duration + 500ms padding. When the flag
 * is cleared, the standard updateToken hook triggers `stopOneShot` which broadcasts
 * a STOP to every client.
 * @param {string} sceneId
 * @param {string} tokenId
 * @param {string} soundId
 * @param {string} url
 */
async function _scheduleOneShotEnd(sceneId, tokenId, soundId, url) {
  let duration = 5;
  try {
    const probe = game.audio.create({ src: url, singleton: false });
    if (probe) {
      if (!probe.loaded) await probe.load();
      if (probe.duration > 0) duration = probe.duration;
    }
  } catch (e) {
    console.warn(`${MODULE_ID} | Probe duration failed for ${url}`, e);
  }
  setTimeout(() => _endOneShot(sceneId, tokenId, soundId), (duration + 0.5) * 1000);
}

/**
 * Clear the playing flag for a one-shot whose natural end has elapsed.
 * Idempotent: if the flag was already cleared (e.g. the user toggled the tile),
 * nothing happens.
 * @param {string} sceneId
 * @param {string} tokenId
 * @param {string} soundId
 */
function _endOneShot(sceneId, tokenId, soundId) {
  const token = game.scenes.get(sceneId)?.tokens.get(tokenId);
  if (!token) return;
  const playing = token.getFlag(MODULE_ID, "playing") ?? {};
  if (!(soundId in playing)) return;
  token.update({ [`flags.${MODULE_ID}.playing.${soundId}`]: foundry.data.operators.ForcedDeletion });
}

/**
 * Compute the ids of every token in `sourceToken.parent` whose centre lies within
 * `radius` grid units of `sourceToken`'s centre. The source token itself is included.
 * @param {TokenDocument} sourceToken
 * @param {number} radius In grid distance units (e.g. "feet").
 * @returns {string[]}
 */
function _computeListenersInRange(sourceToken, radius) {
  const scene = sourceToken.parent;
  if (!scene) return [];
  const size = canvas.dimensions?.size ?? scene.grid?.size ?? 100;
  const dist = canvas.dimensions?.distance ?? scene.grid?.distance ?? 5;
  const pxPerUnit = size / dist;
  const r2 = (radius * pxPerUnit) ** 2;

  const cx = sourceToken._source.x + (sourceToken.width * size) / 2;
  const cy = sourceToken._source.y + (sourceToken.height * size) / 2;

  const ids = [];
  for (const t of scene.tokens) {
    const tx = t._source.x + (t.width * size) / 2;
    const ty = t._source.y + (t.height * size) / 2;
    if ((tx - cx) ** 2 + (ty - cy) ** 2 <= r2) ids.push(t.id);
  }
  return ids;
}

/**
 * List the root of `folderPath`, filter to known audio extensions, and return one
 * file URL chosen uniformly at random. Returns null on browse error or empty pool.
 * Subdirectories are not recursed.
 * @param {string} folderPath
 * @returns {Promise<string|null>}
 */
async function _pickRandomFromFolder(folderPath) {
  if (!folderPath) return null;
  const FPCls = foundry.applications.apps.FilePicker.implementation ?? foundry.applications.apps.FilePicker;
  try {
    const res = await FPCls.browse("data", folderPath);
    const files = (res?.files ?? []).filter((f) => {
      const lc = f.toLowerCase();
      return AUDIO_EXTENSIONS.some((ext) => lc.endsWith(ext));
    });
    if (!files.length) return null;
    return files[Math.floor(Math.random() * files.length)];
  } catch (e) {
    console.warn(`${MODULE_ID} | Failed to browse folder ${folderPath}`, e);
    return null;
  }
}
