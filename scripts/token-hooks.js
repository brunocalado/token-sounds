import { MODULE_ID } from "./constants.js";
import { openSoundConfig } from "./sound-config.js";
import {
  deleteSound,
  deleteToken,
  playOneShot,
  playSounds,
  refreshSoundPosition,
  stopSounds,
} from "./token-sounds.js";

/**
 * Wire every Token/Actor lifecycle hook the module reacts to. Called once from the `init` hook.
 */
export function registerTokenHooks() {
  Hooks.on("canvasReady", async () => {
    if (!game.user.isGM) return;
    for (const token of canvas.tokens.placeables) {
      await _cleanupStuckOneShots(token.document);
      playSounds(token.document);
    }
  });

  // A freshly created token must not inherit the previous template token's attached AmbientSound ids.
  Hooks.on("preCreateToken", (token, data, options, userId) => {
    if (game.user.id === userId && data.flags?.[MODULE_ID]?.attached) {
      token.updateSource({ [`flags.${MODULE_ID}.attached`]: foundry.data.operators.ForcedDeletion });
    }
  });

  Hooks.on("createToken", (token, opts, userId) => {
    if (game.user.id === userId) playSounds(token);
  });

  Hooks.on("deleteToken", (token, opts, userId) => {
    if (game.user.id === userId) deleteToken(token);
  });

  Hooks.on("updateToken", async (token, change, options, userId) => {
    // Sync soundboard tile and HUD button state for every client when playing changes.
    // Re-derive every tile from the live playing flag rather than the change delta:
    // flag deletions don't round-trip as readable per-key entries, so a delta-based
    // read would leave a toggled-off tile stuck in its playing state.
    if (change.flags?.[MODULE_ID]?.playing) {
      const hud = canvas.tokens.hud;
      if (hud.object?.document === token) {
        const dataSource = game.actors.get(token.actorId) ?? token;
        const allSounds = dataSource.getFlag(MODULE_ID, "sounds") ?? {};
        const playing = token.getFlag(MODULE_ID, "playing") ?? {};
        for (const soundEl of hud.element?.querySelectorAll(".sound") ?? []) {
          const soundId = soundEl.dataset.soundId;
          // Only repeat sounds use the `playing` CSS class: it hides the img and shows the
          // fa-beat icon. Non-repeat (one-shot) tiles keep their image visible at all times.
          const active = !!playing[soundId] && !!allSounds[soundId]?.repeat;
          soundEl.classList.toggle("playing", active);
          const icon = soundEl.querySelector("i.fa-volume");
          if (active && !icon) {
            const i = document.createElement("i");
            i.classList.add("fa-solid", "fa-volume", "fa-beat");
            soundEl.appendChild(i);
          } else if (!active) {
            icon?.remove();
          }
        }
        const button = hud.element?.querySelector(".control-icon.token-sounds");
        if (button) button.classList.toggle("playing", !foundry.utils.isEmpty(playing));
      }
    }

    if (game.user.id !== userId) return;

    const flags = change.flags?.[MODULE_ID];
    if (flags) {
      const dataSource = game.actors.get(token.actorId) ?? token;
      const allSounds = dataSource.getFlag(MODULE_ID, "sounds") ?? {};

      // Sounds map changed on the token itself (unlinked): drop playing flags for
      // entries that no longer exist so their attached AmbientSounds get torn down.
      if (flags.sounds) await _clearOrphanedPlaying(token, allSounds);

      // Reconcile repeat-mode AmbientSounds against the live playing flag: stopSounds
      // tears down every attached sound no longer marked playing, playSounds (re)creates
      // those now marked playing. This is delta-agnostic, so toggling a sound off works
      // even though the cleared flag key is absent from the change. One-shots no longer
      // touch this flag — they are dispatched directly on click.
      if (flags.sounds || flags.playing) {
        await stopSounds(token);
        await playSounds(token);
      }
    }
    if ("x" in change || "y" in change || "width" in change || "height" in change) {
      refreshSoundPosition(token);
    }
  });

  Hooks.on("updateActor", async (actor, change, options, userId) => {
    if (game.user.id !== userId) return;
    if (!change.flags?.[MODULE_ID]) return;
    const soundsChanged = change.flags[MODULE_ID].sounds !== undefined;
    const sounds = actor.getFlag(MODULE_ID, "sounds") ?? {};
    for (const t of actor.getActiveTokens(false, true)) {
      // A removed sound leaves its playing/attached flags behind on the token; clear the
      // orphaned playing flag first so the reconcile below tears down its AmbientSound.
      if (soundsChanged) await _clearOrphanedPlaying(t, sounds);
      await stopSounds(t);
      await playSounds(t);
      if (soundsChanged) await _refreshHudSoundboard(t);
    }
  });

  Hooks.on("renderTokenHUD", (hud, html, token) => {
    if (!hud._soundBoard || hud._soundBoard.id !== hud.object.id)
      hud._soundBoard = { id: hud.object.id, active: false };

    const actor = game.actors.get(token.actorId);
    if (!actor) return;
    const sounds = actor.getFlag(MODULE_ID, "sounds");
    const allowPlayerEdit = actor.getFlag(MODULE_ID, "allowPlayerEdit");
    if (!(game.user.isGM || allowPlayerEdit) && foundry.utils.isEmpty(sounds)) return;

    const playing = !foundry.utils.isEmpty(foundry.utils.getProperty(token, `flags.${MODULE_ID}.playing`));

    const button = document.createElement("button");
    button.type = "button";
    button.classList.add("control-icon", "token-sounds");
    if (playing) button.classList.add("playing");
    button.dataset.action = "token-sounds";
    button.dataset.tooltip = game.user.isGM ? "Right-click to enable Player editing." : "";

    const icon = document.createElement("i");
    icon.classList.add("toggle-edit", "fas", "fa-waveform-path");
    button.appendChild(icon);

    if (allowPlayerEdit && game.user.isGM) {
      const lockIcon = document.createElement("i");
      lockIcon.classList.add("player-edit", "fa-solid", "fa-unlock-keyhole", "fa-2xs");
      button.appendChild(lockIcon);
    }

    html.querySelector("div.right").appendChild(button);

    button.addEventListener("click", (event) => _onButtonClick(event, hud));

    if (game.user.isGM) {
      button.addEventListener("contextmenu", () => {
        const currentEdit = actor.getFlag(MODULE_ID, "allowPlayerEdit");
        actor.setFlag(MODULE_ID, "allowPlayerEdit", !currentEdit);
      });
    }

    if (hud._soundBoard.id === hud.object.id && hud._soundBoard.active) {
      button.dispatchEvent(new Event("click"));
    }
  });
}

