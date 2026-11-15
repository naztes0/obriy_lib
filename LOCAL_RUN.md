# Локальний запуск

Код: F:\uni\ГП\obriy_lib, гілка frontend.

- Frontend: http://127.0.0.1:5174
- Backend: http://127.0.0.1:3000/health
- PostgreSQL: 127.0.0.1:5433, база obriy_lib, користувач obriy
- Контейнер: obriy-lib-postgres; volume: obriy-lib-pgdata
- Початковий вхід: manager / ObriyLocal2026!

Локальні параметри збережено в .env (ігнорується Git). База порожня, крім завідувача. Логи поточного запуску: .local/backend.log, .local/backend-error.log, .local/frontend.log, .local/frontend-error.log.

Порт 5174 вибрано окремо від іншого локального Docker-проєкту, налаштованого на 5173.

## Повторний запуск

Запустити Docker Desktop, потім у PowerShell:

```powershell
cd 'F:\uni\ГП\obriy_lib'
docker start obriy-lib-postgres
pnpm.cmd dev:backend
```

В іншому терміналі:

```powershell
cd 'F:\uni\ГП\obriy_lib'
pnpm.cmd --filter @obriy/frontend exec vite --host 127.0.0.1 --port 5174 --strictPort
```

Не запускайте другий екземпляр поверх уже активних серверів. Поточний запуск працює у фонових node-процесах. PostgreSQL зберігає дані у volume; docker stop obriy-lib-postgres зупиняє БД без видалення даних.

## Перевірки

```powershell
pnpm.cmd --filter @obriy/frontend test
pnpm.cmd test
pnpm.cmd build:frontend
```

Результат 15.11.2026: frontend 19/19, backend 136/136, build успішний. Усі 9 міграцій застосовано.
