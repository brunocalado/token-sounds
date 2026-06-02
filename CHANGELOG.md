# 0.0.2

## [Fixed]
- Sons non-repeat agora são removidos corretamente quando expiram, mesmo após reload do GM.
- Audio buffer duration é carregado de forma confiável antes de agendar cleanup.

## [Changed]
- Sistema de cleanup de sons non-repeat substituído: canvas ticker → setTimeout direto. Mais preciso e sem polling.
- Adicionado hook `reconcileNonRepeat` em `canvasReady` para resgatar timers pendentes após reload do GM.
