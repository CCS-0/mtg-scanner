# Acervo MTG — Scanner v0.2.5

## Objetivo desta versão

Melhorar a legibilidade da parte inferior da carta antes de avançar para OCR.

### Mudanças
- solicita câmera traseira com resolução ideal 1920 × 1080;
- aceita até 3840 × 2160 se o aparelho/navegador decidir fornecer;
- mostra a resolução REAL do stream;
- consulta capacidades da câmera com `getCapabilities()`;
- solicita `focusMode: continuous` quando disponível;
- oferece slider de zoom quando o navegador expõe essa capacidade;
- calcula uma métrica de nitidez especificamente na faixa inferior;
- captura automática somente após:
  - carta detectada;
  - carta estável;
  - faixa inferior acima do limiar de nitidez;
- aumenta o arquivo recortado para 1260 × 1760.

## Importante

Aumentar o canvas de saída não cria detalhe que a câmera não capturou. O indicador "Stream real" é o dado mais importante.

Se o navegador estiver entregando somente 1280 × 720, o texto muito pequeno terá limite físico.

## Teste

1. Abra a câmera.
2. Veja `Stream real`.
3. Coloque a carta na moldura.
4. Observe `Nitidez da faixa inferior`.
5. Quando a carta estiver estável mas a nitidez estiver baixa, o app mostrará:
   `Carta estável — aguardando foco na faixa inferior`.
6. Quando atingir o limiar:
   `Carta estável e nítida`.
7. A captura ocorre.

## Ajuste

Se nenhuma carta captura mesmo parecendo bem focada:
- reduza `Nitidez mínima da faixa inferior` de 8 para 6.

Se estiver capturando com texto borrado:
- aumente para 10 ou 12.

## Próxima etapa

Depois de validar a nitidez:
- OCR da faixa de nome;
- OCR da região inferior;
- matching com Scryfall.
