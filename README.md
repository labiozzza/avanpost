# Аванпост

Игра по `Avanpost_GDD_v0.9.md`: мирное поселение (этап I) и военный аванпост (этап II).

Текущий фокус — этап I: сервер-авторитетное поселение с рубкой, логистикой, жителями, школами, стройкой, ремеслом и исследованиями. Клиент — Phaser 3, читает `WorldSnapshot` и отправляет команды на сервер; отдельной клиентской экономики нет.

## Стек

Phaser 3 + TypeScript + Vite + Fastify + PostgreSQL (Kysely), npm workspaces. Решение: `docs/adr/0001-stack-and-repo-layout.md`.

## Быстрый старт

```bash
npm install
cp .env.example .env
npm run db:up
npm run db:migrate
npm run dev
```

- Клиент: http://localhost:5173
- Ускоренный цикл для проверки: http://localhost:5173/?fast=1
- API (для серверных пакетов): http://localhost:8787/api/health

Если Docker-демон не запущен, поднимите его (`colima start` или Docker Desktop), затем повторите `npm run db:up`.

## Команды

```bash
npm run build      # сборка сервера и PWA-клиента
npm run typecheck  # типы всех пакетов
npm test           # unit + integration (нужен Postgres)
npm run e2e        # Playwright desktop + mobile (нужны Postgres и собранный клиент)
npm run db:down    # остановить Postgres
```

Параметры мира, предметов, складов и зданий — в `content/world_balance.yaml`, `content/items.yaml`, `content/storage.yaml`, `content/buildings.yaml`. Сервер валидирует все реестры при старте и отдаёт каталог в снимке. Подробности: `docs/adr/0002-world-balance-and-region.md`, `docs/adr/0003-economy-buffers-and-hauling.md`, `docs/adr/0004-construction-and-transfer-tasks.md`.

Стартовые склады содержат 45 брёвен и 35 камня; дом стоит 8 брёвен и 4 доски. Здания ставятся призраком по сетке (зелёный — можно, жёлтый — ждут материалы). Integration-тесты используют `TEST_DATABASE_URL` и базу `avanpost_test`, создаваемую при инициализации контейнера. Архитектура клиента: `docs/adr/0007-phaser-authoritative-client.md`.

## Структура

```
apps/client      Phaser-клиент (src/phaser, src/game), PWA
apps/server      Fastify API, Kysely, миграции
packages/shared  протокол, типы снимка, константы мира
packages/sim     детерминированный RNG, рельеф, граф, расчистка
content          P0-реестры баланса (мир, предметы, склады, здания)
db/migrations    SQL-миграции
e2e              Playwright
docs             ADR, планы пакетов, отчёты, доказательства
```

## Принципы

- Сервер авторитетен; клиент отправляет команды с `request_id` и `expected_version`.
- Целые единицы и серверное время.
- Локальный кеш нужен только для чтения при потере сети.
- Пакет считается сданным только с тестами, скриншотами и фактическим результатом запуска (GDD 23).

## Peace V2 (в разработке)

V2 использует отдельные workspaces, Compose project и базы данных; команды V1 из инструкций выше для него не применяются. Текущий проверенный локальный игровой срез и адреса для плейтеста: `docs/v2/PLAY_NOW.md`; статус, текущий bind и gate: `docs/v2/STATUS.md`; OpenCode runbook: `docs/v2/AGENT_RUNBOOK.md`. G2 остаётся в разработке до ручной проверки на физическом телефоне и завершения полного мирного Stage I.
