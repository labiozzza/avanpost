# AVANPOST v0.7 — результат проверки

- Дата: 2026-11-18
- Ветка: `feat/gameplay-prototype-v0.1`
- Проверка проводилась на production build через Chromium; физические Android/iPhone не использовались.
- Владелец ещё не подтверждал итоговый игровой опыт.

## Результат

| Область | Результат | Основание |
|---|---|---|
| Игровой цикл из нового сохранения | PASS | Браузерный сценарий прошёл от назначения трёх жителей и первого дома до четвёртого жителя, второго склада, Восточной опушки, расчистки, восточного склада, доставки и offline reload. Сценарий занял 10,7 минуты. |
| Логистика складов | PASS | Добавлены резервы входящих мест, проверка вместимости при прибытии и восстановление сохранённых маршрутов без переполнения. Регрессия покрыта одновременной доставкой дерева и камня. |
| PWA и offline reload | PASS | Production Service Worker управлял страницей; после отключения сети игра открылась повторно, все 13 игровых артов загрузились с HTTP 200, ошибок JavaScript не было. |
| Новые спрайты Восточной опушки | BLOCKED | Три прямых вызова встроенного ImageGen (первый тест и два разрешённых повтора) завершились HTTP 503. PNG не созданы и не интегрированы. На API/CLI не переключались. |
| Установка на физические устройства | NOT VERIFIED | Проверка на реальном Android/iPhone не выполнялась. |
| Приёмка владельцем | PENDING | Нужен ручной игровой прогон владельца. Автоматические проверки не означают owner acceptance. |

В текущей сцене остаются прежние изображения деревьев и три SVG-слоя Восточной опушки. Они не являются результатом новой PNG-генерации.

Точный промпт тестового вызова:

> Use case: stylized-concept. Asset type: AVANPOST Phaser game sprite, test asset for the Eastern Fringe. Primary request: one isolated mature forest tree sprite, designed for a dark, wet Eastern Fringe settlement game. Scene/backdrop: none, transparent background. Subject: a single broadleaf forest tree with a sturdy damp-bark trunk and distinct deep moss green foliage. Style/medium: flat-cartoon hand-painted game art consistent with AVANPOST, clean readable side-view orthographic silhouette. Composition/framing: centered, full tree fully in frame inside a 256×256 logical cell, intended bottom-center pivot, at least 16 px transparent safety padding, readable at game scale. Lighting/mood: overcast soft light, subdued and earthy. Color palette: deep moss, muted pine, bog-water blue-green, damp bark, restrained warm accents. Materials/textures: simple layered foliage and subtle bark texture, crisp outer silhouette. Constraints: truly transparent background, no ground shadow beyond the sprite, no other objects, no text, labels, UI, border, or watermark.

Запрошены PNG и настоящая прозрачность. Поскольку все три попытки завершились HTTP 503, файла, размеров, alpha-проверки и Phaser texture setup нет; визуальная проверка нового спрайта невозможна.

## Проверки

- `npm run test:gameplay-prototype` — PASS, 37 тестов.
- `npm run typecheck -w @avanpost/gameplay-prototype` — PASS.
- `npm run typecheck:e2e -w @avanpost/gameplay-prototype` — PASS.
- `npm run build -w @avanpost/gameplay-prototype` — PASS; Vite сообщил только о большом Phaser bundle.
- `npm run check:pwa -w @avanpost/gameplay-prototype` — PASS; проверены manifest, 3 иконки, Service Worker и 13 игровых артов.
- `npx playwright test --config apps/gameplay-prototype/playwright.config.ts` — PASS, 10 сценариев за 14,5 минуты.
- PWA smoke run — PASS для offline reload и загрузки 13 артов; subpath runtime `/settlement/` и физическая установка остаются непроверенными.
- `git diff --check` — PASS; Git предупредил только о преобразовании LF/CRLF при следующей записи файлов в Windows.

Проверки выполнял основной агент и назначенные на реализацию субагенты; отдельная независимая QA-сессия не проводилась.

## Скриншоты

Кадры реального браузерного прохождения и отдельные снимки состояний доступны в этой папке:

- [Начальная сцена на узком экране](start-iphone-se.png)
- [Первый дом и четвёртый житель](house-complete-four-residents.png)
- [Второй склад](second-warehouse-capacity-increased.png)
- [Расчистка Восточной опушки](eastern-clearing-in-progress.png)
- [Опушка после расчистки](eastern-sector-prepared-two-plots-and-forest.png)
- [Житель рубит восточную древесину](eastern-forest-woodcutter-harvesting.png)
- [Доставленный восточный склад](eastern-warehouse-complete.png)
- [Сохранение после offline reload](offline-reload-eastern-expansion.png)
- [Закрытая опушка в отдельном снимке состояния](v07-01-eastern-closed.png) — снимок использует сохранённое состояние, а не новый игровой прогон.

## Ручной запуск владельцем

Из PowerShell в корне репозитория:

```powershell
wsl -d Ubuntu -- bash -lc 'source ~/.nvm/nvm.sh && cd /mnt/e/Avanpost-mvp-slice && npm run dev:gameplay-prototype'
```

Откройте `http://127.0.0.1:4175/`. Полный walkthrough находится в [PLAY_NOW.md](../PLAY_NOW.md). Владельцу рекомендуется пройти первый дом, второе хранилище и расчистку опушки; installation/offline на телефоне проверяются отдельно.
