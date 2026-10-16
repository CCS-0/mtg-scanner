# Acervo MTG — Scanner v0.2.4

Versão de recuperação após o travamento da v0.2.3.

## Mudança principal

O OpenCV.js foi removido completamente.

No celular, carregar e executar o OpenCV/WASM junto com vídeo contínuo estava causando congelamento da página. Esta versão usa somente APIs nativas do navegador:

- `getUserMedia`
- `<video>`
- `<canvas>`
- JavaScript puro

## Como o detector funciona

Ele não procura qualquer retângulo em toda a tela.

A moldura funciona como "zona de leitura". O algoritmo:

1. recorta uma região um pouco maior do que a moldura;
2. reduz para 180 × 252 px;
3. procura uma borda vertical à esquerda;
4. procura uma borda vertical à direita;
5. procura uma borda horizontal no topo;
6. procura uma borda horizontal embaixo;
7. calcula a razão largura/altura;
8. compara com 63/88;
9. mede textura interna;
10. calcula uma confiança;
11. exige que as bordas permaneçam estáveis;
12. só então captura.

A análise roda cerca de 4 vezes por segundo, reduzindo muito uso de CPU.

## Limitações desta versão

Ainda não é OCR nem identificação de MTG.

Um objeto retangular muito parecido com uma carta ainda pode passar pelo filtro. O objetivo desta etapa é impedir que "qualquer cena parada" dispare e validar um detector leve no celular.

## Atualização no GitHub Pages

Substitua os arquivos antigos por:

- index.html
- app.js
- styles.css
- manifest.webmanifest
- README.md

Confirme na página que aparece `Scanner v0.2.4`.

## Teste recomendado

### 1. Mesa vazia
Esperado:
- "Nenhuma carta detectada"
- 0 capturas

### 2. Mão / caneta / objetos comuns
Esperado:
- sem captura automática

### 3. Uma carta alinhada à moldura
Esperado:
- "provável carta"
- confiança sobe
- proporção próxima de 0,716
- estabilidade chega a 4/4
- captura

### 4. Ajustes
Se uma carta real não for reconhecida:
- abaixe "Sensibilidade das bordas" gradualmente;
- abaixe "Confiança mínima" de 63% para 58%.

Se objetos estranhos estiverem sendo reconhecidos:
- aumente "Confiança mínima";
- aumente "Sensibilidade das bordas".

## Próximo passo

Depois de estabilizar esta versão:
- recortar a faixa de nome;
- recortar a linha de set/collector number;
- OCR;
- busca no Scryfall;
- só dar o bip após identificar a impressão.
