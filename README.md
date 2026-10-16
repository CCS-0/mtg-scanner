# Acervo MTG — Scanner v0.3.1

Versão de ajuste óptico do scanner.

## Mudança principal

A moldura ficou menor por padrão e passou a ser ajustável.

O objetivo é permitir que o celular fique fisicamente mais distante da carta, onde muitas câmeras conseguem focar melhor o nome e o rodapé. Para OCR, uma imagem menor mas realmente nítida costuma ser melhor que uma imagem maior fora de foco.

### Como usar

1. Afaste o celular até o nome e o rodapé ficarem visivelmente nítidos.
2. Abra `Ajustes da câmera`.
3. Ajuste `Tamanho da moldura` para coincidir com o tamanho aparente da carta.
4. O valor fica salvo no navegador para os próximos usos.
5. O scanner espera um pouco mais pela nitidez antes da captura automática.

## Fluxo

1. detector leve encontra a carta;
2. espera estabilidade + nitidez;
3. captura;
4. carrega Tesseract.js somente na primeira análise;
5. OCR da faixa de nome;
6. OCR da faixa inferior;
7. tenta extrair:
   - nome;
   - set;
   - collector number;
   - idioma;
8. consulta Scryfall:
   - primeiro tenta `set + collector number`;
   - se isso falhar, faz busca fuzzy pelo nome;
9. exibe:
   - carta identificada;
   - ou impressão exata, quando houver dados suficientes.

## Por que o OCR não roda em vídeo

Tesseract.js usa WebAssembly + Web Worker e é mais pesado que o detector leve.
Rodá-lo somente após a captura evita o problema de travamento que tivemos com OpenCV contínuo.

## Primeira utilização

A primeira análise demora mais porque o navegador precisa baixar:
- Tesseract.js;
- core WebAssembly;
- dados do idioma inglês.

Nas análises seguintes, o worker é reutilizado.

## O que testar

Use primeiro cartas modernas, em inglês, sem sleeve e com boa iluminação.

Anote para cada carta:
- OCR do nome;
- OCR do rodapé;
- se encontrou nome no Scryfall;
- se encontrou impressão exata.

## Limitação esperada

Nesta etapa, acertar o nome é mais importante que acertar a impressão.

A impressão exata depende muito mais do texto minúsculo do rodapé. Se isso continuar instável, a próxima melhoria será captura fotográfica em resolução máxima / matching visual da arte.

## GitHub Pages

Substitua:
- index.html
- app.js
- styles.css
- manifest.webmanifest
- README.md

Confirme `Scanner v0.3.1`.

## Dependências externas

Tesseract.js v5 é carregado sob demanda via jsDelivr.
Scryfall é consultado diretamente pelo navegador.
