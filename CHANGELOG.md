# 0.0.2

## [Fixed]
- Ícone pulsante verde (`fa-beat`) não aparece mais em sons non-repeat; o efeito visual de loop agora é exclusivo de sons com `repeat: true`.
- Imagem do tile de som non-repeat não some mais durante a reprodução: a classe CSS `playing` (que esconde o `<img>`) agora só é aplicada em sons repeat.
- Botão Remove agora deleta o som com `setFlag` (read-modify-write explícito) em vez de `ForcedDeletion` em caminho aninhado, garantindo que a deleção funcione em qualquer build do Foundry V14.
- Após o Remove, o painel do soundboard é atualizado imediatamente via `_refreshHudSoundboard` acionado pelo hook `updateActor`.
- Contextmenu no tile não fecha mais o HUD inadvertidamente (adicionado `stopPropagation`).
- `updateActor` agora usa `for...of` com `await` em vez de `forEach` com callback async, garantindo que `playSounds` complete antes de `_refreshHudSoundboard` reconstruir o painel.
- Selector de Source (radio buttons) agora detecta corretamente o radio marcado; snap de "Folder" → "Single" ao ativar Repeat funciona para radio buttons.

## [Added]
- Efeito de hover verde (`rgba(173, 255, 47, 0.2)`) nos tiles do soundboard via pseudo-elemento `::after`.

## [Fixed]
- `SoundConfigSheet` (botão "+" do soundboard) voltou a abrir como janela flutuante. A definição incorreta de `BASE_APPLICATION` apontando para a própria classe fazia o Foundry ignorar as `DEFAULT_OPTIONS` da `ApplicationV2` (`window.frame`/`window.positioned`): o formulário era inserido no fluxo do documento — não abria de fato e empurrava o sidebar direito para a esquerda.
- Sons non-repeat agora são removidos corretamente quando expiram, mesmo após reload do GM.
- Duration do áudio agora é lida do buffer decoded no momento do play, garantindo que o timer sempre seja agendado.
- Ícone de estado desligado (imagem do tile) não aparece mais ao mesmo tempo que o ícone verde pulsante.
- Botão e tiles do soundboard revertem ao estado desligado automaticamente quando um som non-repeat termina.
- Removido erro no console sobre sintaxe de deleção legada (`-=key`); migrado para `foundry.data.operators.ForcedDeletion` em todos os arquivos.
- **Sons non-repeat agora tocam apenas uma vez e o botão desativa imediatamente.** Listener snapshot é capturado no momento do clique, eliminando replays ao mover tokens ou entrar no raio de audição.

## [Added]
- `SoundEntry` DataModel com validação de tipo para campos de configuração de som.
- `SoundConfigSheet` — AppV2 sheet módulo nativo substituindo o dialog padrão do Foundry.
- Template `sound-config.hbs` com campos dinâmicos condicionais e visibility controlada por toggles.
- Stylesheet `sound-config.css` com design opaco e scoping CSS isolado.
- Slider de volume com exibição de percentual em tempo real.
- Suporte a folder mode para seleção aleatória de arquivos de áudio da raiz da pasta.
- Sistema de socket para sincronização de playback de sons non-repeat entre clientes.
- Funções `playOneShot()` e `stopOneShot()` para gerenciamento de playback único.
- Funções auxiliares `_computeListenersInRange()` para snapshot de tokens ouvintes e `_pickRandomFromFolder()` para seleção aleatória.
- Setting global `channel` para roteamento de áudio (interface/music/environment).
- Limpeza automática de flags `playing` de non-repeat em `canvasReady` para evitar replays após reload.

## [Changed]
- Arquitetura de non-repeat: transição de AmbientSound persistente para one-shot baseado em socket com snapshot de listeners.
- `playSounds()` agora pula sons non-repeat (gerenciados por `playOneShot`).
- Patching de AmbientSound limitado apenas a sons repeat; non-repeat não mais usa AmbientSound.
- `token-hooks.js` atualizado para usar nova `SoundConfigSheet` e branching condicional por tipo de som.
- Dinâmica de UI: repeat toggle controla visibilidade de `sourceMode`, `walls` toggle e campo `radius`.

## [Removed]
- `ambient-sound-custom-config.js` — classe `AmbientSoundCustomConfig` substituída por module-native AppV2.
- `SETTINGS.nonRepeat` array persistente de cleanup.
- Funções `reconcileNonRepeat()`, `endNonRepeatEarly()`, `_cleanupNonRepeat()`, `scheduleNonRepeatCleanup()`.
- Lógica de agendamento non-repeat em `sync()` patch.
