# AVANPOST Gameplay Prototype v0.1 — запуск и первые шаги

Экспериментальный локальный Phaser-прототип. Он не заменяет Peace V2, GDD или Peace Lite V1.

## Запуск в Windows через WSL

Из PowerShell в корне репозитория:

```powershell
wsl -d Ubuntu -- bash -lc 'source ~/.nvm/nvm.sh && cd /mnt/e/Avanpost-mvp-slice && npm ci'
wsl -d Ubuntu -- bash -lc 'source ~/.nvm/nvm.sh && cd /mnt/e/Avanpost-mvp-slice && npm run dev:gameplay-prototype'
```

Откройте **http://127.0.0.1:4175/**. Для остановки dev-сервера нажмите `Ctrl+C` в терминале WSL.
Требуются Node.js 22+ и npm, установленные в Ubuntu/WSL. PostgreSQL, V2 API и аккаунт не нужны.

## Первый игровой цикл

1. Нажмите жителя в сцене или в списке справа.
2. Назначьте Илью лесорубом, Марию каменщиком; Сашу — строителем. Жители сами идут к источникам, добывают и несут ресурсы.
3. Нажмите **Дом**, затем на свободную отмеченную площадку. Следите за запасами, доставкой и тремя стадиями стройки.
4. Готовый дом добавит место жилья и приведёт четвёртого жителя.
5. Постройте дополнительный склад, если складской лимит мешает доставке; затем перестройте роли и поставьте второй дом.

Клик по источнику или складу показывает его состояние. Красивый маршрут не подменяет доставку: ресурс появляется в запасе/стройке по прибытии жителя.

## Сохранение и сброс

Игра автоматически сохраняется в `localStorage` этого браузера и origin под ключом
`avanpost:gameplay-prototype:v01`. Кнопка **Новая игра** сначала просит подтверждение;
отмена оставляет сохранение на месте. Прототип не читает и не меняет сохранения Peace V2.

## Проверки разработчика

```powershell
wsl -d Ubuntu -- bash -lc 'source ~/.nvm/nvm.sh && cd /mnt/e/Avanpost-mvp-slice && npm run typecheck -w @avanpost/gameplay-prototype'
wsl -d Ubuntu -- bash -lc 'source ~/.nvm/nvm.sh && cd /mnt/e/Avanpost-mvp-slice && npm run test:gameplay-prototype'
wsl -d Ubuntu -- bash -lc 'source ~/.nvm/nvm.sh && cd /mnt/e/Avanpost-mvp-slice && npm run build -w @avanpost/gameplay-prototype'
```
