# Этап I.4 (hotfix) — Серверная постройка дома (Stolp 4: сервер авторитетен)

Источник: `Avanpost_GDD_v0.9.md` §4.1 (строка 179: «Здания требуют реальных ресурсов,
доступного участка, рабочих и времени»), §9.6/Столп 4 «Сервер авторитетен»,
§3.4 (физическая доставка материалов), §4.2 (Дом → вместимость проживания).

## Проблема (дефект, не новая механика)

Клиент реализует постройку **локальным визуальным шорткатом**, разорванным с сервером:

- `requestBuild()` (`apps/client/src/simple/main.ts:825`) списывает локальную переменную
  `wood` и кладёт `queuedJobs` — серверная команда не отправляется.
- `arrive()`/`finishWork()` (main.ts:888, ~933) через `BUILD_SECONDS` локально ставят
  `plots[job.building].built = true` — дом «возводится» без ресурсов, доставки и билдера.
- `syncUI()` (main.ts:624) мгновенно переключает `document.body.dataset.house`.
- Из-за этого лимит жителей (`Y` в `population-count`) **не растёт от реальной постройки**:
  серверный `housingCapacity` считается только от `building.status = 'complete'`
  (`snapshot.ts:265-272`), а такой записи в БД никогда не появляется.

Клиент при этом уже несёт **две параллельные экономики**: локальную (`wood`, `plots`) и
серверную (`snapshot.storages`, `snapshot.buildings`). Это прямое нарушение Столпа 4.

## Что уже существует на сервере (grounding)

Серверный путь постройки **полностью реализован** — дефект только в клиенте:

- `buildCommand()` (`apps/server/src/domain/commands.ts:504`) — валидирует тип здания,
  сектор, клетку (passable/reachable/не занята), создаёт `building` в статусе
  `awaiting_materials`, заводит `building_material` по рецепту. Событие `BuildingPlaced`.
- Роут `POST /api/commands/build` (`apps/server/src/app.ts:258`) уже подключён и парсит
  `BuildCommandSchema` (`packages/shared/src/protocol.ts:409`:
  `request_id, expected_version, building_type, sector_id, x, y`).
- Доставка материалов: тик `advance` порождает `transfer_task` `to_building` из склада
  (`app.test.ts:600-613` подтверждает), билдер доводит `work_done → work_required`,
  статус → `complete`.
- `housingCapacity` реагирует на `complete`-дома (unit-тест
  `apps/server/test/population.test.ts:256-263`: после постройки `capacity === 5`).

Стартовые склады (`content/storage.yaml:36-53`) уже содержат `logs 45` и `planks 4`.
Рецепт дома (`content/buildings.yaml`): `logs 8 + planks 4`, `build_work 24`.
=> **Один дом возводится из стартового стока без новых производств.** Плaнки в запасе
ровно 4 — этого достаточно для одного дома; второй дом заблокирован до появления
производства планок в I.5 (это осознанное ограничение среза, см. Non-goals).

## Цель среза

Убрать локальный шорткат. Клик «Построить дом» должен отправлять `build` на сервер;
дом рисуется и лимит жителей растёт **только из ответа снапшота сервера**; после F5
дом на месте.

## Design Doc / решения

- **D1 — Единый источник постройки.** Вынести локальную симуляцию `wood`/`plots`/
  `queuedJobs`/рабочий-build-job как **источник истины** и заменить её на серверный цикл.
  Клиент больше не хранит «свой» дом.
  Варианты:
  - **A (рекомендуется):** клиент шлёт `build` в единую `commandQueue`
    (`enqueueCommand`, main.ts:1767), после ответа вызывает `syncFromSnapshot`, и рисует
    здание из `snapshot.buildings` (статус `awaiting_materials → complete`). Локальные
    `wood`, `plots`, `BUILD_SECONDS`, `queuedJobs`(build) удаляются. Worker-визуал билдера
    уже есть на сервере (`laborer.role='builder'`, `status='building'`) — используем
    `snapshot.laborers` для отрисовки, как для gathera/carrier.
  - **B:** оставить локальный рендер, но синхронизировать его из сервера. Больше кода и
    двойной источник — отклоняется (не чинит корень).
- **D2 — Где появляется дом (клетка).** `build` требует `sector_id/x/y`. Дом в GDD имеет
  footprint; сейчас в срезе — одна клетка на заранее выбранном свободном reachable-месте
  сцены, а не свободный выбор игроком. Клиент берёт **первую свободную reachable-клетку**
  (как делает тест `app.test.ts:564-571`). Свободный выбор клетки игроком — Non-goal (I.5+).
- **D3 — Ошибки сервера.** `wood < cost` заменяется на серверную ошибку
  (`PATH_BLOCKED`/`CELL_OCCUPIED`/нет материалов при доставке). Клиент показывает
  сообщение из `ApiError.message` и **не** рисует дом. Инвариант: дом в UI ⇔ запись в БД.
