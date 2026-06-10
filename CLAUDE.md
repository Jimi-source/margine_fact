# marginefact-api

Веб-сервис для расчёта маржинальности. Принимает файлы Excel (.xlsx/.xls) и CSV,
считает маржинальность и возвращает результат.

## Стек
- Node.js / Express (бэкенд)
- PostgreSQL на VPS
- JWT авторизация (bcryptjs + jsonwebtoken)
- Email через Resend
- Telegram уведомления
- Фронт: HTML/CSS/JavaScript

## Где что живёт
- VPS: /var/www/marginefact-api
- Процесс на VPS: PM2, имя — marginefact-api
- Фронт: https://margine-fact.vercel.app (деплоится автоматически через Vercel)
- Бэкенд: запущен на VPS через PM2

## Деплой
При каждом пуше в main:
- Vercel автоматически деплоит фронт
- GitHub Actions заходит на VPS, делает git pull, npm install, pm2 restart marginefact-api

## Структура проекта
- index.js — весь бэкенд код
- index.html — главная страница
- app.js — фронтенд логика
- styles.css — стили
- functions/ — вспомогательные функции
- data/ — данные

## Переменные окружения (на VPS в .env, не в репозитории)
- JWT_SECRET
- RESEND_API_KEY
- TELEGRAM_BOT_TOKEN
- DATABASE_URL или параметры подключения к PostgreSQL

## Правила
- Не трогать .env файл — он только на VPS
- Не коммитить node_modules и serviceAccount.json
- После изменений проверять что сервер стартует без ошибок
