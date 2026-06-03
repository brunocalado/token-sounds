# 0.0.2

## [Fixed]
- Ícone pulsante verde (`fa-beat`) não aparece mais em sons non-repeat; o efeito visual de loop agora é exclusivo de sons com `repeat: true`.
- Imagem do tile de som non-repeat não some mais durante a reprodução: a classe CSS `playing` (que esconde o `<img>`) agora só é aplicada em sons repeat.
- Botão Remove agora deleta o som de fato. O `setFlag` (read-modify-write) anterior não removia a entrada porque o update do Foundry é recursivo por padrão e mesclava o mapa de volta com a chave que tentávamos apagar. Agora usa `unsetFlag(MODULE_ID, "sounds.<id>")`, a API canônica de deleção (sem aviso de `-=key` legado).
- Clique com o botão direito em um tile do HUD não abre mais o menu de contexto nativo do browser. O `stopPropagation` impedia o handler do canvas (que normalmente chama `preventDefault`) de rodar, então agora chamamos `preventDefault` explicitamente no listener do tile.
- Sons non-repeat (toque único) agora tocam a cada clique. O clique era um toggle do flag `playing` persistente, então o segundo clique (enquanto o flag ainda estava setado durante a reprodução) parava o som em vez de tocá-lo de novo. Agora sons non-repeat disparam `playOneShot` diretamente a cada clique, sem usar o flag de toggle; sons repeat continuam como liga/desliga.
- Som repeat agora desliga ao clicar novamente no tile. Os handlers detectavam o "parar" lendo o delta do `change` e comparando com `ForcedDeletion`, mas deleções de flag não voltam como uma entrada legível por chave — então o tile continuava verde e o `AmbientSound` seguia tocando. A reconciliação agora é feita contra o estado real do flag `playing` (via `stopSounds`/`playSounds`), independente do formato do delta, e o desligamento usa `unsetFlag`.
- Remover um som repeat ativo agora também para o `AmbientSound` acoplado ao token. Antes, remover o som apagava só a definição no ator; o flag `playing`/`attached` no token persistia e o som tocava para sempre. Agora os flags `playing` órfãos (de sons que não existem mais) são limpos e o `AmbientSound` é destruído na reconciliação.
- `stopSounds` sem `soundIds` agora itera os sons `attached` (os candidatos a parar) em vez do flag `playing` — que não inclui mais um som recém-desligado, fazendo a reconciliação completa ignorá-lo.
- Som repeat agora pode ser ligado/desligado quantas vezes quiser. O flag `attached` era limpo com `ForcedDeletion`, que não removia a chave de fato; o `attached` órfão (apontando para um `AmbientSound` já deletado) bloqueava a recriação no próximo play. Agora `deleteSound` limpa `attached` com `unsetFlag` (assíncrono e aguardado).
- Remover um som repeat ativo não gera mais o erro `AmbientSound "..." does not exist!`. Como `attached` não era limpo, a reconciliação redundante chamava `deleteSound` de novo sobre o `AmbientSound` já deletado. A limpeza de órfãos agora destrói o `AmbientSound` e limpa `attached` antes de limpar `playing`, e todo o caminho de teardown (`deleteSound`/`deleteSoundDocument`/`stopSounds`) é assíncrono e aguardado, eliminando a corrida de duplo-delete.
- Demais limpezas do flag `playing` (API `SoundOfToken.stop`, fim natural de one-shot, limpeza no `canvasReady`, caminhos de erro do `playOneShot`) e do flag `attached` (`refreshSoundPosition`) migradas de `ForcedDeletion` para `unsetFlag`, que remove a chave de forma confiável neste build do Foundry V14.
- Tooltip "Right-click to enable Player editing." não aparece mais ao passar o mouse sobre os tiles de som ou o botão `+` do soundboard. O painel é renderizado dentro do botão do HUD (que tem o `data-tooltip`), então o `closest("[data-tooltip]")` do Foundry subia até ele; o wrapper agora tem `data-tooltip=""` próprio, suprimindo o tooltip do pai. Os tooltips nativos (`title`) dos tiles e do `+` continuam funcionando.
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