- **D4 — Совместимость с I.4-визуалом.** `drawStudyPose`, `renderPopulationStatus`,
  `renderResidents` не трогаем. Меняем только build-поток. Постройка дома, дом на сцене,
  рост `Y` — проверка I.5-визуала.

## Review sections

### 1. Data flow / architecture (Eng)
- Единственный путь мутации: `build` → `advance` → `syncFromSnapshot` → рендер.
- Удалить из `main.ts`: `wood` как источник, `plots[id].built/scheduled/progress/cost`
  как авторитет, `queuedJobs`(build), `BUILD_SECONDS`, `requestBuild`, build-ветки
  `startNextJob`/`arrive`/`finishWork`. Остаётся `plots` только как **карта позиций/спрайтов**
  для отрисовки зданий из снапшота (или заменяется на маппинг `building_id → экран`).
- Расширить `net.ts`: `sendBuild(snapshot, {building_type, sector_id, x, y})` по образцу
  `sendSchool`. Проброс через `enqueueCommand` (сериализация `expected_version`).

### 2. Edge cases
- Клетка занята/не reachable → `409`; UI сообщает, дом не рисуется.
- Планок ровно 4: после первого дома повторный клик → сервер отдаёт дом в
  `awaiting_materials`, но трансферы не могут насытить `planks` (в стоке 0) → стройка
  стоит; UI показывает статус стройки, capacity **не** растёт. Это корректное серверное
  поведение, покрыть кейсом.
- Полный стек материалов и билдер занят → несколько тиков `advance` (макс 60/вызов).
- F5 в середине стройки → снапшот восстанавливает `awaiting_materials`/прогресс, дом
  не «пропадает» и не «достраивается» мгновенно.

### 3. Test coverage
- **Server unit** (уже есть baseline): инвариант «complete-дом ⇒ capacity +2» покрыт
  `population.test.ts:256-263`. Добавить: `build` без материалов не увеличивает capacity.
- **E2E** (`e2e/app.spec.ts`): новый тест «серверная постройка дома» —
  1) открыть сессию, 2) клик `build-house` (data-testid), 3) дождаться ответа сервера,
  4) тики `advance` пока дом `complete`, 5) `population-count` `Y` вырос (3→5),
  6) `F5` → дом на месте, `Y` сохраняется. Удалить/переписать локально-шорткатные ожидания.
- **Persistence**: F5 покрывает персистентность БД.

### 4. Performance / determinism
- Никаких новых серверных циклов; всё идёт через существующие `advance`. Детерминизм
  сохраняется (idempotent replay по `request_id`).

### 5. Security / validation
- Клиент не доверенный: любые поля `build` валидируются `BuildCommandSchema` + серверные
  проверки уже на месте. Локальный `wood` больше не «защита» — его удаление не ослабляет
  сервер.

## Non-goals (вне среза)

- **Свободный выбор клетки дома игроком** (drag/select) — I.5+.
- **Производство планок / лесопилка** (нужно для 2+ домов) — это I.5 (рецепт
  дерево → брёвна → доски, §3.3).
- **Снос/возврат материалов в UI** — серверная `demolish` есть, но UI-поток — I.5+.
- Любые исследования/Академия — Фаза 2.

## Verification / evidence (Playable UI First)

- `npm run typecheck` · `npm run build` · `npm run test` · `npm run e2e` — все зелёные.
- E2E «серверная постройка дома» (см. выше).
- Скриншот `docs/evidence/i4-house-build-server.png`: дом на сцене + `population-count`
  с выросшим `Y` (5) после серверной постройки.
- GIF `docs/evidence/i4-house-build-server.gif`: клик → статус стройки → дом появляется →
  `Y` 3→5 (рецепт записи — recorder-i4-pop.mjs, ffmpeg палитра).
- Регресс-скриншот строительства из снапшота после F5.

## Definition of Done

1. В `main.ts` нет локальной постройки дома (`wood`-стоимость как источник, `plots.built`
   как авторитет, build-ветки worker-джоб).
2. Клик `build-house` → `POST /api/commands/build` → рендер дома из снапшота.
3. Дом в UI существует ⇔ `building` в БД (`awaiting_materials`/`complete`).
4. `population-count` Y растёт только после серверного `complete` и сохраняется после F5.
5. Новый e2e зелёный; `typecheck/build/test/e2e` зелёные; evidence-файлы добавлены.

## Decision ledger

### R1: Объём hotfix — авто-клетка и один дом vs свободный выбор клетки
Finding: Scope Challenge D2, P1, conf 9/10, `main.ts:825`
Plan baseline: исходный план — «клик build-house → build на сервер → рендер из снапшота», клетка не задана.
Runtime evidence: рецепт дома `logs 8 + planks 4` (`content/buildings.yaml`); стартовый сток `planks 4` (`content/storage.yaml:41`) даёт ровно один дом; серверный тест берёт first free reachable cell (`app.test.ts:564-571`).
Comparison grid:

