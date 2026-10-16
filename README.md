# Acervo MTG — Scanner v0.1

Primeiro protótipo do scanner contínuo para o Acervo MTG.

## O que esta versão faz

- Abre a câmera traseira do celular.
- Exibe uma moldura na proporção física aproximada de uma carta MTG (63:88).
- Observa a região da moldura em vídeo contínuo.
- Quando a imagem permanece estável por alguns quadros, captura automaticamente.
- Emite um bip.
- Mostra a carta recortada.
- Bloqueia nova captura até detectar movimento/troca da carta.
- Permite ajustar os limiares de estabilidade e movimento.

## O que ainda NÃO faz

- OCR.
- Identificação do nome da carta.
- Identificação de set / collector number.
- Consulta ao Scryfall.
- Inclusão na planilha.
- Detecção confiável de foil.
- Detecção automática das bordas reais da carta.

Isso é proposital: primeiro validamos a parte física/câmera.

## Teste rápido no computador

Você pode abrir o `index.html`, mas navegadores podem restringir câmera em arquivos locais.
O ideal é servir por `localhost`.

Com Python instalado:

```bash
cd mtg-scanner-v0.1
python -m http.server 8000
```

Abra:

```text
http://localhost:8000
```

`localhost` é aceito como contexto seguro pelos navegadores modernos.

## Teste no celular

Para a câmera funcionar em uma página acessada pelo celular, publique o projeto via HTTPS.

### Opção simples: GitHub Pages

1. Crie um repositório no GitHub, por exemplo `mtg-scanner`.
2. Envie para a raiz os arquivos desta pasta.
3. No repositório, abra `Settings`.
4. Abra `Pages`.
5. Em `Build and deployment`, escolha `Deploy from a branch`.
6. Escolha a branch `main` e a pasta `/(root)`.
7. Salve.
8. Abra no celular a URL publicada pelo GitHub Pages.
9. Toque em `Iniciar câmera` e permita o acesso.

## Montagem física recomendada para o teste

- Celular preso em suporte, câmera apontada verticalmente para baixo.
- Distância inicial: aproximadamente 25–35 cm da carta.
- Luz difusa dos dois lados.
- Evite reflexo direto de luminária no sleeve.
- Fundo fosco e uniforme.
- Faça primeiro os testes com cartas sem sleeve.

## Como testar

1. Abra a câmera.
2. Coloque uma carta dentro da moldura.
3. Mantenha a mão parada.
4. O status deverá mudar para `Segure...` e depois `Carta estável`.
5. Deve ocorrer a captura e o bip.
6. Retire a carta.
7. Coloque outra.
8. Repita com 20 cartas diferentes.

Anote:
- capturas duplicadas;
- capturas antes do foco;
- necessidade de mover muito a carta para liberar a próxima;
- reflexos;
- distância ideal da câmera.

## Próxima versão

A v0.2 adicionará:
1. detecção automática do contorno da carta;
2. correção de perspectiva;
3. recortes separados da faixa do nome e da linha inferior;
4. pré-processamento para OCR.

Depois entra o OCR e a identificação no Scryfall.