/**
 * On canvasReady, clear any non-repeat `playing` flag that survived the last session.
 * Repeat-mode sounds are re-created in `playSounds`; non-repeat ones must never auto-replay,
 * so the flag is force-deleted to bring the UI back in sync.
 * @param {TokenDocument} token
 * @returns {Promise<void>}
 */
async function _cleanupStuckOneShots(token) {
  const dataSource = game.actors.get(token.actorId) ?? token;
  const sounds = dataSource.getFlag(MODULE_ID, "sounds") ?? {};
  const playing = token.getFlag(MODULE_ID, "playing") ?? {};
  for (const soundId of Object.keys(playing)) {
    const s = sounds[soundId];
    if (s && !s.repeat) await token.unsetFlag(MODULE_ID, `playing.${soundId}`);
  }
}

/**
 * Clear the `playing` flag for every sound id no longer present in `sounds` (e.g. a
 * sound the user just removed). Clearing it lets the standard reconcile tear down the
 * sound's orphaned AmbientSound, which would otherwise keep playing forever.
 * @param {TokenDocument} token
 * @param {object} sounds Current sound definitions keyed by soundId.
 * @returns {Promise<void>}
 */
async function _clearOrphanedPlaying(token, sounds) {
  const playing = token.getFlag(MODULE_ID, "playing") ?? {};
  const attached = token.getFlag(MODULE_ID, "attached") ?? {};
  const orphans = new Set([...Object.keys(playing), ...Object.keys(attached)].filter((id) => !sounds[id]));

  for (const soundId of orphans) {
    // Tear down the orphan's AmbientSound and clear `attached` first, so the reconcile
    // triggered by clearing `playing` below finds nothing left to delete (no double-delete).
    if (attached[soundId]) await deleteSound(token, soundId, attached[soundId]);
    if (soundId in playing) await token.unsetFlag(MODULE_ID, `playing.${soundId}`);
  }
}

