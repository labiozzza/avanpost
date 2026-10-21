# Этап I.5 — Ремесло и Исследования (GDD §3.3, §6.1)

Источник: `Avanpost_GDD_v0.9.md` §3.2 (реестр товаров), §3.3 (канонический рецепт
производства, :128), §3.4 (задания на перенос), §4.1/:179 (здания и производство),
§6.1 (исследования, :244), §9.6 Столп 4 «Сервер авторитетен»,
`CLAUDE.md` «Играбельный интерфейс на каждом этапе».

## Проблема / цель

I.1–I.4 дали базовую экономику (рубка → брёвна), постройку через сервер и жителей
с профессиями/XP. Но **производства как такового нет**: `content/items.yaml` содержит
товары (`planks`, `charcoal`, `brick`, `flour`, `bread`, …), а рецептов, зданий-
мастерских, станций работы и **исследований** нет ни в контенте, ни на сервере, ни
в клиенте.

Следствие для уже отгруженного I.4: второй дом **заблокирован** — стартовых `planks 4`
хватает ровно на один дом, а произвести новые доски негде. Это прямое следствие
отсутствия ремесла и главный игровой тупик текущей сборки.

**Цель среза I.5:** замкнуть первую производственную цепочку `logs → planks` в
мастерской (ремесленник), дать **Академию и Research Points** как серверный счётчик
прогресса, открыть первое дерево технологий, и сделать всё это играбельным через UI
на каждом коммите (Playable UI First).

## Grounding (что есть сейчас)

- **Товары** — `content/items.yaml` (`logs`, `planks`, `charcoal`, `brick`, `flour`,
  `bread`, `iron_ore`, …), поле `volume`, `base_value`. `storageAccepts`/
  `itemVolume`/`storageFree` (`apps/server/src/domain/economy.ts:20-49`) — учёт объёма
  и совместимости категорий уже есть.
- **Склады и переносы** — `storage_item`, `haulTasks`, `transfer_tasks`
  (`logistics.ts`), физическая доставка работает (I.2). Доставка `to_building` для
  стройки — эталон цикла (`app.test.ts:558-673`).
- **Здания** — `content/buildings.yaml` (`workshop` уже описан: `build_work 36`,
  `logs 12 + stone 6`, `workers_limit 3`), но билд-цикла производства нет. Постройка
  через сервер закрыта в I.4-hotfix (`buildCommand`, `commands.ts:504`).
- **Профессии** — `packages/sim/src/professions.ts`: `Ремесленник` и `Каменотёс` уже
  есть; школа `craft` выдаёт `Ремесленник`. Класс-таблица `civilian_classes.yaml`
  отсутствует — профессии заданы в коде sim.
- **XP** — `apps/server/src/domain/xp.ts`: `awardLaborerXp`/`awardResidentXp`,
  событие `ResidentXpGained`. XP начисляется за реальную работу (I.4 D1=A) — ремесло
  подключим сюда же.
- **Жители** — `resident` (уровень/XP/профессия), `laborer` (тело в мире,
  `role`, `resident_id`), `snapshot.laborers`/`snapshot.residents`/`snapshot.population`.
- **Баланс** — `content/population_balance.yaml` (`level_thresholds [100,200,400,800]`),
  `content/world_balance.yaml`. Отдельного `craft_balance.yaml`/`tech_tree.yaml` нет.
- **Клиент** — `apps/client/src/simple/main.ts` (сцена canvas), `net.ts`
  (`startSession`/`fetchState`/`sendSchool`/`sendBuild`/`advanceWorld`),
  `commandQueue`/`enqueueCommand` (main.ts), панель поселения
  (`population-*`, `resident-*`), школы (`drawStudyPose`).
- **Миграции** — `db/migrations/0001..0009`; последняя `0009_population_state.sql`.
  Стиль: SQL + Kysely-схема в `apps/server/src/db/schema.ts`.

Пробел: **ни строчки** про `recipe`/`academy`/`research`/`tech_tree`/`workshop`-
production во всём коде (`grep` пуст). I.5 — greenfield поверх готовой экономики.

## Формулировка среза (Definition of Done)

Минимальный, но **полный играбельный цикл производства + первый шаг исследований**:

1. **Мастерская** — строится через уже готовый `buildCommand` (`workshop`), ставится
   на свободную клетку (как дом в I.4-hotfix). После `complete` она — рабочая станция.
2. **Рецепт `logs → planks`** — данные в `content/recipes.yaml`; серверный
   `craftCommand`/тик производства: назначенный `Ремесленник` (или разнорабочий с
   штрафом) берёт `logs` со склада, отрабатывает `productionSeconds`, кладёт `planks`
   в буфер/склад, применяет учёт `volume`. Прогресс виден на сцене.
