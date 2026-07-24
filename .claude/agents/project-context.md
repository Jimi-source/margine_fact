---
name: project-context
description: Полный контекст проекта margine-fact — бизнес-логика, архитектура, алгоритмы расчёта маржи и трафаретов
---

# Проект: margine-fact

Веб-сервис для расчёта маржинальности товаров на OZON. Пользователь загружает Excel/CSV файлы из личного кабинета OZON и получает расчёт маржи по каждому SKU.

## Стек и инфраструктура

- **Backend**: Node.js / Express (`index.js`)
- **Frontend**: HTML/CSS/JS (`index.html`, `app*.js`, `styles.css`)
- **БД**: PostgreSQL на VPS (31.130.130.129)
- **Деплой**: VPS через PM2 (`marginefact-api`), frontend на Vercel (`https://margine-fact.vercel.app`)
- **CI/CD**: GitHub Actions → git pull + pm2 restart на VPS при каждом push в main
- **Auth**: JWT (bcryptjs + jsonwebtoken)
- **Email**: Resend
- **Кредиты**: платная система, пакеты 1/3/5/10 кредитов

## Файловая структура

```
index.js          — весь backend (Express API + бизнес-логика расчёта)
index.html        — главная страница
app.js            — точка входа frontend
app-calc.js       — логика расчёта и рендер таблицы результатов
app-cashflow.js   — кэшфлоу: периоды, сохранение, drill-down
app-chart.js      — мини-графики в разделе "% от продаж"
app-globals.js    — глобальное состояние (state, elements)
app-main.js       — инициализация
app-auth.js       — авторизация
app-sebes.js      — управление себестоимостью
app-ui.js         — вспомогательный UI
app-utils.js      — утилиты (форматирование, даты)
app-xlsx.js       — выгрузка в Excel
styles.css        — стили
functions/src/    — вспомогательные функции (возможно устарело)
```

## Схема БД

```sql
users             — пользователи (id, email, credits, ...)
cashflow          — JSONB: {year, entries: {key → entry}, tax_rate}
sebes / user_sebes — себестоимость SKU
stencil_spend_registry   — (user_id, date, sku_name) → total_spend
stencil_order_registry   — (user_id, period_start, period_end, date, article) → total_count, sku_name
payments / yk_payments   — платежи
password_resets   — сброс пароля
```

### cashflow entry (JSONB-структура)

```js
{
  marginBeforeTax: 0.4281,
  summary: { totalAds, totalAccrual, totalCost, revenueBeforeTax, marginBeforeTax,
              totalCancelSum, summaryMarginWithoutCancel, otherServicesTotal,
              tax5, tax9, netWithTax5, netWithTax9, marginAfterTax5, marginAfterTax9,
              realizTotal, totalByGroup, totalQty },
  rows: [...],               // per-SKU строки (сохраняются с v.aaee268)
  accrualGroups: [...],
  stencilAdsByArticle: {},   // стенсил-часть рекламы по артикулу
  pvpAdsByArticle: {},       // ПВП-часть рекламы по артикулу
  stencilOrderCountsInPeriod: {}, // "article__date" → {count, skuName}
  locked: false,             // если true — период не пересчитывается автоматически
  updatedAt: "ISO"
}
```

---

## Входные файлы от пользователя

Пользователь загружает 3-5 файлов из OZON:

| Файл | Содержимое | Ключевые колонки |
|------|-----------|-----------------|
| **Заказы** | все заказы за период | Артикул, Статус, Номер заказа/отправления, Количество, Delivery date |
| **Начисления** | финансовые операции | Артикул, Тип начисления, Сумма итого, Дата принятия заказа, Название товара, ID начисления |
| **Трафарет** | расходы на рекламу (Stencil/CPM) | День, Название товара, Расход ₽ с НДС |
| **ПВП** | реклама за клики | Номер заказа, Продвижение ₽ |
| **Себестоимость** | закупочная цена | Артикул, Себестоимость |

### Важно про файлы трафаретов

- Пользователь консолидирует данные по ВСЕМ рекламным кампаниям в ОДИН сводный файл перед загрузкой (несколько кампаний работают параллельно)
- Файл трафаретов покрывает ШИРОКИЙ диапазон дат — как правило 3-6 недель назад от текущей даты
- Имя файла: `{campaign_id}_{start}-{end}.xlsx` — но campaign_id несущественен, это просто имя

---

## Алгоритм расчёта маржи (`calculateReport` в index.js)

### 1. Статусы заказов

Только строки начислений со статусом "Доставлен" (statusScore === 1) идут в расчёт выручки. Статус матчится через ID начисления → Номер заказа/отправления из файла заказов.