/**
 * Click handler for the soundboard HUD button. Toggles the menu open/closed and lazily renders
 * it (with all child listeners) on first open.
 * @param {Event} event
 * @param {object} hud The TokenHUD instance.
 */
async function _onButtonClick(event, hud) {
  const button = event.currentTarget;
  const token = hud.object.document;
  const actor = game.actors.get(token.actorId);

  button.classList.toggle("active");
  hud._soundBoard.active = button.classList.contains("active");

  let wrapper = button.querySelector(".token-sounds-wrapper");
  if (button.classList.contains("active")) {
    if (!wrapper) {
      wrapper = await renderMenu(token);
      if (!wrapper) return;
      const icon = button.querySelector("i");
      icon.after(wrapper);
      _bindMenuListeners(wrapper, token, actor);
    }
    wrapper.classList.add("active");
  } else if (wrapper) {
    wrapper.classList.remove("active");
  }
}

/**
 * Attach every menu-internal listener exactly once, when the menu is first created.
 * @param {HTMLElement} wrapper
 * @param {TokenDocument} token
 * @param {Actor|undefined} actor
 */
function _bindMenuListeners(wrapper, token, actor) {
  wrapper.querySelectorAll(".sound.editable").forEach((el) => {
    el.addEventListener("contextmenu", (e) => {
      // Suppress the native browser context menu: stopPropagation alone keeps the canvas
      // handler (which normally calls preventDefault) from running, so do it explicitly here.
      e.preventDefault();
      // Prevent canvas contextmenu handler from dismissing the HUD while the config sheet opens.
      e.stopPropagation();
      _onSoundRightClick(e, actor);
    });
  });

  const addBtn = wrapper.querySelector(".add-sound");
  if (addBtn) addBtn.addEventListener("click", (e) => _onAddSoundClick(e, actor));

  const sounds = wrapper.querySelectorAll(".sound");
  sounds.forEach((soundEl) => {
    soundEl.addEventListener("click", (e) => _onSoundClick(e, token));
  });

  let draggedSoundId;
  sounds.forEach((soundEl) => {
    soundEl.addEventListener("dragstart", (e) => {
      draggedSoundId = e.target.closest(".sound")?.dataset.soundId;
    });
    soundEl.addEventListener("dragover", (e) => {
      e.preventDefault();
      const sound = e.target.closest(".sound");
      if (!sound || sound.dataset.soundId === draggedSoundId) return;

      const domRect = e.currentTarget.getBoundingClientRect();
      const prc = e.offsetX / domRect.width;
      if (prc < 0.2) {
        sound.classList.remove("drag-right");
        sound.classList.add("drag-left");
      } else {
        sound.classList.remove("drag-left");
        sound.classList.add("drag-right");
      }
    });
    soundEl.addEventListener("dragleave", (e) => {
      e.target.closest(".sound")?.classList.remove("drag-left", "drag-right");
    });
    soundEl.addEventListener("drop", (e) => {
      const sound = e.target.closest(".sound");
      if (!sound) return;
      _onSoundOrder(draggedSoundId, sound.dataset.soundId, actor, sound.classList.contains("drag-left"));
      sound.classList.remove("drag-left", "drag-right");
    });
  });
}

/**
 * Open the module-native sound config sheet when the user right-clicks an editable sound.
 * @param {Event} event
 * @param {Actor|undefined} dataSource
 */
function _onSoundRightClick(event, dataSource) {
  if (!dataSource) return;
  const soundEl = event.target.closest(".sound");
  if (!soundEl) return;
  const soundId = soundEl.dataset.soundId;
  const sound = (dataSource.getFlag(MODULE_ID, "sounds") ?? {})[soundId];
  if (sound) openSoundConfig(sound, dataSource, false);
}

/**
 * Open the module-native sound config sheet in "create" mode from the + button.
 * @param {Event} event
 * @param {Actor|undefined} dataSource
 */
function _onAddSoundClick(event, dataSource) {
  event.stopPropagation();
  if (dataSource) openSoundConfig({}, dataSource, true);
}

/**
 * Build the soundboard panel HTML for `token` and return it as a detached HTMLElement.
 * @param {TokenDocument} token
 * @returns {Promise<HTMLElement|undefined>}
 */