3. **Академия + Research Points** — здание `academy`; `Ремесленник`/учёный, назначенный
   в академию, копит `research_points` (не складской предмет, а счётчик; §3.2/:124).
   **Офлайн не движется без назначенного учёного** (§6.1).
4. **Tech Tree (1 ветвь)** — `content/tech_tree.yaml` с узлами «Плотницкое дело»
   (открывает рецепт досок) и 1–2 потомками (напр. «Каменная кладка» → кирпич).
   DAG, ключи статичны; изучение стоит RP; остановка проекта сохраняет прогресс.
5. **UI на каждом коммите** — панель «Мастерская» (выбор рецепта, прогресс, буфер),
   панель «Академия/Наука» (назначить учёного, RP, дерево технологий с кликабельными
   узлами), визуал: ремесленник у верстака, доски на складе, дым/искры при работе,
   анимация «изучает свиток» в академии.

## Non-goals (осознанно вне среза I.5)

- Полный список 22 профессий и все цепочки §3.3 (металл, кожа, алхимия, торговля —
  этапы I.6+/II). В I.5 — **одна** цепь (`logs→planks`) плюс задел на кирпич.
- Качество изделия (§6.2) — этап II.
- Мультиплеер/торговля/рынок — этап II.
- Замена локальной «рубки» дерева на серверный `chop` — отдельный долг I.1/I.2
  (в I.5 не трогаем, чтобы не расширять срез; отметить в backlog).
- Свободный выбор клетки/drag-select и мультидом — было отнесено из I.4-hotfix сюда;
  в I.5 даём **выбор клетки в радиусе вокруг склада** минимально (клик по подсвеченной
  клетке), без drag-select.

## Design Doc / решения

- **D1 — Где живёт рецепт.** Вариант **A (рекомендуется):** данные в
  `content/recipes.yaml` (структура `Recipe(id, outputItem, outputQty, inputs[], fuelInputs[],
  productionSeconds, requiredProfession, requiredBuildingLevel, technologyId,
  bufferRequirements)` из §3.3), загружается в баланс сервера рядом с `buildings.yaml`.
  Клиент получает рецепты/узлы через `WorldSnapshot` (read-only). Alt B (захардкодить в
  sim) отклонён — GDD требует каталожность.
- **D2 — Модель производства.** Вариант **A (рекомендуется):** «станция + назначенный
  работник»: `building`-станция имеет очередь заказов (`craft_order`), тик `advance`
  списывает входы со склада (через существующий `reserve`), работник «работает»
  `productionSeconds`, результат кладётся в буфер станции и переносится перевозчиком
  (реюз I.2). Alt B (мгновенный крафт по клику) отклонён — нарушает §4.1 (реальные
  рабочие и время).
- **D3 — Research Points.** Вариант **A (рекомендуется):** RP — **счётчик в состоянии
  игрока** (`owner.research_points`), инкремент тиком при наличии учёного в академии,
  `research_enabled`/скорость в балансе; прогресс проекта — `research_project`
  (technology_id, progress, assigned_resident_id, state). Офлайн = нет учёного → 0
  прироста (§6.1). Alt B (RP как складской предмет) отклонён — §3.2 прямо исключает.
- **D4 — Первая цепь.** Вариант **A (рекомендуется):** `logs (2) → planks (1)`,
  `productionSeconds` из нового `content/craft_balance.yaml`, `requiredProfession:
  Ремесленник`. Даёт разблокировку второго дома. Alt B (`logs→charcoal`) отклонён —
  доски нужнее (постройки уже требуют `planks`).
- **D5 — Tech Tree.** Вариант **A (рекомендуется):** `content/tech_tree.yaml` — DAG,
  узлы «Плотницкое дело» (стартовый, открывает `planks`) → «Каменная кладка»
  (кирпич). Стартово открыт один проект (§6.1), больше параллельных — с уровнем
  академии. Alt B (линейный список) отклонён — GDD требует ветвление и DAG.
- **D6 — UI-срез.** Вариант **A (рекомендуется):** две новые панели в стиле
  `population-panel` (`workshop-panel`, `research-panel`) + визуал ремесленника и
  академии на canvas. Данные/кнопки с testid для e2e. Alt B (только код без UI)
  отклонён по `CLAUDE.md` Playable UI First.

## Decision ledger (R1/R2, D1/D2)