### 2. Начисления (accruals)

Суммируются по артикулу. Группы: Продажи, Возвраты, Услуги доставки, Вознаграждение Ozon, Продвижение и реклама, Другие услуги/штрафы. "Другие услуги" без артикула идут в `otherServicesTotal`.

### 3. ПВП (реклама за клики)

`pvpSumByOrderArticle`: суммируется по (Номер заказа, Артикул) из файла ПВП. Делится на кол-во строк с этим заказом → `promotionPerRow`. Добавляется к `adsByArticle[article]`.

### 4. Трафарет (Stencil/CPM) — самая сложная логика

#### Прямой расчёт (при первом расчёте периода)

```
stencilKey = date__skuName  (из начисления: дата заказа + название товара)
stencilSum = stencilSumByKey[stencilKey]  (из файла трафарета за эту дату)
count = кол-во строк начислений с (article, date)
stencilValue = stencilSum / count  (на одну строку начисления)
```

#### Проблема: "хвост" заказов

Начисления за период 29.06-05.07 содержат **заказы с датами 3-4 недели назад** (18-28 июня и раньше), потому что товар заказали в июне, а доставили в июле. В итоге расходы по трафарету за июньские даты попадают И в июньские периоды (при их расчёте) И в июльские (снова). **Это приводит к двойному счёту.**

#### Решение: Реестр трафаретов

**`stencil_spend_registry`** (`user_id, date, sku_name → total_spend`):
- При каждом расчёте файл трафарета записывается в реестр (UPSERT: последнее значение побеждает)
- Хранит суммарный расход по всем кампаниям за каждый день по каждому товару

**`stencil_order_registry`** (`user_id, period_start, period_end, date, article → total_count`):
- Хранит: сколько строк начислений с `(article, date_of_order)` попало в данный расчётный период
- UPSERT идемпотентный по (user_id, period_start, period_end, date, article)

#### Формула распределения

```
stencil_for_period[article][date] =
    period_count × (total_spend / total_orders)
где:
  period_count = stencil_order_registry[period][date][article]  // кол-во в ЭТОМ периоде
  total_spend  = stencil_spend_registry[date][sku_name]          // общий расход из реестра
  total_orders = SUM(stencil_order_registry[*][date][article])   // SUM по ВСЕМ периодам
```

**Смысл**: расход за дату X делится пропорционально между всеми периодами, в которых есть начисления с датой заказа X. Это устраняет двойной счёт.

#### Автопересчёт прошлых периодов

При каждом новом расчёте сервер:
1. Обновляет оба реестра
2. Загружает все cashflow-периоды пользователя за текущий и прошлый год
3. Для каждого незафиксированного периода с `stencilOrderCountsInPeriod` вызывает `recalcEntryStencil()`
4. Сохраняет изменённые периоды в БД

`recalcEntryStencil` (index.js ~1042):
- Берёт `stencilOrderCountsInPeriod` из сохранённого cashflow-entry
- Считает новые стенсил-значения по актуальному реестру
- Если `|delta| < 0.01` → возвращает null (не обновляет)
- Пересчитывает `totalAds`, `revenueBeforeTax`, `marginBeforeTax`, `summaryMarginWithoutCancel`

#### Период стабилизируется через ~4 недели

После 4 недель хвост заказов иссякает. Тогда можно зафиксировать период (`locked: true`) и он больше не будет пересчитываться.

---

## Структура frontend-расчёта (app-calc.js)

### state (app-globals.js)

```js
state = {
  lastRows: [],                    // текущие per-SKU строки
  lastSummary: {},                 // итоговый summary
  lastCalcRange: {start, end},
  forecastData: {deliveringByArticle, cancelRate},  // прогноз маржи
  lastStencilAdsByArticle: {},     // {article: {stencil, pvp}} из ответа сервера
  accrualGroups: [],
  cashflow: {year, granularity, periods, entries, selectedKey, taxRate, saveTimer}
}
```

### Per-SKU строки (row object)

```js
{
  article, skuName, qty, accrual, ads, costSum,
  margin, revenue, cancelSum,
  marginWithoutCancel, revenueWithoutCancel,
  otherPerArticle
}
```

### Прогноз маржи

- Берутся заказы в статусе "Доставляется" из файла заказов
- `cancelRate = cancelled / (delivered + cancelled)` по историческим данным из того же файла
- Для каждого "Доставляется"-заказа вычисляется ожидаемая маржа: средние начисления − реклама (с реестровой корректировкой) − себестоимость
- Реклама берётся из `lastStencilAdsByArticle` (registry-corrected), а не из `row.ads`
- Результат: колонка "Прогноз маржи" в таблице и сводная цифра в блоке результатов

