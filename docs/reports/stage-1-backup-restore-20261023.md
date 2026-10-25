# Stage 1: проверка резервной копии и восстановления

Дата: 2026-10-23  
Ветка: `feat/peace-sideview-v2`  
Исходный commit: `87b463ae225f2c690d80f2cb29bba0f55eb4263a`

## Вердикт

`PASS`. Резервная копия восстанавливается в отдельную БД. Данные восстановленной БД совпадают с основной БД `avanpost` по количеству строк и MD5-хэшам всех 22 таблиц. Основная БД не изменялась.

## Резервная копия

| Параметр | Значение |
|---|---|
| Файл | `/Users/labiozzza/Projects/avanpost-before-sideview.dump` |
| Размер | `882365` байт (`862K`) |
| SHA-256 | `806cda9484984766a4bcebdd75805c705eab075430581514dbd067a10c07159b` |
| Формат | custom dump PostgreSQL |

Проверка checksum:

```bash
shasum -a 256 /Users/labiozzza/Projects/avanpost-before-sideview.dump
```

## Окружение

- PostgreSQL запущен только в Docker: контейнер `avanpost-postgres-1`, образ `postgres:17-alpine`.
- Host port: `5433`.
- Пользователь, пароль и БД: `avanpost`.
- `psql` и `pg_restore` на хосте отсутствуют в `PATH`; команды выполнялись через `docker exec`.

## Восстановление

Временная БД: `avanpost_restore_check_20261023_1400`.

```bash
docker exec avanpost-postgres-1 createdb -U avanpost avanpost_restore_check_20261023_1400
docker exec -i avanpost-postgres-1 pg_restore -U avanpost -d avanpost_restore_check_20261023_1400 --no-owner --no-privileges < /Users/labiozzza/Projects/avanpost-before-sideview.dump
```

`pg_restore` завершился с кодом `0`.

## Сверка данных

Сравнение выполнялось по каждой таблице: количество строк и MD5 от отсортированного текстового представления строк.

```sql
DO $$
DECLARE
  r record;
  h text;
  c bigint;
BEGIN
  FOR r IN
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY 1
  LOOP
    EXECUTE format(
      'SELECT count(*), md5(coalesce(string_agg(t::text, ''|'' ORDER BY t::text), '''')) FROM %I t',
      r.table_name
    ) INTO c, h;
    RAISE NOTICE '%|%|%', r.table_name, c, h;
  END LOOP;
END $$;
```

Запрос выполнен в обеих БД, результаты отсортированы и сравнены через `diff`. Расхождений нет.

| Таблица | Строк | MD5 |
|---|---:|---|
| `building_buffer` | 28 | `97540cbdfd9edf72191c5014ea11b561` |
| `building_material` | 172 | `b2a06322573c164c139a20674d511844` |
| `building` | 86 | `aef7f08e8aebef0e4601188be2f94c04` |
| `clearing_job` | 0 | `d41d8cd98f00b204e9800998ecf8427e` |
| `command_log` | 274 | `80db66accc75f590a490989113a7b382` |
| `craft_order` | 15 | `ba3acfa9f6322fb3c5b26b2ad5d5ee01` |
| `haul_task` | 33 | `a7bb286ccdadac27e65a9f6f0b6b5e94` |
| `laborer` | 594 | `026003e0721a50563ffddb2eb2f26acb` |
| `outbox_event` | 342 | `dcf2f8454d24020d01ab3c53ed6d1639` |
| `players` | 167 | `529c823b7a4acc41f969ebe9778ec23b` |
| `research_project` | 28 | `63864c3a3948b771f2246d7e862a9534` |
| `researched_technology` | 15 | `5579523b6f891cf1c71af4607a680a04` |
| `resident` | 449 | `94c524c360321cea4bcb2a228cedeee7` |
| `resource_node` | 725 | `7414001b5fb0451d58f26f180057f808` |
| `schema_migrations` | 11 | `01c7069c18b53a590ce8d881dbc983a7` |
| `sessions` | 145 | `a2dc374a2619b608c4a7eb7d7888dd2e` |
| `storage_item` | 883 | `bee6604e29121ea1d42947c07d01d40e` |
| `storage` | 435 | `be673ffc78b12e0507cdddf2b1a514fd` |
| `terrain_cell` | 222720 | `24709bdcce7e547f4a0558633378e658` |
| `transfer_task` | 167 | `549361202e8e15d07e6082d306eb3634` |
| `world_sector` | 145 | `f40ae83aca33bb997f5eb72c8c0f3c4f` |
| `world_state` | 145 | `b38c81c4a49248300bb48fbd9359a807` |

## Ограничения и миграции

- 38 внешних ключей; `NOT VALID` — 0.
- 11 миграций: `0001_init.sql`–`0011_server_clock.sql`; набор совпадает с основной БД.
- Размер восстановленной БД: `33 MB`.
- Размер основной БД: `36 MB`; различие объясняется физическим размером/блoatом, не составом данных.

## Безопасность основной БД

- Основная БД `avanpost` не изменялась.
- `TRUNCATE`, `DROP`, `ALTER` и миграции в основной БД не выполнялись.
- Временная БД создана отдельно и может быть удалена после приёмки:

```bash
docker exec avanpost-postgres-1 dropdb -U avanpost avanpost_restore_check_20261023_1400
```

## Следующее применение

Отчёт является воротами пакета S0. Перед миграционными испытаниями использовать только отдельную копию БД, никогда основную `avanpost`.
