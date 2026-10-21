# Аванпост

Игра по `Avanpost_GDD_v0.9.md`. Стартовый стек: Phaser 3 + TypeScript + Vite + Fastify + Postgres (см. ADR).

**gstack обязателен для всех задач в этом проекте.** Пользователь явно разрешил использование gstack-skills для каждой задачи. При работе используй подходящие gstack skills (`/browse`, `/design-review`, `/investigate`, `/review`, `/ship` и т.д.) автоматически, без дополнительного запроса согласия.

## Правило: "Играбельный интерфейс на каждом этапе" (Playable UI First)

1. Мы больше не пишем бэкенд "в стол". Если ты реализуешь новую механику (население, школы, исследования, рейды), ты ОБЯЗАН сразу же делать для неё минимальный, но играбельный UI и визуализацию на сцене.
2. Никакого "сделаем визуал позже". Если ты делаешь этап I.4 (Население), пользователь должен сразу открыть игру, увидеть панель со списком жителей, нажать на жителя, назначить его на работу и увидеть, как он визуально изменился на экране. Не надо ждать этапа I.7 (Финальная отрисовка). Этап I.7 — это только замена временной графики на финальную, а не создание интерфейсов с нуля.
3. Временные ассеты (Placeholder Art). Используй скачанные ассеты Kenney для всего, чего ещё нет. Если делаешь обучение в школе — поставь домик школы, если делаешь торговлю — поставь тележку. Игра должна выглядеть как игра на каждом коммите.

## Skill routing

When the user's request matches an available skill, invoke it via the Skill tool. Route only to skills in the session's available-skills list; answer directly for quick questions or small scoped edits.

Key routing rules:
- Product ideas/brainstorming → invoke /office-hours
- Strategy/scope → invoke /plan-ceo-review
- Architecture → invoke /plan-eng-review
- Design system/plan review → invoke /design-consultation or /plan-design-review
- Full review pipeline → invoke /autoplan
- Bugs/errors → invoke /investigate
- QA/testing site behavior → invoke /qa or /qa-only
- Code review/diff check → invoke /review
- Visual polish → invoke /design-review
- Ship/deploy/PR → invoke /ship or /land-and-deploy
- Save progress → invoke /context-save
- Resume context → invoke /context-restore
- Author a backlog-ready spec/issue → invoke /spec
