# 0.0.2

## [Fixed]
- Sons non-repeat agora são removidos corretamente quando expiram, mesmo após reload do GM.
- Duration do áudio agora é lida do buffer decoded no momento do play, garantindo que o timer sempre seja agendado.
- Ícone de estado desligado (imagem do tile) não aparece mais ao mesmo tempo que o ícone verde pulsante.
- Botão e tiles do soundboard revertem ao estado desligado automaticamente quando um som non-repeat termina.
- Removido erro no console sobre sintaxe de deleção legada (`-=key`); migrado para `foundry.data.operators.ForcedDeletion` em todos os arquivos.

## [Changed]
- Sistema de cleanup de sons non-repeat substituído: canvas ticker → setTimeout direto. Mais preciso e sem polling.
- Adicionado hook `reconcileNonRepeat` em `canvasReady` para resgatar timers pendentes após reload do GM.