async function renderMenu(token) {
  const playing = token.getFlag(MODULE_ID, "playing") ?? {};

  const actor = game.actors.get(token.actorId);
  if (!actor) return;
  const sounds = Object.values(foundry.utils.deepClone(actor.getFlag(MODULE_ID, "sounds") ?? {})).sort(
    (s1, s2) => (s1.sort ?? 0) - (s2.sort ?? 0),
  );

  sounds.forEach((s) => {
    s.playing = s.soundId in playing;
    s.playingRepeat = s.playing && !!s.repeat;
    if (!s.img) s.img = "icons/svg/sound.svg";
  });

  const allowPlayerEdit = actor.getFlag(MODULE_ID, "allowPlayerEdit");
  const editable = game.user.isGM || allowPlayerEdit;

  const html = await foundry.applications.handlebars.renderTemplate(
    `modules/${MODULE_ID}/templates/sound-board.hbs`,
    { sounds, editable },
  );

  const template = document.createElement("template");
  template.innerHTML = html.trim();
  return template.content.firstElementChild;
}

/**
 * Re-render the open soundboard panel for `token` in-place, preserving the active
 * state. Called after the actor's `sounds` flag changes (add, edit, delete) so the
 * HUD tiles immediately reflect the new state without requiring a manual close/reopen.
 * @param {TokenDocument} token
 * @returns {Promise<void>}
 */
async function _refreshHudSoundboard(token) {
  const hud = canvas.tokens.hud;
  if (hud.object?.document !== token) return;
  if (!hud._soundBoard?.active) return;

  const button = hud.element?.querySelector(".control-icon.token-sounds");
  if (!button) return;

  const actor = game.actors.get(token.actorId);
  if (!actor) return;

  button.querySelector(".token-sounds-wrapper")?.remove();

  const wrapper = await renderMenu(token);
  if (!wrapper) {
    hud._soundBoard.active = false;
    return;
  }

  const icon = button.querySelector("i");
  icon.after(wrapper);
  wrapper.classList.add("active");
  _bindMenuListeners(wrapper, token, actor);
}

/**
 * Toggle a single sound's playing flag when its tile is clicked.
 * @param {Event} event
 * @param {TokenDocument} token
 */
function _onSoundClick(event, token) {
  event.stopPropagation();
  if (!token) return;

  const soundId = event.target.closest(".sound")?.dataset.soundId;
  if (!soundId) return;

  const dataSource = game.actors.get(token.actorId) ?? token;
  const sound = (dataSource.getFlag(MODULE_ID, "sounds") ?? {})[soundId];
  if (!sound) return;

  // Non-repeat sounds are one-shots: every click must fire a fresh playback.
  // Dispatch directly instead of toggling the persistent `playing` flag — a
  // toggle would stop the sound on the second click and refuse to replay while
  // the previous play's flag is still set (it lingers until the sound ends).
  if (!sound.repeat) {
    playOneShot(token, sound);
    return;
  }

  // Repeat sounds are on/off: toggle the persistent `playing` flag. Use unsetFlag to
  // clear it (rather than a ForcedDeletion value) so the flag is actually removed and
  // the updateToken reconcile tears down the attached AmbientSound.
  const playing = (token.getFlag(MODULE_ID, "playing") ?? {})[soundId];
  if (playing) token.unsetFlag(MODULE_ID, `playing.${soundId}`);
  else token.update({ [`flags.${MODULE_ID}.playing.${soundId}`]: true });
}

/**
 * Apply drag-and-drop sort changes to the actor's sound list.
 * @param {string} sourceId
 * @param {string} targetId
 * @param {Actor|undefined} actor
 * @param {boolean} [sortBefore=false]
 */
function _onSoundOrder(sourceId, targetId, actor, sortBefore = false) {
  if (!(sourceId && targetId && actor)) return;
  if (sourceId === targetId) return;

  const sounds = Object.values(actor.getFlag(MODULE_ID, "sounds") ?? {});

  const source = sounds.find((s) => s.soundId === sourceId);
  const target = sounds.find((s) => s.soundId === targetId);
  if (!(source && target)) return;

  const siblings = sounds.filter((s) => s.soundId !== sourceId);
  const result = foundry.utils.performIntegerSort(source, { target, siblings, sortBefore });

  if (result.length) {
    const update = {};
    for (const r of result) {
      update[r.target.soundId] = r.update;
    }
    actor.update({ [`flags.${MODULE_ID}.sounds`]: update });
  }
}