| Choice | Current | A | B | C |
|---|---|---|---|---|
| Место дома | не задано | first free reachable cell | выбор игроком (drag/select) | без изменений |
| Число домов | 1 достижим | 1 (планок хватает на 1) | N сразу | N (после лесопилки) |
| Серверный build | есть, не задействован | задействован | задействован | отложен |
| Объём | — | клиент только | клиент + новый UI | сервер + контент I.5 |
| Выбор клетки/мультидом | — | I.5 | этот срез | этот срез |

Question D2: см. выше (полный бриф задан пользователю).
Header: Scope: house cell + one house
Options:
A) Авто-клетка, один дом; клик → сервер → рендер из снапшота (recommended)
B) Свободный выбор клетки игроком сейчас (drag/select + несколько домов)
C) Сначала производство планок/лесопилка, потом чинить build

State: approved
Actual answer: A (Авто-клетка, 1 дом)
Accepted scope: клиент шлёт `build` на первую свободную reachable-клетку; один дом; выбор клетки и мультидом — I.5.
History: —

### R2: Prerequisite — design doc (/office-hours) перед ревью
Finding: Design Doc Check → «No design doc found», D1.
Plan baseline: ревью по плану без design doc.
Runtime evidence: `gstack-design-doc-find` вернул `none`; проблема локализована до клиентской функции.
Comparison grid:

| Choice | Current | A (/office-hours) | B (skip) |
|---|---|---|---|
| Design doc | нет | создаётся | нет |
| Время до кода | — | +~10 мин | 0 |
| Вход ревью | план | формализованные премисы | текущий grounding |

Question D1: см. выше.
Header: Prerequisite: design doc
Options:
A) Запустить /office-hours
B) Пропустить, идти ревью (recommended)

State: approved
Actual answer: B (Пропустить, идти ревью)
Accepted scope: стандартное ревью без design doc.
History: —

## Findings (Scope Challenge + Sections 1–4)

| # | Sev | Conf | file:line | Finding |
|---|-----|------|-----------|---------|
| F1 | P1 | 9/10 | `main.ts:825` | `requestBuild` списывает локальный `wood` и кладёт `queuedJobs` — двойной источник истины с `snapshot.storages`. Fix: удалить локальную стоимость, слать `build` в `commandQueue`. |
| F2 | P1 | 9/10 | `main.ts:~933` | `finishWork` ставит `plots[job.building].built=true` без записи в БД — нарушение Столпа 4. Fix: рендер из `snapshot.buildings`. |
| F3 | P2 | 8/10 | `main.ts` (кнопка `build-house`) | Нет блокировки повторного клика: два `build` подряд → второй `409 CELL_OCCUPIED`. Fix: disable кнопку до ответа сервера. |
| F4 | P1 | 9/10 | `e2e/app.spec.ts` | Нет e2e на полный серверный цикл (клик → `advance` до `complete` → capacity 3→5 → F5). Fix: новый тест. |

Инвариант (сохранить): build-ветки worker (`startNextJob`/`arrive` type `build`) удаляются;
визуал билдера берётся из `snapshot.laborers` (`role='builder'`).
Существующий инвариант «complete-дом ⇒ capacity+2» покрыт `population.test.ts:256-263` — оставить.

## Reality rows

REALITY: premise-table pass — премисы с receipt (commands.ts:504, app.ts:258, snapshot.ts:265, storage.yaml:41, buildings.yaml).
REALITY: already-done pass — серверный build/route/transfer/capacity уже в коде (git grep, `app.test.ts:558-673`).
REALITY: surface-check pass — `POST /api/commands/build` подтверждён в `app.ts:258`; `npm`-скрипты сверены.
REALITY: binding-decisions pass — `gstack-decision-search --scope branch` пусто (CLAUDE.md:1-40); нет переопределённых дефолтов.
REALITY: numbers pass — `logs 45`/`planks 4` [measured: content/storage.yaml:41-53]; house `logs 8+planks 4` [measured: content/buildings.yaml:1-40]; capacity +2 [measured: apps/server/src/domain/snapshot.ts:265-272].
REALITY: deferred-asks pass — связанного issue нет (docs/plans/stage-1.4-hotfix-server-build.md:1-140).
REALITY: pr-count pass — `.gstack/ship-policy.json` отсутствует → 1 PR (default) (apps/server/test/app.test.ts:558-673).

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | not run |
| Outside Review | none | Independent 2nd opinion | 0 | — | not run |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | ISSUES OPEN | 4 issues, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | not run |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | — | not run |

- **OUTSIDE COVERAGE:** none — outside review not run (interactive plan review).
- **VERDICT:** ENG ISSUES OPEN (4 mapped findings F1–F4) — scope accepted as-is (FULL_REVIEW); ready to implement once findings are addressed. eng review required.
- **UNRESOLVED DECISIONS:** none — R1 (авто-клетка, один дом) и R2 (пропустить /office-hours) закрыты.

NO UNRESOLVED DECISIONS