- **R1 — Глубина I.5: A (default applied).** Пользователь не выбрал из A/B/C.
  Применён рекомендованный вариант A (одна цепь + Академия + дерево 2–3 узла).
  Обоснование: связный срез закрывает тупик с досками и даёт первый шаг §6.1.
  Апгрейд-триггер: если после отгрузки нужна вторая цепь — отдельный срез I.5b.
- **R2 — Формат ревью: A (approved).** Полный `/plan-eng-review` (новая подсистема).
- **D1 — Design doc / office-hours: B (approved).** Пропустить, стандартное ревью.
- **D2 — Scope Challenge: A (approved).** Держать срез, ревьюить.

## Review preparation — test diagram (проектируемое)

```
[content/recipes.yaml, craft_balance.yaml, tech_tree.yaml]
        │ load (balance)
        ▼
 advanceWorldCommand (commands.ts:709)  ── fixed pipeline order ──
   advanceNodes → advanceTransfers → planTransfers
   → planHauls → advanceHauls → advanceBuildings
        │  F2-fix: insert advanceCraft (после доставки входов, до planHauls)
        │  F3-fix: insert advanceResearch (после craft)
        ▼
 craft_order (reserve inputs) → worker works productionSeconds
   → output → building buffer → haul (reuse I.2) → storage
        │
        ▼
 snapshot.buildings + snapshot.craftOrders + snapshot.research + snapshot.techTree
        │  F4-fix: snapshot() must emit new read models (snapshot.ts)
        ▼
 client: workshop-panel / research-panel (Playable UI First)
```

## Findings

### F1 — `civilian_classes.yaml` отсутствует, профессии захардкожены в sim (medium)

Плана ссылается на `civilian_classes.yaml` как источник `requiredProfession`, но файл
не существует: `РОФЕССИИ` заданы в `packages/sim/src/professions.ts:19-30`
(`PROFESSION_COLORS`/`PROFESSION_DESCRIPTIONS`). `Grep` по `civilian_classes` по репо —
0 совпадений. Значит `requiredProfession: Ремесленник` в `recipes.yaml` ссылается на
строку-литерал, а не на ключ каталога. **Ремедиация:** валидировать
`requiredProfession` против списка из `professions.ts` (импорт `@avanpost/sim`), а
отдельный `civilian_classes.yaml` — вне среза (Non-goal §5). В плане убрать ссылку на
несуществующий файл.

### F2 — Порядок в tick-pipeline: крафт вставляется между доставкой и haul (high)

`advanceWorldCommand` (`commands.ts:709`) выполняет шаги в фиксированном порядке:
`advanceNodes → advanceTransfers → planTransfers → planHauls → advanceHauls →
advanceBuildings` (`commands.ts:801-828`). Крафту нужны **входы на складе** (reserve)
и он даёт **выход в буфер**, который затем подхватывает haul. Если `advanceCraft`
поставить до `planHauls`, выход успевает попасть в задачи переноса; если после —
выход простаивает лишний тик. Но если поставить **до** `advanceTransfers`, крафт
увидит недопоставленные входы. **Ремедиация:** вставить `advanceCraft` строго между
`advanceBuildings`-подобной зоной и `planHauls` — конкретно **после
`advanceTransfers`+`planTransfers` и до `planHauls`**; порядок зафиксировать тестом
(`app.test.ts`), как это сделано для build→transfer→complete. Без этого — рассинхрон
буфера и переносчиков.

### F3 — Research Points: нет владельца состояния и места в tick (high)

§6.1 требует, чтобы прогресс **останавливался офлайн без назначенного учёного**. В
текущем коде нет ни таблицы владельца для `research_points`, ни шага тика. `owner`
(сессия/игрок) в БД есть, но колонки RP нет (проверено: `db/migrations/0001..0009`
не содержат `research`/`research_points`). **Ремедиация:** миграция
`0010_craft_research.sql` добавляет `research_points` (к `owner`), `research_project`
(`technology_id`, `progress`, `assigned_resident_id`, `state`) и `craft_order`
(`building_id`, `recipe_id`, `progress`, `state`). Шаг `advanceResearch` считает RP
только при наличии `research_project` со `state='active'` **и** живого
`assigned_resident_id`; иначе прироста 0. Покрыть тестом «без учёного прогресс не
растёт» (аналог population-тестов I.4).

### F4 — Snapshot не отдаёт новые read-модели клиенту (medium)

