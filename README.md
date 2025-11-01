# CycleScore JSON (Vercel + Playwright/Chromium)

Este projeto usa **Chromium (Playwright)** para:
- Aceder às páginas/JSON dos indicadores (Blockchain.com, Bitbo, Alternative.me)
- Calcular o **CycleScore (0–100)**
- Escrever `public/cyclescore.json` que é publicado pelo Vercel

## Passos

1. Cria um repo GitHub com estes ficheiros.
2. Importa no Vercel → o site vai servir a pasta `public/`.
3. Em GitHub → Actions, habilita as Actions.
4. A Action `update-cyclescore.yml` corre (por omissão) de 6/6h e faz commit do `public/cyclescore.json`.

URL típico para o GPT ler:
```
https://<teu-projeto>.vercel.app/cyclescore.json
```

## Nota sobre scraping
Usamos Playwright (Chromium) e o seu **APIRequest** interno para obter os dados JSON **exatamente como o browser**.
Se quiseres mesmo renderizar páginas e raspar valores do DOM, podes adaptar o script para `page.goto(...)` e `page.locator(...)`,
mas os gráficos são gerados via endpoints JSON — esta abordagem é mais robusta.