### Сохранение cashflow-периода

При нажатии "Сохранить":
1. Строки корректируются: для каждого артикула `ads` заменяется на `stencil + pvp` из реестровых данных
2. Сохраняется: `{marginBeforeTax, summary, rows (corrected), accrualGroups, stencilOrderCountsInPeriod, stencilAdsByArticle, pvpAdsByArticle}`
3. Отправляется в `/cashflow` (POST)

### Drill-down в кэшфлоу

При открытии периода из кэшфлоу (если есть сохранённые `rows`):
- Восстанавливает `state.lastRows`, `state.accrualGroups`
- `state.forecastData = null`, `state.lastStencilAdsByArticle = {}` (нет актуального реестра)
- Рендерит таблицу с per-SKU данными без прогноза маржи

---

## API endpoints

| Метод | Путь | Описание |
|-------|------|----------|
| POST | `/calculate` | Основной расчёт. Принимает файлы + параметры. Возвращает rows, summary, stencilData, forecastData, updatedCashflowEntries |
| GET | `/cashflow?year=` | Загрузить кэшфлоу пользователя |
| POST | `/cashflow` | Сохранить кэшфлоу |
| GET/POST | `/sebes` | Себестоимость |
| POST | `/auth/*` | Регистрация, логин, сброс пароля |
| POST | `/payment` | Оплата кредитов |

### Ответ `/calculate`

```js
{
  ok: true,
  creditsLeft: N,
  rows: [...],              // per-SKU
  summary: {...},
  stencilData: {
    adsByArticle: {article: {stencil, pvp}},
    orderCountsInPeriod: {"article__date": {count, skuName}},
    spendByKey: {"date__skuName": amount}  // для записи в реестр
  },
  forecastData: {deliveringByArticle, cancelRate},
  updatedCashflowEntries: {key: entry}  // периоды, обновлённые автопересчётом
}
```

---

## Известные тонкости и баги (исправленные)

### 1. Shadowing-баг (исправлен в ~fa87345)

В stencil try/catch были `const spendRegistry = {}` и `const orderRegistry = {}` внутри блока, которые затеняли внешние `let`. Реестр всегда был пустым при пересчёте текущего периода. Исправлено: убраны `const`, присваивание идёт во внешние переменные.

### 2. Файл трафаретов покрывает широкий диапазон

Файл за 13.07-19.07 может покрывать даты с 29.06. При записи в реестр он **перезаписывает** данные за 29.06-05.07. Это правильно: пользователь консолидирует все кампании в один файл, поэтому последнее значение — актуальное.

### 3. Автопересчёт меняет цифры прошлых периодов

Это намеренное поведение. После загрузки трафаретов за новую неделю, прошлые периоды пересчитываются с учётом новых данных о том, сколько заказов тех дат доставилось позже. Пользователь должен это понимать.

### 4. Период 29.06-05.07 имел заниженный трафарет

При первом расчёте использовался неполный набор рекламных файлов. После загрузки полного сводного файла трафаретов (кампании 30672200, 29647905, 30332204, 29861754) при следующем расчёте автопересчёт скорректировал значения.

---

## Рабочий процесс пользователя

1. Открыть сайт → выбрать период (неделя)
2. Загрузить файлы: заказы + начисления + трафарет (сводный по всем кампаниям) + ПВП (опционально)
3. Нажать "Рассчитать" → получить таблицу по SKU с маржой, рекламой, прогнозом
4. Нажать "Сохранить в кэшфлоу" → период сохраняется, прошлые периоды автоматически пересчитываются
5. Через ~4 недели зафиксировать период (locked: true) — он больше не будет пересчитываться

## Текущие активные кампании трафаретов (по состоянию на 19.07.2026)

| Кампания | Период файла | Расход 29.06-05.07 | Расход 06.07-12.07 | Расход 13.07-19.07 |
|----------|-------------|-------------------|-------------------|-------------------|
| 29647905 | 17.06-19.07 | 7,948 | 7,947 | 14,480 |
| 30332204 | 24.06-19.07 | 4,178 | 3,980 | 11,762 |
| 30672200 | 29.06-19.07 | 3,978 | 3,968 | 380 |
| 29861754 | 19.06-19.07 | 3,236 | 0 | 0 |
| 32315668 | 13.07-19.07 | 0 | 0 | 3,994 |
| **Итого** | | **19,339** | **15,896** | **30,615** |

Кампании не пересекаются по (дата, SKU) — у каждой свои товары, поэтому UPSERT в реестр не затирает данные других кампаний.
