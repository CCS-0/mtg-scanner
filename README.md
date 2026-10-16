# Acervo MTG — Scanner v0.2.2

Esta versão corrige o principal problema observado na v0.1: **uma cena qualquer, apenas por ficar estável, não deve mais disparar uma captura**.

## O que mudou

A captura automática agora exige, nesta ordem:

1. OpenCV encontrar um contorno fechado;
2. o contorno ser aproximável por um quadrilátero convexo;
3. ocupar uma área mínima da região de leitura;
4. ter proporção compatível com uma carta MTG (alvo físico 63:88 ≈ 0,716);
5. estar razoavelmente centralizado;
6. os quatro cantos permanecerem estáveis por várias análises consecutivas.

Somente então ocorre a captura automática.

Além disso, a imagem é corrigida por perspectiva e convertida para 630 × 880 px.

## Como atualizar seu GitHub Pages

Substitua no repositório os arquivos da v0.1 por estes arquivos:

- `index.html`
- `app.js`
- `styles.css`
- `manifest.webmanifest`
- `README.md`

Faça commit na branch publicada pelo GitHub Pages. Aguarde a publicação e recarregue a página do celular. Se o navegador mantiver a versão antiga, use recarga completa/limpe o cache do site.

## Teste A — sem carta

Abra a câmera e deixe a mesa vazia e estável por 10–15 segundos.

**Resultado esperado:**

- `Nenhuma carta detectada`
- contador permanece em 0
- nenhuma captura automática

## Teste B — objetos aleatórios

Passe a mão, um celular, uma caneta, uma folha e outros objetos pela área.

**Resultado esperado:** não capturar, salvo se o objeto formar um quadrilátero muito semelhante a uma carta.

## Teste C — carta real

Coloque uma carta de Magic aproximadamente dentro da moldura.

A tela deve mudar para:

- `carta provável`
- mostrar a proporção encontrada
- desenhar um polígono sobre os quatro cantos
- `Carta detectada — segure`
- `Carta detectada e estável`
- BIP + captura

Depois retire a carta completamente. O sistema só libera a próxima captura após alguns quadros sem carta detectada.

## Ajustes

Deixe os padrões primeiro:

- tolerância da proporção: 18%
- estabilidade dos cantos: 8 px
- área mínima: 38%

Se não detectar cartas verdadeiras, aumente a tolerância para 22–24% ou reduza a área mínima para 32–35%.

Se detectar objetos indevidos como carta, faça o inverso: reduza a tolerância e/ou aumente a área mínima.

## Limitação consciente desta versão

A v0.2 reconhece **geometria de carta**, ainda não reconhece que o conteúdo é especificamente uma carta de Magic. Um objeto retangular com proporção muito próxima a 63:88 pode eventualmente passar pelo filtro.

A próxima etapa (v0.3) será a validação semântica: ler a faixa do nome e/ou a linha de coleção/collector number via OCR antes de considerar a captura válida.


## Correção v0.2.2

A câmera não depende mais da inicialização do OpenCV. O botão `Iniciar câmera` fica disponível imediatamente. O detector geométrico inicializa em paralelo e o status da tela informa separadamente se a câmera e o detector estão prontos. Isso evita que uma falha ou demora do OpenCV impeça a câmera de abrir.


## Diagnóstico v0.2.2

Ao tocar em **Iniciar câmera**, o status deve mudar imediatamente para `Clique recebido — iniciando câmera…`.

- Se isso não acontecer, o navegador ainda está exibindo uma versão antiga do `index.html`.
- Se aparecer `Erro: app.js ainda não carregou`, o HTML foi atualizado, mas o JavaScript não foi carregado.
- Se aparecer `Clique recebido — solicitando acesso à câmera…`, o JavaScript está funcionando e o próximo diagnóstico é a permissão/API da câmera.

Os arquivos `app.js` e `styles.css` usam `?v=022` no HTML para evitar cache antigo do GitHub Pages/navegador.