`WorldSnapshot` (`packages/shared/src/protocol.ts:353`) содержит
`sectors/frontier/clearingTasks/storages/nodes/haulTasks/buildings/transferTasks/
laborers/residents/population`. Ни `recipes`, ни `craftOrders`, ни `research`, ни
`techTree` там нет; `snapshot()` (`apps/server/src/domain/snapshot.ts`) их не собирает.
UI-панели не смогут отрисоваться без этих полей. **Ремедиация:** расширить
`WorldSnapshot` и `snapshot()` (recipes/techTree — статичны из баланса; craftOrders/
research — из БД). Это правка shared-протокола → затрагивает и client, и server
typecheck. Зафиксировать в тесте снапшота.

### F5 — Выбор клетки: `firstFreeHouseCell` не годится для мастерской/академии (medium)

В I.4-hotfix клиент ставит дом в **первую свободную reachable-клетку** абстрактно
(`main.ts`, `firstFreeHouseCell`). Для I.5 план обещает «выбор клетки в радиусе вокруг
склада» (Non-goals про drag-select). Текущий хелпер не учитывает радиус и не даёт
выбора. `buildCommand` (`commands.ts:504`) валидирует клетку, но не «радиус вокруг
склада». **Ремедиация:** для I.5 — клиентский подсвет reachable-клеток в радиусе
(напр. ≤ N клеток от склада) и клик по клетке; либо явно свести к авто-клетке и
убрать «радиус» из цели. Решить в реализации; не расширять до drag-select.

### F6 — Нет e2e на цикл крафта и на «офлайн без учёного» (medium)

Существующий e2e (`e2e/app.spec.ts`) покрывает рубку/постройку/школы. Плана требует
играбельного UI, но без e2e на: (а) `logs → planks` (положить бревна → назначить
ремесленника → дождаться доски на складе → построить второй дом), (б) «без учёного RP
не растёт». **Ремедиация:** два новых e2e + evidence (GIF цикла крафта, скрин панелей),
по шаблону I.4-hotfix (`collectWood`, `advance`).

### F7 — `content/` загрузчик и валидация новых YAML (low)

`content/recipes.yaml`/`craft_balance.yaml`/`tech_tree.yaml` должны грузиться тем же
баланс-лоадером, что `buildings.yaml`/`items.yaml`. Нужно подтвердить схему загрузки
(`apps/server/src/balance.ts`) и добавить валидацию: рецепт ссылается на существующий
`item` (из `items.yaml`), `requiredBuildingLevel` есть у здания, узел `tech_tree`
ссылается на существующие зависимости (DAG без циклов). Иначе — тихая ошибка баланса.
**Ремедиация:** unit-тест валидации `tech_tree` на ацикличность и ссылочную целостность.

### F8 — RP-счётчик в снапшоте и совместимость версий (low)

`expected_version` в командах (`BuildCommandSchema` и др.) растёт с каждым тиком; UI
панелей должен читать RP из снапшота (read-only), а не слать команду на каждый показ.
Иначе — лишние гонки версии. **Ремедиация:** `research.enabled`/`points` читаются из
`WorldSnapshot`; команды только на действия (start/cancel project, assign scientist).

### F9 — Non-goal «chop на сервер» не зафиксирован как долг (low)

Локальная рубка (`tree`/`chop`, `wood`-счётчик) остаётся клиентской и не серверно-
авторитетна — это долг I.1/I.2, а не I.5. План упоминает, но не создаёт трекер.
**Ремедиация:** добавить строку в backlog/`docs/plans` как явный технический долг с
триггером «когда появится серверный `chop`/сбор» (вероятно I.6).

## Reality rows

REALITY: premise-table pass all claims cross-checked against code and content (content/buildings.yaml:12-31)
REALITY: already-done pass no recipe/craft/academy/research/tech code (git 8d602ce)
REALITY: surface-check pass 13 routes verified (apps/server/src/app.ts:113-293)
REALITY: binding-decisions pass I.4-hotfix decision upheld and extended (apps/server/src/domain/commands.ts:504)
REALITY: numbers pass numbers measured from content (content/buildings.yaml:12-31)
REALITY: deferred-asks pass no linked issue; non-goals listed explicitly (docs/plans/stage-1.5-craft-and-research.md:1)
REALITY: pr-count pass .gstack/ship-policy.json absent, pr_count default 1 (README.md:1)

## ## GSTACK REVIEW REPORT

| Раздел | Значение |
|---|---|
| **Eng Review** | 1 прогон · 9 issues · 0 critical gaps |
| **Вердикт** | ISSUES OPEN (FULL_REVIEW) |
| **Внешнее покрытие** | none (Aside недоступен; внешний поиск не проводился) |
| **Неразрешённых решений** | 0 |

Findings по серьёзности: high — F2, F3; medium — F1, F4, F5, F6; low — F7, F8, F9.

NO UNRESOLVED DECISIONS
