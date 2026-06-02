import { MODULE_ID } from "./constants.js";
import { openSoundConfig } from "./sound-config.js";
import {
  deleteToken,
  playOneShot,
  playSounds,
  refreshSoundPosition,
  stopOneShot,
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
    const playingChange = change.flags?.[MODULE_ID]?.playing;
    if (playingChange) {
      const hud = canvas.tokens.hud;
      if (hud.object?.document === token) {
        for (const [soundId, play] of Object.entries(playingChange)) {
          const soundEl = hud.element?.querySelector(`.sound[data-sound-id="${soundId}"]`);
          if (!soundEl) continue;
          const isStopped = play === foundry.data.operators.ForcedDeletion || !play;
          soundEl.classList.toggle("playing", !isStopped);
          if (isStopped) {
            soundEl.querySelector("i.fa-volume")?.remove();
          } else if (!soundEl.querySelector("i.fa-volume")) {
            const icon = document.createElement("i");
            icon.classList.add("fa-solid", "fa-volume", "fa-beat");
            soundEl.appendChild(icon);
          }
        }
        const button = hud.element?.querySelector(".control-icon.token-sounds");
        if (button) {
          const stillPlaying = !foundry.utils.isEmpty(token.getFlag(MODULE_ID, "playing") ?? {});
          button.classList.toggle("playing", stillPlaying);
        }
      }
    }

    if (game.user.id !== userId) return;

    const flags = change.flags?.[MODULE_ID];
    if (flags) {
      const dataSource = game.actors.get(token.actorId) ?? token;
      const allSounds = dataSource.getFlag(MODULE_ID, "sounds") ?? {};

      if (flags.sounds) {
        for (const [soundId, val] of Object.entries(flags.sounds)) {
          if (val === foundry.data.operators.ForcedDeletion) {
            stopSounds(token, [soundId]);
          } else {
            stopSounds(token, [soundId]);
            // Only repeat sounds get auto-(re)started on config edit.
            // Non-repeat entries are user-triggered one-shots and must not fire on save.
            if (allSounds[soundId]?.repeat) playSounds(token, [soundId]);
          }
        }
      }

      if (flags.playing) {
        for (const [soundId, play] of Object.entries(flags.playing)) {
          const sound = allSounds[soundId];
          if (!sound) continue;
          const stopping = play === foundry.data.operators.ForcedDeletion || !play;
          if (sound.repeat) {
            if (stopping) stopSounds(token, [soundId]);
            else playSounds(token, [soundId]);
          } else {
            if (stopping) stopOneShot(token, soundId);
            else playOneShot(token, sound);
          }
        }
      }
    }
    if ("x" in change || "y" in change || "width" in change || "height" in change) {
      refreshSoundPosition(token);
    }
  });

  Hooks.on("updateActor", async (actor, change, options, userId) => {
    if (game.user.id !== userId) return;
    if (!change.flags?.[MODULE_ID]) return;
    actor.getActiveTokens(false, true).forEach((t) => {
      stopSounds(t);
      playSounds(t);
    });
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
  const update = {};
  let dirty = false;
  for (const soundId of Object.keys(playing)) {
    const s = sounds[soundId];
    if (s && !s.repeat) {
      update[`flags.${MODULE_ID}.playing.${soundId}`] = foundry.data.operators.ForcedDeletion;
      dirty = true;
    }
  }
  if (dirty) await token.update(update);
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
    el.addEventListener("contextmenu", (e) => _onSoundRightClick(e, actor));
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
 * Toggle a single sound's playing flag when its tile is clicked.
 * @param {Event} event
 * @param {TokenDocument} token
 */
function _onSoundClick(event, token) {
  event.stopPropagation();
  if (!token) return;

  const soundId = event.target.closest(".sound")?.dataset.soundId;
  if (!soundId) return;

  const playing = (token.getFlag(MODULE_ID, "playing") ?? {})[soundId];
  const update = {};

  if (playing) update[`flags.${MODULE_ID}.playing.` + soundId] = foundry.data.operators.ForcedDeletion;
  else update[`flags.${MODULE_ID}.playing.` + soundId] = true;

  token.update(update);
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
