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

## Acceptance GP-01…GP-12

| ID | Результат | Основание |
|---|---|---|
| GP-01 | PASS | Запущена документированная команда `npm run dev:gameplay-prototype`; `http://127.0.0.1:4175/` открыл Phaser canvas с тремя жителями, ошибок браузерной консоли нет. |
| GP-02 | PASS | Стартовая сцена содержит жителей, дерево, камень, склад и цель; см. [начальный экран](start-iphone-se.png). |
| GP-03 | PASS | В браузерном прохождении назначены лесоруб, каменщик и строитель; смена ролей сохраняет реакции UI. |
| GP-04 | PASS | В ходе живого сценария житель добыл древесину на Восточной опушке, понёс и доставил её; см. [добычу](eastern-forest-woodcutter-harvesting.png), [перенос](eastern-forest-wood-in-transit.png), [доставку](eastern-forest-wood-delivered.png). |
| GP-05 | PASS | Житель добыл и доставил камень в ходе полного сценария; остатки ресурсов учитываются симуляцией и регрессионными тестами. |
| GP-06 | PASS | Проверены блокировка при полной вместимости через UI, перенаправление груза и резервирование одновременных входящих мест; см. [полный склад](full-warehouse-blocked-through-ui.png). |
| GP-07 | PASS | В реальном прохождении созданы площадка первого дома, доставка ресурсов и завершённый дом; см. [площадку](house-site.png), [готовый дом](house-complete-four-residents.png). |
| GP-08 | PASS | После первого дома реально появился четвёртый житель; см. [снимок](house-complete-four-residents.png). |
| GP-09 | PASS | Второй склад построен обычным циклом; ёмкость и дальнейшая логистика проверены в браузере. |
| GP-10 | PASS по предыдущему live playtest | [PLAYTEST.md](../PLAYTEST.md) записывает завершённый второй дом и рост до пяти жителей. Прогон v0.7 продолжился через второй склад и Восточную опушку, но отдельно второй дом не строил. |
| GP-11 | PASS | Полное прохождение сохранилось и восстановилось после обычного и offline reload; см. [сохранение](save-restored-eastern-expansion.png) и [offline reload](offline-reload-eastern-expansion.png). |
| GP-12 | PASS в Chromium emulation | Проверены desktop, узкие portrait/landscape viewports, камера и обновление ориентации; физические устройства и native PWA install остаются NOT VERIFIED. |

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
