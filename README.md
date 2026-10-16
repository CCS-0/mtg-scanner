# Acervo MTG — Scanner v0.3.4

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

Confirme `Scanner v0.3.4`.

## Dependências externas

Tesseract.js v5 é carregado sob demanda via jsDelivr.
Scryfall é consultado diretamente pelo navegador.


## Ajuste v0.3.4

O tamanho mínimo da moldura foi reduzido de 48% para 35%.

Faixa atual:
- mínimo: 35%
- máximo: 76%

Isso permite afastar mais o celular da carta para buscar uma distância de foco melhor.


## Ajuste v0.3.4 — toque para focar

A moldura padrão passa a ser 45%.

Depois de abrir a câmera, toque diretamente sobre a área que quer priorizar:
- nome da carta; ou
- rodapé / collector number.

O scanner consulta as capacidades expostas pelo navegador:

1. `pointsOfInterest` + `focusMode`:
   tenta focar exatamente no ponto tocado.
2. apenas `single-shot`:
   o toque solicita um novo ciclo de autofocus, mas o aparelho escolhe o ponto.
3. nenhum controle exposto:
   permanece o autofocus nativo do celular.

Um quadrado aparece no ponto tocado para confirmar a interação.

Em `Ajustes da câmera`, a linha `Toque para focar` informa o nível de suporte disponível no aparelho.


## Ajuste v0.3.4 — fotografia real

Esta versão testa `ImageCapture.takePhoto()`.

### Novo fluxo

- O vídeo continua sendo usado somente para:
  - preview;
  - detecção da carta;
  - estabilidade;
  - nitidez preliminar.
- Quando a carta está pronta para captura:
  - se `ImageCapture` estiver disponível, o scanner faz uma exposição fotográfica;
  - tenta solicitar a maior resolução informada em `getPhotoCapabilities()`;
  - recorta da fotografia a região correspondente à moldura;
  - envia esse recorte ao OCR.
- Se `ImageCapture` não existir ou `takePhoto()` falhar:
  - o sistema volta automaticamente ao frame de vídeo.

### Informações na tela

A página mostra:
- resolução do stream;
- resolução fotográfica máxima anunciada;
- método usado na última captura;
- resolução da fonte e do recorte aproximado.

### Como comparar

O dado decisivo é comparar o rodapé:

1. mantenha `Preferir foto real em alta resolução` ligado;
2. capture uma carta;
3. anote o método exibido;
4. observe o collector number / set / idioma;
5. desligue a opção e capture a mesma carta via frame de vídeo;
6. compare visualmente e pelo OCR.

Se a fotografia real ainda ficar muito abaixo do app nativo da câmera, o próximo passo recomendado é encerrar o protótipo web e migrar para Android CameraX.
