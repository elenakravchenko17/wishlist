/**
 * PERSONAL WISHLIST — серверная часть (Google Apps Script)
 * ---------------------------------------------------------
 * Этот код вставляется в Google Таблицу (Расширения → Apps Script) и работает как API
 * для страницы на GitHub Pages. Данные хранятся в таблице, страница их только показывает.
 *
 * Гости (без пароля):   data, claim, undoClaim, contribute, giftRecurring
 * Владелец (по секретной ссылке): adminData, saveWish, deleteWish, uploadPhoto, saveSettings
 * Меню «Wishlist» в таблице: настройка, ссылки, резервные копии.
 *
 * Столбцы ищутся по НАЗВАНИЯМ — новые столбцы можно добавлять куда угодно.
 */

// ===================== НАСТРОЙКИ =====================

var APP = {
  SHEETS: {
    WISH: 'WISHLIST', PERM: 'ПОСТОЯННЫЕ', MONTH: 'ЕЖЕМЕСЯЧНЫЕ', RARE: 'РЕДКИЕ',
    DONE: 'ИСПОЛНЕННЫЕ', LOG: 'ИСТОРИЯ', MONEY: 'ДЕНЕЖНЫЕ ВКЛАДЫ',
    EXEC: 'ИСПОЛНЕНИЯ', REF: 'СПРАВОЧНИКИ', STAT: 'СТАТИСТИКА', RSTAT: 'СТАТ. ПОВТОРОВ', TRASH: 'КОРЗИНА'
  },
  CATEGORIES: ['Постоянные', 'Ежемесячные', 'Редкие'],
  STATUSES: ['В списке', 'Присмотрено', 'Подарят', 'Получено', 'Больше не актуально'],
  FREE: ['В списке', 'Присмотрено'],
  TAKEN: ['Подарят', 'Забронировано', 'Куплено'], // два последних — на случай старых записей
  PRIORITIES: ['Мечтаю', 'Очень хочу', 'Хочу', 'Было бы приятно'],
  REPEAT: ['Нет', 'Неограниченно', 'Периодически', 'Впечатление'],
  PERIODS: ['Ежедневно', 'Еженедельно', 'Ежемесячно', 'Раз в 3 месяца', 'Раз в полгода', 'Ежегодно', 'Свой интервал'],
  CURRENCIES: ['RUB', 'USD', 'EUR', 'GBP', 'CNY', 'AED', 'TRY', 'KZT', 'GEL', 'AMD'],
  SUBCATEGORIES: ['Одежда', 'Обувь', 'Аксессуары', 'Красота и уход', 'Дом и интерьер', 'Книги',
    'Техника', 'Хобби', 'Спорт', 'Впечатления', 'Кафе и рестораны', 'Цветы', 'Путешествия', 'Другое'],
  STATUS_COLORS: {
    'В списке': ['#E4ECE1', '#4F6E4B'],
    'Присмотрено': ['#F2E9D5', '#86672A'],
    'Подарят': ['#F5DFD2', '#9C4E2B'],
    'Получено': ['#ECE2EB', '#6F4C6A'],
    'Больше не актуально': ['#ECEAE6', '#8A847E']
  },
  MAX_AMOUNT: 10000000,
  RATE_LIMIT_PER_MIN: 40,
  MAX_PHOTO_BYTES: 4 * 1024 * 1024,
  PHOTO_FOLDER: 'Wishlist — фото',
  BACKUP_FOLDER: 'Wishlist — резервные копии',
  BACKUPS_TO_KEEP: 30
};

var WISH_COLS = [
  ['id', 'ID'],
  ['title', 'Название'],
  ['description', 'Описание'],
  ['category', 'Категория'],
  ['subcategory', 'Подкатегория'],
  ['url', 'Ссылка на товар'],
  ['url2', 'Альтернативная ссылка'],
  ['photo', 'Фото (ссылка)'],
  ['brand', 'Бренд'],
  ['model', 'Модель'],
  ['shop', 'Магазин'],
  ['price', 'Цена'],
  ['currency', 'Валюта'],
  ['qty', 'Количество'],
  ['specs', 'Характеристики'],
  ['priority', 'Приоритет'],
  ['status', 'Статус'],
  ['claimedBy', 'Дарит'],
  ['claimedAt', 'Дата отметки'],
  ['claimNote', 'Комментарий дарящего'],
  ['comment', 'Комментарий (личный)'],
  ['addedAt', 'Дата добавления'],
  ['wishes', 'Пожелания к подарку'],
  ['month', 'Месяц (ГГГГ-ММ)'],
  ['targetDate', 'Ориентировочная дата'],
  ['budget', 'Желаемый бюджет'],
  ['repeatType', 'Тип повторения'],
  ['period', 'Периодичность'],
  ['periodDays', 'Свой интервал, дней'],
  ['unitCost', 'Стоимость одного исполнения'],
  ['amountMin', 'Сумма от'],
  ['amountMax', 'Сумма до'],
  ['timesDone', 'Количество исполнений'],
  ['lastDone', 'Последнее исполнение'],
  ['nextAvailable', 'Следующая доступность'],
  ['visible', 'Показывать на странице'],
  ['_hash', '_отмена (служебное)'],
  ['_prev', '_статус до отметки (служебное)']
];

// Поля, которые владелец может менять из приложения
var EDITABLE = ['title', 'description', 'category', 'subcategory', 'url', 'url2', 'photo', 'brand', 'model', 'shop',
  'price', 'currency', 'qty', 'specs', 'priority', 'status', 'comment', 'wishes', 'month', 'targetDate', 'budget',
  'repeatType', 'period', 'periodDays', 'unitCost', 'amountMin', 'amountMax', 'nextAvailable', 'visible'];

var LOG_COLS = ['ID записи', 'Дата и время', 'ID желания', 'Название', 'Действие', 'Имя', 'Комментарий', 'Статус после'];
var MONEY_COLS = ['ID вклада', 'Дата и время', 'ID желания', 'Название желания', 'Имя', 'Сумма', 'Валюта', 'Комментарий', 'Тип'];
var EXEC_COLS = ['ID исполнения', 'Дата и время', 'ID желания', 'Название', 'Тип повторения', 'Имя', 'Сумма', 'Валюта', 'Комментарий', '№ исполнения', 'ID вклада'];

var SETTINGS_DEFAULT = [
  ['Название страницы', 'Мой Wishlist'],
  ['Подзаголовок', 'Здесь собраны мои желания. Спасибо, что заглянули!'],
  ['Показывать исполненные', 'Да'],
  ['Валюта по умолчанию', 'RUB'],
  ['Адрес страницы (GitHub Pages)', '']
];

// ===================== ВХОД API =====================

function doGet(e) {
  return json_(handle_({ action: (e && e.parameter && e.parameter.action) || 'data' }));
}

function doPost(e) {
  var p;
  try { p = JSON.parse(e && e.postData && e.postData.contents || '{}'); } catch (err) { p = {}; }
  return json_(handle_(p));
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function handle_(p) {
  var publicActions = { data: getPublicData_, claim: claimWish_, undoClaim: undoClaim_, contribute: contribute_, giftRecurring: giftRecurring_ };
  var ownerActions = { adminData: adminData_, saveWish: saveWish_, deleteWish: deleteWish_, uploadPhoto: uploadPhoto_, saveSettings: saveSettings_ };
  return api_(function () {
    var a = String(p && p.action || '');
    if (publicActions[a]) return publicActions[a](p);
    if (ownerActions[a]) { checkOwnerKey_(p.key); return ownerActions[a](p); }
    throw userErr_('Неизвестное действие.');
  });
}

// ===================== ГОСТИ =====================

function getPublicData_() {
  var settings = readSettings_();
  var t = wishTable_();
  var today = dayStr_(new Date());
  var wishes = [], fulfilled = [];
  t.items.forEach(function (w) {
    if (!w.id || !w.title || isNo_(w.visible)) return;
    var status = w.status || 'В списке';
    if (status === 'Больше не актуально') return;
    var mode = repeatMode_(w);
    if (mode === 'none' && status === 'Получено') {
      if (settings.showFulfilled) fulfilled.push({ id: w.id, title: w.title, photo: photoUrl_(w.photo), category: w.category, subcategory: str_(w.subcategory), brand: str_(w.brand) });
      return;
    }
    wishes.push(publicWish_(w, settings, today));
  });
  return {
    ok: true, today: today, wishes: wishes, fulfilled: fulfilled,
    settings: { title: settings.title, subtitle: settings.subtitle, currency: settings.currency, currencies: settings.currencies, showFulfilled: settings.showFulfilled }
  };
}

function publicWish_(w, settings, today) {
  var status = w.status || 'В списке';
  if (APP.TAKEN.indexOf(status) >= 0) status = 'Подарят';
  var item = {
    id: w.id, title: w.title, description: str_(w.description), category: str_(w.category) || 'Постоянные',
    subcategory: str_(w.subcategory), url: safeUrl_(w.url), url2: safeUrl_(w.url2), photo: photoUrl_(w.photo),
    brand: str_(w.brand), model: str_(w.model), shop: str_(w.shop), price: num_(w.price),
    currency: str_(w.currency) || settings.currency, qty: num_(w.qty) || 1, specs: str_(w.specs), priority: str_(w.priority),
    wishes: str_(w.wishes), month: monthStr_(w.month, w.addedAt), targetDate: dateOrText_(w.targetDate), budget: num_(w.budget),
    addedAt: w.addedAt instanceof Date ? dayStr_(w.addedAt) : '', status: status
  };
  var mode = repeatMode_(w);
  if (mode !== 'none') {
    var next = w.nextAvailable instanceof Date ? dayStr_(w.nextAvailable) : '';
    var available = mode === 'unlimited' || !next || next <= today;
    item.recurring = {
      type: w.repeatType, period: mode === 'periodic' ? periodLabel_(w) : '',
      unitCost: num_(w.unitCost), min: num_(w.amountMin), max: num_(w.amountMax),
      timesDone: num_(w.timesDone) || 0, nextAvailable: available ? '' : next, available: available
    };
    item.status = available ? 'Доступно' : 'Скоро снова';
  }
  return item;
}

/** «Подарю это»: желание сразу становится занятым для остальных. Возвращает токен для отмены с этого устройства. */
function claimWish_(p) {
  guard_(p);
  var name = cleanName_(p.name);
  var note = cleanText_(p.comment, 300);
  if (p.confirm !== true) throw userErr_('Подтвердите галочкой.');
  var id = cleanId_(p.wishId);
  return withLock_(function () {
    var t = wishTable_();
    var w = findPublicWish_(t, id);
    if (repeatMode_(w) !== 'none') throw userErr_('Это повторяющееся желание — его можно дарить много раз. Нажмите «Подарить».');
    var status = w.status || 'В списке';
    if (APP.TAKEN.indexOf(status) >= 0) throw userErr_('Это желание уже кто-то дарит. Выберите, пожалуйста, другое.');
    if (APP.FREE.indexOf(status) < 0) throw userErr_('Это желание сейчас недоступно.');
    var token = genToken_();
    setWish_(t, w, { status: 'Подарят', claimedBy: name, claimedAt: new Date(), claimNote: note, _hash: hash_(token, id), _prev: status });
    log_(w, 'Подарю', name, note, 'Подарят');
    return { ok: true, wishId: id, title: w.title, token: token };
  });
}

/** Отмена «Подарю это» с того же устройства (по скрытому токену). */
function undoClaim_(p) {
  guard_(p);
  var id = cleanId_(p.wishId);
  var token = String(p.token || '');
  return withLock_(function () {
    var t = wishTable_();
    var w = findWish_(t, id);
    if (APP.TAKEN.indexOf(w.status) < 0) throw userErr_('Отменять уже нечего — статус изменился.');
    if (!w._hash || !token || w._hash !== hash_(token, id)) throw userErr_('Отменить можно только с того устройства, где нажимали «Подарю это». Напишите владельцу списка.');
    var back = APP.FREE.indexOf(w._prev) >= 0 ? w._prev : 'В списке';
    var who = w.claimedBy;
    setWish_(t, w, { status: back, claimedBy: '', claimedAt: '', claimNote: '', _hash: '', _prev: '' });
    log_(w, 'Отмена (гость)', who, '', back);
    return { ok: true, wishId: id };
  });
}

/** Денежный вклад — самостоятельный подарок; статус желания не меняется. */
function contribute_(p) {
  guard_(p);
  var name = cleanName_(p.name);
  var settings = readSettings_();
  var amount = parseAmount_(p.amount);
  var currency = cleanCurrency_(p.currency, settings);
  var comment = cleanText_(p.comment, 500);
  if (p.confirm !== true) throw userErr_('Подтвердите вклад галочкой.');
  var id = p.wishId ? cleanId_(p.wishId) : '';
  return withLock_(function () {
    var title = 'Без привязки к желанию';
    if (id) title = findPublicWish_(wishTable_(), id).title;
    var moneyId = nextLogId_(APP.SHEETS.MONEY, 'V');
    appendRow_(APP.SHEETS.MONEY, {
      'ID вклада': moneyId, 'Дата и время': new Date(), 'ID желания': id, 'Название желания': title,
      'Имя': name, 'Сумма': amount, 'Валюта': currency, 'Комментарий': comment, 'Тип': id ? 'Вклад в желание' : 'Без привязки'
    });
    return { ok: true, contributionId: moneyId, amount: amount, currency: currency };
  });
}

/** Повторяющееся желание: деньги + запись исполнения; копия желания не создаётся. */
function giftRecurring_(p) {
  guard_(p);
  var name = cleanName_(p.name);
  var id = cleanId_(p.wishId);
  var comment = cleanText_(p.comment, 500);
  var amount = parseAmount_(p.amount);
  if (p.confirm !== true) throw userErr_('Подтвердите подарок галочкой.');
  return withLock_(function () {
    var settings = readSettings_();
    var t = wishTable_();
    var w = findPublicWish_(t, id);
    var mode = repeatMode_(w);
    if (mode === 'none') throw userErr_('Это обычное желание — нажмите «Подарю это» или сделайте вклад.');
    var today = new Date();
    if (mode === 'periodic' && w.nextAvailable instanceof Date && dayStr_(w.nextAvailable) > dayStr_(today)) {
      throw userErr_('Это желание уже исполнили. Снова доступно с ' + ruDate_(w.nextAvailable) + '.');
    }
    var min = num_(w.amountMin), max = num_(w.amountMax);
    if (min && amount < min) throw userErr_('Минимальная сумма для этого подарка — ' + fmtMoney_(min) + '.');
    if (max && amount > max) throw userErr_('Максимальная сумма для этого подарка — ' + fmtMoney_(max) + '.');
    var currency = str_(w.currency) || settings.currency;
    var n = countRows_(APP.SHEETS.EXEC, 'ID желания', id) + 1;
    var moneyId = nextLogId_(APP.SHEETS.MONEY, 'V');
    appendRow_(APP.SHEETS.MONEY, {
      'ID вклада': moneyId, 'Дата и время': today, 'ID желания': id, 'Название желания': w.title,
      'Имя': name, 'Сумма': amount, 'Валюта': currency, 'Комментарий': comment, 'Тип': 'Подарок-исполнение'
    });
    appendRow_(APP.SHEETS.EXEC, {
      'ID исполнения': nextLogId_(APP.SHEETS.EXEC, 'E'), 'Дата и время': today, 'ID желания': id, 'Название': w.title,
      'Тип повторения': w.repeatType, 'Имя': name, 'Сумма': amount, 'Валюта': currency,
      'Комментарий': comment, '№ исполнения': n, 'ID вклада': moneyId
    });
    var next = mode === 'periodic' ? nextDate_(today, w.period, w.periodDays) : '';
    var upd = { timesDone: n, lastDone: today, nextAvailable: next };
    if (APP.FREE.indexOf(w.status) < 0) upd.status = 'В списке';
    setWish_(t, w, upd);
    return { ok: true, wishId: id, timesDone: n, nextAvailable: next ? dayStr_(next) : '', available: !next };
  });
}

// ===================== ВЛАДЕЛЕЦ =====================

function checkOwnerKey_(key) {
  var cache = CacheService.getScriptCache();
  var bad = Number(cache.get('badkey') || 0);
  if (bad >= 10) throw userErr_('Слишком много неудачных попыток. Подождите 15 минут.');
  var real = PropertiesService.getScriptProperties().getProperty('ADMIN_KEY') || '';
  var k = String(key || '');
  var diff = real.length === k.length && real.length >= 20 ? 0 : 1;
  for (var i = 0; i < Math.min(real.length, k.length); i++) diff |= real.charCodeAt(i) ^ k.charCodeAt(i);
  if (diff) {
    cache.put('badkey', String(bad + 1), 900);
    throw userErr_('Секретная ссылка владельца не подходит. Откройте актуальную ссылку из меню таблицы.');
  }
}

/** Всё для режима владельца: желания со всеми полями, история, итоги, справочники. */
function adminData_() {
  var settings = readSettings_();
  var t = wishTable_();
  var today = dayStr_(new Date());
  var wishes = t.items.filter(function (w) { return w.id && w.title; }).map(function (w) {
    var item = publicWish_(w, settings, today);
    item.rawStatus = w.status || 'В списке';
    item.visible = !isNo_(w.visible);
    item.comment = str_(w.comment);
    item.claimedBy = str_(w.claimedBy);
    item.claimedAt = w.claimedAt instanceof Date ? dayStr_(w.claimedAt) : '';
    item.claimNote = str_(w.claimNote);
    item.repeatType = str_(w.repeatType) || 'Нет';
    item.period = str_(w.period);
    item.periodDays = num_(w.periodDays);
    item.unitCost = num_(w.unitCost); item.amountMin = num_(w.amountMin); item.amountMax = num_(w.amountMax);
    item.nextAvailableRaw = w.nextAvailable instanceof Date ? dayStr_(w.nextAvailable) : '';
    item.targetDateRaw = w.targetDate instanceof Date ? dayStr_(w.targetDate) : str_(w.targetDate);
    item.monthRaw = monthStr_(w.month, null);
    item.photoRaw = str_(w.photo);
    item.timesDone = num_(w.timesDone) || 0;
    return item;
  });
  var money = readLog_(APP.SHEETS.MONEY, 300);
  var exec = readLog_(APP.SHEETS.EXEC, 300);
  var totals = {};
  readLog_(APP.SHEETS.MONEY, 100000).forEach(function (r) {
    var c = r['Валюта'] || '?'; totals[c] = (totals[c] || 0) + (Number(r['Сумма']) || 0);
  });
  var byWish = {}, byPerson = {};
  readLog_(APP.SHEETS.EXEC, 100000).forEach(function (r) {
    var kw = r['Название'] + '|' + r['Валюта'], kp = r['Имя'] + '|' + r['Валюта'];
    byWish[kw] = byWish[kw] || { title: r['Название'], currency: r['Валюта'], count: 0, sum: 0, last: '' };
    byPerson[kp] = byPerson[kp] || { name: r['Имя'], currency: r['Валюта'], count: 0, sum: 0 };
    byWish[kw].count++; byWish[kw].sum += Number(r['Сумма']) || 0; byWish[kw].last = r['Дата и время'] > byWish[kw].last ? r['Дата и время'] : byWish[kw].last;
    byPerson[kp].count++; byPerson[kp].sum += Number(r['Сумма']) || 0;
  });
  var values = function (o) { return Object.keys(o).map(function (k) { return o[k]; }).sort(function (a, b) { return b.count - a.count; }); };
  return {
    ok: true, today: today, wishes: wishes,
    log: readLog_(APP.SHEETS.LOG, 300), money: money, exec: exec,
    stats: { moneyTotals: totals, recurringByWish: values(byWish), recurringByPerson: values(byPerson) },
    lists: { categories: APP.CATEGORIES, subcategories: refList_('Подкатегории', APP.SUBCATEGORIES), statuses: APP.STATUSES,
      priorities: APP.PRIORITIES, repeat: APP.REPEAT, periods: APP.PERIODS, currencies: settings.currencies },
    settings: { title: settings.title, subtitle: settings.subtitle, currency: settings.currency, currencies: settings.currencies,
      showFulfilled: settings.showFulfilled, pageUrl: settings.pageUrl }
  };
}

/** Добавить или изменить желание. */
function saveWish_(p) {
  var src = p.wish || {};
  var settings = readSettings_();
  var f = {};
  EDITABLE.forEach(function (k) { if (Object.prototype.hasOwnProperty.call(src, k)) f[k] = src[k]; });
  // проверки
  f.title = cleanText_(f.title, 200);
  if (!f.title) throw userErr_('Укажите название желания.');
  ['description', 'specs', 'wishes', 'comment', 'brand', 'model', 'shop'].forEach(function (k) { if (k in f) f[k] = cleanText_(f[k], k === 'description' || k === 'comment' ? 1000 : 300); });
  if ('subcategory' in f) f.subcategory = cleanText_(f.subcategory, 60);
  if ('targetDate' in f) f.targetDate = cleanText_(f.targetDate, 60);
  ['url', 'url2', 'photo'].forEach(function (k) {
    if (k in f) { f[k] = str_(f[k]); if (f[k] && !safeUrl_(f[k])) throw userErr_('Ссылка должна начинаться с https:// (поле «' + colHeader_(k) + '»).'); }
  });
  if ('category' in f || !src.id) f.category = APP.CATEGORIES.indexOf(f.category) >= 0 ? f.category : 'Постоянные';
  if ('status' in f && APP.STATUSES.indexOf(f.status) < 0 && APP.TAKEN.indexOf(f.status) < 0) throw userErr_('Неизвестный статус.');
  if ('priority' in f && f.priority && APP.PRIORITIES.indexOf(f.priority) < 0) throw userErr_('Неизвестный приоритет.');
  if ('currency' in f) f.currency = cleanCurrency_(f.currency || settings.currency, settings);
  if ('repeatType' in f) f.repeatType = APP.REPEAT.indexOf(f.repeatType) >= 0 ? f.repeatType : 'Нет';
  if ('period' in f && f.period && APP.PERIODS.indexOf(f.period) < 0) throw userErr_('Неизвестная периодичность.');
  if (f.repeatType === 'Периодически' && !f.period) throw userErr_('Для «Периодически» выберите периодичность.');
  ['price', 'qty', 'budget', 'periodDays', 'unitCost', 'amountMin', 'amountMax'].forEach(function (k) {
    if (!(k in f)) return;
    var s = str_(f[k]);
    if (!s) { f[k] = ''; return; }
    f[k] = parseAmount_(s);
  });
  if (f.amountMin && f.amountMax && f.amountMin > f.amountMax) throw userErr_('«Сумма от» больше, чем «Сумма до».');
  if (f.period === 'Свой интервал' && !(f.periodDays >= 1)) throw userErr_('Укажите интервал в днях.');
  if ('month' in f) { f.month = str_(f.month); if (f.month && !/^\d{4}-\d{2}$/.test(f.month)) throw userErr_('Месяц укажите в формате ГГГГ-ММ.'); }
  if ('nextAvailable' in f) f.nextAvailable = f.nextAvailable ? parseAnyDay_(f.nextAvailable) : '';
  if ('visible' in f) f.visible = (f.visible === false || isNo_(f.visible)) ? 'Нет' : 'Да';

  return withLock_(function () {
    var t = wishTable_();
    var w;
    if (src.id) {
      w = findWish_(t, cleanId_(src.id));
      var wasTaken = APP.TAKEN.indexOf(w.status) >= 0;
      if ('status' in f && wasTaken && APP.FREE.indexOf(f.status) >= 0) {
        f.claimedBy = ''; f.claimedAt = ''; f.claimNote = ''; f._hash = ''; f._prev = '';
      }
      var becameReceived = f.status === 'Получено' && w.status !== 'Получено';
      setWish_(t, w, f);
      log_(w, becameReceived ? 'Получено' : 'Изменено владельцем', 'Владелец', '', w.status);
    } else {
      var maxId = 0;
      t.items.forEach(function (x) { var m = String(x.id).match(/(\d+)$/); if (m) maxId = Math.max(maxId, Number(m[1])); });
      f.id = 'W-' + ('0000' + (maxId + 1)).slice(-4);
      f.addedAt = new Date();
      f.status = f.status || 'В списке';
      f.qty = f.qty || 1;
      f.currency = f.currency || settings.currency;
      f.visible = f.visible || 'Да';
      f.repeatType = f.repeatType || 'Нет';
      if (f.category === 'Ежемесячные' && !f.month) f.month = Utilities.formatDate(new Date(), tz_(), 'yyyy-MM');
      if (f.repeatType !== 'Нет') f.timesDone = 0;
      var headers = t.sh.getRange(1, 1, 1, t.sh.getLastColumn()).getValues()[0].map(function (h) { return String(h).trim(); });
      var row = headers.map(function () { return ''; });
      Object.keys(f).forEach(function (k) { if (t.idx[k] >= 0) row[t.idx[k]] = f[k]; });
      var r = t.sh.getLastRow() + 1;
      t.sh.getRange(r, 1, 1, row.length).setValues([row]);
      w = { id: f.id, title: f.title };
      log_(w, 'Добавлено', 'Владелец', '', f.status);
    }
    if (f.subcategory) addToRefList_('Подкатегории', f.subcategory);
    return { ok: true, id: w.id };
  });
}

/** Удаление: строка копируется в лист КОРЗИНА и только потом удаляется. */
function deleteWish_(p) {
  var id = cleanId_(p.id);
  return withLock_(function () {
    var t = wishTable_();
    var w = findWish_(t, id);
    var ss = ss_();
    var trash = ss.getSheetByName(APP.SHEETS.TRASH) || ss.insertSheet(APP.SHEETS.TRASH);
    var headers = t.sh.getRange(1, 1, 1, t.sh.getLastColumn()).getValues()[0];
    if (trash.getLastRow() === 0) trash.getRange(1, 1, 1, headers.length + 1).setValues([['Удалено'].concat(headers)]);
    var rowVals = t.sh.getRange(w._row, 1, 1, headers.length).getValues()[0];
    trash.appendRow([new Date()].concat(rowVals));
    t.sh.deleteRow(w._row);
    log_(w, 'Удалено (в корзину)', 'Владелец', '', '');
    return { ok: true, id: id };
  });
}

/** Загрузка фото с телефона: файл кладётся в папку на Google Диске владельца, ссылка возвращается в приложение. */
function uploadPhoto_(p) {
  var mime = String(p.mime || '');
  if (!/^image\/(jpeg|png|webp)$/.test(mime)) throw userErr_('Можно загрузить фото JPG, PNG или WEBP.');
  var bytes = Utilities.base64Decode(String(p.data || ''));
  if (!bytes.length || bytes.length > APP.MAX_PHOTO_BYTES) throw userErr_('Фото слишком большое (максимум 4 МБ).');
  var folders = DriveApp.getFoldersByName(APP.PHOTO_FOLDER);
  var folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(APP.PHOTO_FOLDER);
  var name = 'wish-' + Utilities.formatDate(new Date(), tz_(), 'yyyyMMdd-HHmmss') + '.' + mime.split('/')[1];
  var file = folder.createFile(Utilities.newBlob(bytes, mime, name));
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return { ok: true, url: 'https://lh3.googleusercontent.com/d/' + file.getId() };
}

function saveSettings_(p) {
  var s = p.settings || {};
  var sh = sheet_(APP.SHEETS.REF);
  var v = sh.getDataRange().getValues();
  var head = v[0].map(function (h) { return String(h).trim(); });
  var cK = head.indexOf('Настройка'), cV = head.indexOf('Значение');
  if (cK < 0) throw userErr_('Запустите «Wishlist → Настроить / обновить таблицу».');
  var settings = readSettings_();
  var vals = {
    'Название страницы': cleanText_(s.title, 80) || 'Мой Wishlist',
    'Подзаголовок': cleanText_(s.subtitle, 300),
    'Показывать исполненные': s.showFulfilled === false ? 'Нет' : 'Да',
    'Валюта по умолчанию': cleanCurrency_(s.currency || settings.currency, settings)
  };
  if (s.pageUrl !== undefined) {
    var u = str_(s.pageUrl);
    if (u && !safeUrl_(u)) throw userErr_('Адрес страницы должен начинаться с https://');
    vals['Адрес страницы (GitHub Pages)'] = u;
  }
  return withLock_(function () {
    Object.keys(vals).forEach(function (k) {
      var found = false;
      for (var i = 1; i < v.length; i++) if (str_(v[i][cK]) === k) { sh.getRange(i + 1, cV + 1).setValue(vals[k]); found = true; }
      if (!found) { var r = v.length + 1; sh.getRange(r, cK + 1, 1, 2).setValues([[k, vals[k]]]); v.push([]); }
    });
    return { ok: true };
  });
}

// ===================== ЛОГИКА ПОВТОРОВ =====================

function repeatMode_(w) {
  var t = str_(w.repeatType);
  if (t === 'Неограниченно') return 'unlimited';
  if (t === 'Периодически' || t === 'Впечатление') return str_(w.period) ? 'periodic' : 'unlimited';
  return 'none';
}

function periodLabel_(w) {
  if (w.period === 'Свой интервал') return 'раз в ' + (num_(w.periodDays) || 1) + ' дн.';
  return str_(w.period).toLowerCase();
}

function nextDate_(from, period, customDays) {
  var d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  var addMonths = function (n) {
    var day = d.getDate();
    d.setDate(1); d.setMonth(d.getMonth() + n);
    var last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(day, last));
  };
  switch (period) {
    case 'Ежедневно': d.setDate(d.getDate() + 1); break;
    case 'Еженедельно': d.setDate(d.getDate() + 7); break;
    case 'Ежемесячно': addMonths(1); break;
    case 'Раз в 3 месяца': addMonths(3); break;
    case 'Раз в полгода': addMonths(6); break;
    case 'Ежегодно': addMonths(12); break;
    case 'Свой интервал': d.setDate(d.getDate() + Math.max(1, Math.round(num_(customDays) || 1))); break;
    default: return '';
  }
  return d;
}

// ===================== ДОСТУП К ТАБЛИЦЕ =====================

function ss_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (ss) return ss;
  var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (id) ss = SpreadsheetApp.openById(id);
  if (!ss) throw userErr_('Таблица не найдена. Владельцу нужно запустить «Wishlist → Настроить таблицу».');
  return ss;
}

function sheet_(name) {
  var sh = ss_().getSheetByName(name);
  if (!sh) throw userErr_('Таблица ещё не настроена. Владельцу нужно запустить «Wishlist → Настроить / обновить таблицу».');
  return sh;
}

function wishTable_() {
  var sh = sheet_(APP.SHEETS.WISH);
  var values = sh.getDataRange().getValues();
  var headers = values[0].map(function (h) { return String(h).trim(); });
  var idx = {};
  WISH_COLS.forEach(function (c) { idx[c[0]] = headers.indexOf(c[1]); });
  ['id', 'title', 'status', '_hash'].forEach(function (k) {
    if (idx[k] < 0) throw userErr_('В листе WISHLIST нет столбца «' + colHeader_(k) + '». Запустите «Wishlist → Настроить / обновить таблицу».');
  });
  var items = [];
  for (var r = 1; r < values.length; r++) {
    var o = { _row: r + 1 };
    WISH_COLS.forEach(function (c) { o[c[0]] = idx[c[0]] >= 0 ? values[r][idx[c[0]]] : ''; });
    ['id', 'title', 'status', 'repeatType', 'period', '_hash', '_prev', 'claimedBy'].forEach(function (k) { o[k] = str_(o[k]); });
    items.push(o);
  }
  return { sh: sh, idx: idx, items: items };
}

function colHeader_(key) {
  for (var i = 0; i < WISH_COLS.length; i++) if (WISH_COLS[i][0] === key) return WISH_COLS[i][1];
  return key;
}

function findWish_(t, id) {
  for (var i = 0; i < t.items.length; i++) if (t.items[i].id === id) return t.items[i];
  throw userErr_('Желание не найдено. Обновите страницу — возможно, список изменился.');
}

function findPublicWish_(t, id) {
  var w = findWish_(t, id);
  if (!w.title || isNo_(w.visible) || w.status === 'Больше не актуально') throw userErr_('Это желание сейчас недоступно. Обновите страницу.');
  return w;
}

function setWish_(t, w, fields) {
  var idCol = t.idx.id + 1;
  var row = w._row;
  if (str_(t.sh.getRange(row, idCol).getValue()) !== w.id) {
    var ids = t.sh.getRange(1, idCol, t.sh.getLastRow(), 1).getValues();
    row = -1;
    for (var i = 1; i < ids.length; i++) if (str_(ids[i][0]) === w.id) { row = i + 1; break; }
    if (row < 0) throw userErr_('Желание не найдено. Обновите страницу.');
  }
  Object.keys(fields).forEach(function (k) {
    if (t.idx[k] >= 0) t.sh.getRange(row, t.idx[k] + 1).setValue(fields[k]);
    w[k] = fields[k];
  });
}

function appendRow_(sheetName, obj) {
  var sh = sheet_(sheetName);
  var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(function (h) { return String(h).trim(); });
  sh.appendRow(headers.map(function (h) { return Object.prototype.hasOwnProperty.call(obj, h) ? obj[h] : ''; }));
}

function log_(w, action, name, comment, statusAfter) {
  appendRow_(APP.SHEETS.LOG, {
    'ID записи': nextLogId_(APP.SHEETS.LOG, 'H'), 'Дата и время': new Date(), 'ID желания': w.id,
    'Название': w.title, 'Действие': action, 'Имя': name, 'Комментарий': comment || '', 'Статус после': statusAfter
  });
}

/** Последние записи журнала (новые сверху), даты — строкой. */
function readLog_(sheetName, limit) {
  var sh = ss_().getSheetByName(sheetName);
  if (!sh || sh.getLastRow() < 2) return [];
  var v = sh.getDataRange().getValues();
  var h = v[0].map(function (x) { return String(x).trim(); });
  var out = [];
  for (var i = v.length - 1; i >= 1 && out.length < limit; i--) {
    if (!str_(v[i][0])) continue;
    var o = {};
    h.forEach(function (k, j) { var x = v[i][j]; o[k] = x instanceof Date ? Utilities.formatDate(x, tz_(), 'yyyy-MM-dd HH:mm') : x; });
    out.push(o);
  }
  return out;
}

function nextLogId_(sheetName, prefix) {
  var sh = sheet_(sheetName);
  var last = sh.getLastRow();
  var max = 0;
  if (last > 1) sh.getRange(2, 1, last - 1, 1).getValues().forEach(function (r) { var m = String(r[0]).match(/(\d+)$/); if (m) max = Math.max(max, Number(m[1])); });
  return prefix + '-' + ('00000' + (max + 1)).slice(-5);
}

function countRows_(sheetName, header, value) {
  var v = sheet_(sheetName).getDataRange().getValues();
  var c = v[0].map(function (h) { return String(h).trim(); }).indexOf(header);
  var n = 0;
  for (var i = 1; i < v.length; i++) if (c >= 0 && str_(v[i][c]) === value) n++;
  return n;
}

function refList_(name, def) {
  var sh = ss_().getSheetByName(APP.SHEETS.REF);
  if (!sh) return def.slice();
  var v = sh.getDataRange().getValues();
  var c = v[0].map(function (h) { return String(h).trim(); }).indexOf(name);
  if (c < 0) return def.slice();
  var out = [];
  for (var i = 1; i < v.length; i++) if (str_(v[i][c])) out.push(str_(v[i][c]));
  return out.length ? out : def.slice();
}

function addToRefList_(name, value) {
  var sh = ss_().getSheetByName(APP.SHEETS.REF);
  if (!sh) return;
  var v = sh.getDataRange().getValues();
  var c = v[0].map(function (h) { return String(h).trim(); }).indexOf(name);
  if (c < 0) return;
  var r = 1;
  for (var i = 1; i < v.length; i++) { if (norm_(v[i][c]) === norm_(value)) return; if (str_(v[i][c])) r = i + 1; }
  sh.getRange(r + 1, c + 1).setValue(value);
}

function readSettings_() {
  var s = { title: 'Мой Wishlist', subtitle: '', showFulfilled: true, currency: 'RUB', currencies: APP.CURRENCIES.slice(), pageUrl: '' };
  var sh = ss_().getSheetByName(APP.SHEETS.REF);
  if (!sh) return s;
  var v = sh.getDataRange().getValues();
  var head = v[0].map(function (h) { return String(h).trim(); });
  var cCur = head.indexOf('Валюты'), cKey = head.indexOf('Настройка'), cVal = head.indexOf('Значение');
  if (cCur >= 0) {
    var list = [];
    for (var i = 1; i < v.length; i++) { var c = str_(v[i][cCur]).toUpperCase(); if (/^[A-Z]{3}$/.test(c)) list.push(c); }
    if (list.length) s.currencies = list;
  }
  if (cKey >= 0 && cVal >= 0) {
    for (var j = 1; j < v.length; j++) {
      var k = str_(v[j][cKey]), val = v[j][cVal];
      if (k === 'Название страницы' && str_(val)) s.title = str_(val);
      if (k === 'Подзаголовок') s.subtitle = str_(val);
      if (k === 'Показывать исполненные') s.showFulfilled = !isNo_(val);
      if (k === 'Валюта по умолчанию' && str_(val)) s.currency = str_(val).toUpperCase();
      if (k === 'Адрес страницы (GitHub Pages)') s.pageUrl = safeUrl_(val);
    }
  }
  if (s.currencies.indexOf(s.currency) < 0) s.currencies.unshift(s.currency);
  return s;
}

// ===================== ЗАЩИТА И ПРОВЕРКИ =====================

function api_(fn) {
  try {
    return fn();
  } catch (e) {
    var msg = String(e && e.message || e);
    if (msg.indexOf('USER:') === 0) return { ok: false, error: msg.slice(5) };
    console.error(e);
    return { ok: false, error: 'Что-то пошло не так. Попробуйте ещё раз через минуту.' };
  }
}

function userErr_(msg) { return new Error('USER:' + msg); }

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw userErr_('Сейчас много одновременных действий. Попробуйте ещё раз через несколько секунд.');
  try {
    var res = fn();
    SpreadsheetApp.flush();
    return res;
  } finally {
    lock.releaseLock();
  }
}

function guard_(p) {
  if (p.website) throw userErr_('Запрос отклонён.');
  var cache = CacheService.getScriptCache();
  var key = 'rate_' + Math.floor(Date.now() / 60000);
  var n = Number(cache.get(key) || 0) + 1;
  cache.put(key, String(n), 120);
  if (n > APP.RATE_LIMIT_PER_MIN) throw userErr_('Слишком много действий за минуту. Подождите немного.');
}

function cleanName_(s) {
  var v = String(s == null ? '' : s).replace(/[<>"'`=+@]/g, '').replace(/\s+/g, ' ').trim();
  if (v.length < 2 || v.length > 40) throw userErr_('Укажите имя — от 2 до 40 символов.');
  return v;
}

function cleanText_(s, max) {
  var v = String(s == null ? '' : s).replace(/[<>]/g, '').replace(/[\u0000-\u0008\u000B-\u001F]/g, '').trim();
  if (v.length > max) throw userErr_('Текст слишком длинный (максимум ' + max + ' символов).');
  if (/^[=+\-@]/.test(v)) v = "'" + v; // защита от формул
  return v;
}

function cleanId_(s) {
  var v = String(s == null ? '' : s).trim();
  if (!/^[A-Za-zА-Яа-я0-9\-_]{1,20}$/.test(v)) throw userErr_('Выберите желание из списка.');
  return v;
}

function cleanCurrency_(c, settings) {
  var v = String(c || '').trim().toUpperCase();
  if (settings.currencies.indexOf(v) < 0) throw userErr_('Выберите валюту из списка.');
  return v;
}

function parseAmount_(a) {
  var s = String(a == null ? '' : a).replace(/\s| /g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) throw userErr_('Сумма должна быть числом, например 1500 или 1500,50.');
  var n = Number(s);
  if (!(n > 0)) throw userErr_('Сумма должна быть больше нуля.');
  if (n > APP.MAX_AMOUNT) throw userErr_('Слишком большое число. Проверьте, нет ли лишних цифр.');
  return Math.round(n * 100) / 100;
}

function parseAnyDay_(s) {
  var m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) throw userErr_('Дату укажите в формате ГГГГ-ММ-ДД.');
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function genToken_() {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid() + Date.now() + Math.random());
  return bytes.slice(0, 16).map(function (b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('');
}

function hash_(token, id) {
  var salt = PropertiesService.getScriptProperties().getProperty('SALT') || 'wishlist';
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + '|' + id + '|' + token, Utilities.Charset.UTF_8);
  return bytes.map(function (b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('').slice(0, 32);
}

function newAdminKey_() {
  var a = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789', k = '';
  var b = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid() + Utilities.getUuid() + Date.now());
  for (var i = 0; i < 28; i++) k += a.charAt((b[i] + 256) % a.length);
  PropertiesService.getScriptProperties().setProperty('ADMIN_KEY', k);
  return k;
}

function assertOwner_() {
  var active = Session.getActiveUser().getEmail();
  var eff = Session.getEffectiveUser().getEmail();
  if (!active || active !== eff) throw new Error('Эта функция доступна только владельцу таблицы.');
}

// ===================== УТИЛИТЫ =====================

function str_(v) { return v == null ? '' : String(v).trim(); }
function num_(v) { var n = typeof v === 'number' ? v : Number(String(v || '').replace(/\s/g, '').replace(',', '.')); return isFinite(n) && n > 0 ? n : 0; }
function norm_(s) { return str_(s).toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' '); }
function isNo_(v) { var s = norm_(v); return s === 'нет' || s === 'no' || s === 'false' || v === false; }
function tz_() { return Session.getScriptTimeZone() || 'Europe/Moscow'; }
function dayStr_(d) { return Utilities.formatDate(d, tz_(), 'yyyy-MM-dd'); }
function ruDate_(d) { return Utilities.formatDate(d, tz_(), 'dd.MM.yyyy'); }
function fmtMoney_(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }

function monthStr_(m, added) {
  if (m instanceof Date) return Utilities.formatDate(m, tz_(), 'yyyy-MM');
  var s = str_(m);
  var x = s.match(/^(\d{4})[-.](\d{1,2})/);
  if (x) return x[1] + '-' + ('0' + x[2]).slice(-2);
  x = s.match(/^(\d{1,2})[-.](\d{4})$/);
  if (x) return x[2] + '-' + ('0' + x[1]).slice(-2);
  return added instanceof Date ? Utilities.formatDate(added, tz_(), 'yyyy-MM') : '';
}

function dateOrText_(v) { return v instanceof Date ? ruDate_(v) : str_(v); }

function safeUrl_(u) {
  var s = str_(u);
  return /^https?:\/\/[^\s<>"']+$/i.test(s) && s.length < 2000 ? s : '';
}

function photoUrl_(u) {
  var s = safeUrl_(u);
  var m = s.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:export=\w+&)?id=)([\w-]{20,})/);
  return m ? 'https://lh3.googleusercontent.com/d/' + m[1] : s;
}

function colLetter_(n) {
  var s = '';
  while (n > 0) { var m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

// ===================== МЕНЮ ВЛАДЕЛЬЦА В ТАБЛИЦЕ =====================

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Wishlist')
    .addItem('Настроить / обновить таблицу', 'setupWishlist')
    .addItem('Ссылки: для гостей и для меня', 'showLinks')
    .addItem('Сменить секретную ссылку владельца', 'rotateOwnerLink')
    .addSeparator()
    .addItem('Добавить примеры желаний', 'addDemoData')
    .addItem('Проверить данные', 'checkData')
    .addSeparator()
    .addItem('Создать резервную копию сейчас', 'backupNow')
    .addItem('Включить ежедневное копирование', 'enableDailyBackup')
    .addItem('Выключить ежедневное копирование', 'disableDailyBackup')
    .addToUi();
}

/** Автозаполнение при ручной правке WISHLIST в таблице. */
function onEdit(e) {
  try {
    if (!e || !e.range) return;
    var sh = e.range.getSheet();
    if (sh.getName() !== APP.SHEETS.WISH || e.range.getRow() < 2) return;
    var headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(function (h) { return String(h).trim(); });
    var c = {};
    WISH_COLS.forEach(function (x) { c[x[0]] = headers.indexOf(x[1]); });
    var r0 = e.range.getRow(), nr = e.range.getNumRows();
    var editedCols = [];
    for (var k = 0; k < e.range.getNumColumns(); k++) editedCols.push(e.range.getColumn() - 1 + k);
    var maxId = 0;
    sh.getRange(2, c.id + 1, Math.max(sh.getLastRow() - 1, 1), 1).getValues().forEach(function (x) { var m = String(x[0]).match(/(\d+)$/); if (m) maxId = Math.max(maxId, Number(m[1])); });
    for (var r = r0; r < r0 + nr; r++) {
      var row = sh.getRange(r, 1, 1, headers.length).getValues()[0];
      if (!str_(row[c.title])) continue;
      var set = function (key, val) { if (c[key] >= 0) { sh.getRange(r, c[key] + 1).setValue(val); row[c[key]] = val; } };
      if (!str_(row[c.id])) { maxId++; set('id', 'W-' + ('0000' + maxId).slice(-4)); }
      if (c.addedAt >= 0 && !row[c.addedAt]) set('addedAt', new Date());
      if (!str_(row[c.status])) set('status', 'В списке');
      if (c.category >= 0 && !str_(row[c.category])) set('category', 'Постоянные');
      if (c.qty >= 0 && !row[c.qty]) set('qty', 1);
      if (c.visible >= 0 && !str_(row[c.visible])) set('visible', 'Да');
      if (c.currency >= 0 && !str_(row[c.currency])) set('currency', readSettings_().currency);
      if (c.month >= 0 && str_(row[c.category]) === 'Ежемесячные' && !str_(row[c.month])) {
        set('month', Utilities.formatDate(row[c.addedAt] instanceof Date ? row[c.addedAt] : new Date(), tz_(), 'yyyy-MM'));
      }
      if (c.repeatType >= 0 && !str_(row[c.repeatType])) set('repeatType', 'Нет');
      if (editedCols.indexOf(c.status) >= 0) {
        var st = str_(row[c.status]);
        var w = { id: str_(row[c.id]), title: str_(row[c.title]) };
        if (APP.FREE.indexOf(st) >= 0 && (str_(row[c.claimedBy]) || str_(row[c._hash]))) {
          set('claimedBy', ''); set('claimedAt', ''); set('claimNote', ''); set('_hash', ''); set('_prev', '');
          log_(w, 'Отметка снята владельцем', 'Владелец', '', st);
        } else if (st === 'Получено') {
          log_(w, 'Получено', 'Владелец', '', st);
        }
      }
    }
  } catch (err) {
    console.error(err);
  }
}

function setupWishlist() {
  assertOwner_();
  setup_();
  try { SpreadsheetApp.getUi().alert('Готово', 'Таблица настроена. Дальше: Развернуть → Новое развертывание (см. инструкцию), затем меню Wishlist → Ссылки.', SpreadsheetApp.getUi().ButtonSet.OK); } catch (e) { }
}

function addDemoData() { assertOwner_(); addDemo_(true); }

function showLinks() {
  assertOwner_();
  var api = ScriptApp.getService().getUrl() || '';
  var s = readSettings_();
  var key = PropertiesService.getScriptProperties().getProperty('ADMIN_KEY') || newAdminKey_();
  var page = s.pageUrl;
  var esc = function (x) { return String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;'); };
  var row = function (title, val, note) {
    return '<p style="margin:14px 0 4px;font-weight:600">' + title + '</p>' +
      '<input readonly onclick="this.select()" style="width:100%;padding:8px;font:13px monospace" value="' + esc(val) + '">' +
      (note ? '<p style="margin:4px 0;color:#857A70;font-size:12px">' + note + '</p>' : '');
  };
  var html = '<div style="font-family:Arial,sans-serif;font-size:14px">' +
    row('1. Адрес API — вставьте в файл config.js на GitHub', api || 'Сначала опубликуйте: Развернуть → Новое развертывание', 'Меняется только при НОВОМ развертывании; при обновлении версии остаётся тем же.') +
    (page ? row('2. Ссылка для гостей', page) + row('3. Секретная ссылка владельца — только для вас', page.replace(/[?#].*$/, '') + '?owner=' + key, 'Откройте её на iPhone в Safari и сразу добавьте на экран «Домой» (Поделиться → На экран «Домой») — эта иконка будет открываться в режиме владельца. Никому не пересылайте.')
      : '<p style="margin-top:14px;color:#9C4E2B">Укажите «Адрес страницы (GitHub Pages)» на листе СПРАВОЧНИКИ и откройте это окно снова — здесь появятся ссылка для гостей и ваша секретная ссылка.</p>') +
    '</div>';
  SpreadsheetApp.getUi().showModalDialog(HtmlService.createHtmlOutput(html).setWidth(560).setHeight(420), 'Wishlist — ссылки');
}

function rotateOwnerLink() {
  assertOwner_();
  newAdminKey_();
  try { SpreadsheetApp.getUi().alert('Старая секретная ссылка больше не работает. Новая — в «Wishlist → Ссылки».'); } catch (e) { }
}

function checkData() {
  assertOwner_();
  var t = wishTable_();
  var issues = [], seen = {};
  t.items.forEach(function (w) {
    if (!w.title) return;
    var where = 'Строка ' + w._row + ' (' + w.title + '): ';
    if (!w.id) issues.push(where + 'нет ID');
    else if (seen[w.id]) issues.push(where + 'повторяющийся ID ' + w.id); else seen[w.id] = 1;
    if (str_(w.url) && !safeUrl_(w.url)) issues.push(where + 'неверная ссылка на товар');
    if (str_(w.url2) && !safeUrl_(w.url2)) issues.push(where + 'неверная альтернативная ссылка');
    if (str_(w.photo) && !safeUrl_(w.photo)) issues.push(where + 'неверная ссылка на фото');
    if (str_(w.price) && !(num_(w.price) > 0)) issues.push(where + 'цена должна быть положительным числом');
    if (w.status && APP.STATUSES.indexOf(w.status) < 0 && APP.TAKEN.indexOf(w.status) < 0) issues.push(where + 'неизвестный статус «' + w.status + '»');
    if (w.category && APP.CATEGORIES.indexOf(str_(w.category)) < 0) issues.push(where + 'неизвестная категория');
    if (w.repeatType === 'Периодически' && !w.period) issues.push(where + 'для «Периодически» укажите периодичность');
    if (w.period === 'Свой интервал' && !(num_(w.periodDays) >= 1)) issues.push(where + 'укажите «Свой интервал, дней»');
    if (num_(w.amountMin) && num_(w.amountMax) && num_(w.amountMin) > num_(w.amountMax)) issues.push(where + '«Сумма от» больше «Сумма до»');
  });
  try { SpreadsheetApp.getUi().alert('Проверка данных', issues.length ? issues.slice(0, 40).join('\n') : 'Ошибок не найдено.', SpreadsheetApp.getUi().ButtonSet.OK); } catch (e) { }
  return issues;
}

// ===================== РЕЗЕРВНОЕ КОПИРОВАНИЕ =====================

function backupNow() {
  assertOwner_();
  var name = backup_();
  try { SpreadsheetApp.getUi().alert('Резервная копия создана: «' + name + '» в папке «' + APP.BACKUP_FOLDER + '».'); } catch (e) { }
}

function enableDailyBackup() {
  assertOwner_();
  disableDailyBackup_();
  ScriptApp.newTrigger('scheduledBackup').timeBased().everyDays(1).atHour(4).create();
  try { SpreadsheetApp.getUi().alert('Ежедневное копирование включено (около 4:00). Хранятся последние ' + APP.BACKUPS_TO_KEEP + ' копий.'); } catch (e) { }
}

function disableDailyBackup() {
  assertOwner_();
  disableDailyBackup_();
  try { SpreadsheetApp.getUi().alert('Ежедневное копирование выключено.'); } catch (e) { }
}

function disableDailyBackup_() {
  ScriptApp.getProjectTriggers().forEach(function (tr) { if (tr.getHandlerFunction() === 'scheduledBackup') ScriptApp.deleteTrigger(tr); });
}

function scheduledBackup() {
  var props = PropertiesService.getScriptProperties();
  if (Date.now() - Number(props.getProperty('LAST_BACKUP') || 0) < 20 * 3600 * 1000) return;
  backup_();
}

function backup_() {
  var ss = ss_();
  var folders = DriveApp.getFoldersByName(APP.BACKUP_FOLDER);
  var folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(APP.BACKUP_FOLDER);
  var name = ss.getName() + ' — копия ' + Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd HH-mm');
  DriveApp.getFileById(ss.getId()).makeCopy(name, folder);
  PropertiesService.getScriptProperties().setProperty('LAST_BACKUP', String(Date.now()));
  var files = [], it = folder.getFiles();
  while (it.hasNext()) files.push(it.next());
  files.sort(function (a, b) { return b.getDateCreated() - a.getDateCreated(); });
  files.slice(APP.BACKUPS_TO_KEEP).forEach(function (f) { f.setTrashed(true); });
  return name;
}

// ===================== НАСТРОЙКА ТАБЛИЦЫ =====================

function setup_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var props = PropertiesService.getScriptProperties();
  props.setProperty('SPREADSHEET_ID', ss.getId());
  if (!props.getProperty('SALT')) props.setProperty('SALT', Utilities.getUuid());
  if (!props.getProperty('ADMIN_KEY')) newAdminKey_();
  ss.setSpreadsheetTimeZone(tz_());

  var order = [APP.SHEETS.WISH, APP.SHEETS.PERM, APP.SHEETS.MONTH, APP.SHEETS.RARE, APP.SHEETS.DONE,
    APP.SHEETS.LOG, APP.SHEETS.MONEY, APP.SHEETS.EXEC, APP.SHEETS.REF, APP.SHEETS.STAT, APP.SHEETS.RSTAT, APP.SHEETS.TRASH];
  order.forEach(function (name, i) { if (!ss.getSheetByName(name)) ss.insertSheet(name, i); });
  ss.getSheets().forEach(function (sh) {
    if (order.indexOf(sh.getName()) < 0 && sh.getLastRow() === 0 && ss.getSheets().length > order.length) ss.deleteSheet(sh);
  });

  setupRef_(ss);
  var wishSh = ss.getSheetByName(APP.SHEETS.WISH);
  ensureHeaders_(wishSh, WISH_COLS.map(function (c) { return c[1]; }));
  wishSh.getRange(2, headerMap_(wishSh).month, wishSh.getMaxRows() - 1, 1).setNumberFormat('@');
  ensureHeaders_(ss.getSheetByName(APP.SHEETS.LOG), LOG_COLS);
  ensureHeaders_(ss.getSheetByName(APP.SHEETS.MONEY), MONEY_COLS);
  ensureHeaders_(ss.getSheetByName(APP.SHEETS.EXEC), EXEC_COLS);
  if (wishSh.getLastRow() < 2) addDemo_(false);
  fillMissing_(wishSh);
  formatWish_(ss, wishSh);
  formatLogs_(ss);
  setupViews_(ss);
  setupStats_(ss);
  setupRecurringStats_(ss);
  protect_(ss);
  ss.setActiveSheet(wishSh);
}

function ensureHeaders_(sh, cols) {
  var lastCol = sh.getLastColumn();
  var existing = lastCol ? sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); }) : [];
  if (!existing.some(function (h) { return h; })) existing = [];
  var missing = cols.filter(function (h) { return existing.indexOf(h) < 0; });
  if (!existing.length) sh.getRange(1, 1, 1, cols.length).setValues([cols]);
  else if (missing.length) sh.getRange(1, existing.length + 1, 1, missing.length).setValues([missing]);
  var n = Math.max(sh.getLastColumn(), cols.length);
  sh.getRange(1, 1, 1, n).setFontWeight('bold').setBackground('#EFE7DC').setFontColor('#3A302A').setWrap(true).setVerticalAlignment('middle');
  sh.setFrozenRows(1);
  if (sh.getMaxRows() < 1000) sh.insertRowsAfter(sh.getMaxRows(), 1000 - sh.getMaxRows());
}

function headerMap_(sh) {
  var h = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(function (x) { return String(x).trim(); });
  var m = {};
  WISH_COLS.forEach(function (c) { m[c[0]] = h.indexOf(c[1]) + 1; });
  return m;
}

function setupRef_(ss) {
  var sh = ss.getSheetByName(APP.SHEETS.REF);
  var existing = sh.getLastRow() > 0 ? sh.getDataRange().getValues() : [[]];
  var head = existing[0].map(function (h) { return String(h).trim(); });
  var colValues = function (name) {
    var c = head.indexOf(name); if (c < 0) return [];
    var out = []; for (var i = 1; i < existing.length; i++) if (str_(existing[i][c])) out.push(existing[i][c]); return out;
  };
  var subs = colValues('Подкатегории'); if (!subs.length) subs = APP.SUBCATEGORIES;
  var curs = colValues('Валюты'); if (!curs.length) curs = APP.CURRENCIES;
  var cK = head.indexOf('Настройка'), cV = head.indexOf('Значение');
  var settings = SETTINGS_DEFAULT.map(function (d) {
    if (cK >= 0) for (var i = 1; i < existing.length; i++) if (str_(existing[i][cK]) === d[0]) return [d[0], existing[i][cV]];
    return d;
  });
  var cols = [
    ['Категории', APP.CATEGORIES], ['Подкатегории', subs], ['Статусы', APP.STATUSES], ['Приоритеты', APP.PRIORITIES],
    ['Валюты', curs], ['Типы повторения', APP.REPEAT], ['Периодичность', APP.PERIODS], ['Да/Нет', ['Да', 'Нет']]
  ];
  sh.clear();
  cols.forEach(function (c, i) {
    sh.getRange(1, i + 1).setValue(c[0]);
    sh.getRange(2, i + 1, c[1].length, 1).setValues(c[1].map(function (v) { return [v]; }));
  });
  var sc = cols.length + 2;
  sh.getRange(1, sc, 1, 2).setValues([['Настройка', 'Значение']]);
  sh.getRange(2, sc, settings.length, 2).setValues(settings);
  sh.getRange(1, 1, 1, sc + 1).setFontWeight('bold').setBackground('#EFE7DC');
  sh.setFrozenRows(1);
  sh.getRange(4, sc + 1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['Да', 'Нет'], true).build());
  sh.getRange(5, sc + 1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInRange(sh.getRange('E2:E'), true).build());
  sh.getRange(6, sc + 1).setNote('Адрес вашей страницы на GitHub Pages, например https://laurashlyakova25.github.io/wishlist/');
  var rules = APP.STATUSES.map(function (s) {
    var c = APP.STATUS_COLORS[s];
    return SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(s).setBackground(c[0]).setFontColor(c[1]).setRanges([sh.getRange(2, 3, APP.STATUSES.length, 1)]).build();
  });
  sh.setConditionalFormatRules(rules);
  sh.setColumnWidths(1, sc + 1, 150);
  sh.setColumnWidth(sc + 1, 340);
  sh.getRange(10, sc, 4, 1).setValues([['Подсказки:'], ['• Подкатегории и валюты можно дополнять — допишите строку.'], ['• Категории, статусы, типы повторения не переименовывайте.'], ['• После добавления валюты запустите «Wishlist → Настроить / обновить таблицу».']]).setFontColor('#8A847E');
}

function fillMissing_(sh) {
  var m = headerMap_(sh);
  var last = sh.getLastRow();
  if (last < 2) return;
  var data = sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues();
  var maxId = 0;
  data.forEach(function (r) { var x = String(r[m.id - 1]).match(/(\d+)$/); if (x) maxId = Math.max(maxId, Number(x[1])); });
  data.forEach(function (r, i) {
    if (!str_(r[m.title - 1])) return;
    var row = i + 2;
    if (!str_(r[m.id - 1])) { maxId++; sh.getRange(row, m.id).setValue('W-' + ('0000' + maxId).slice(-4)); }
    if (!str_(r[m.status - 1])) sh.getRange(row, m.status).setValue('В списке');
    if (!r[m.addedAt - 1]) sh.getRange(row, m.addedAt).setValue(new Date());
    if (!str_(r[m.visible - 1])) sh.getRange(row, m.visible).setValue('Да');
    if (!str_(r[m.repeatType - 1])) sh.getRange(row, m.repeatType).setValue('Нет');
  });
}

function formatWish_(ss, sh) {
  var m = headerMap_(sh);
  var ref = ss.getSheetByName(APP.SHEETS.REF);
  var rows = sh.getMaxRows() - 1;
  var col = function (k) { return sh.getRange(2, m[k], rows, 1); };
  var list = function (r) { return SpreadsheetApp.newDataValidation().requireValueInRange(ref.getRange(r), true).setAllowInvalid(false).build(); };
  var soft = function (r) { return SpreadsheetApp.newDataValidation().requireValueInRange(ref.getRange(r), true).setAllowInvalid(true).build(); };
  var num = SpreadsheetApp.newDataValidation().requireNumberGreaterThanOrEqualTo(0).setAllowInvalid(false).setHelpText('Введите положительное число').build();
  var url = SpreadsheetApp.newDataValidation().requireTextIsUrl().setAllowInvalid(false).setHelpText('Ссылка, начинающаяся с https://').build();
  var date = SpreadsheetApp.newDataValidation().requireDate().setAllowInvalid(false).setHelpText('Введите дату').build();
  col('category').setDataValidation(list('A2:A4'));
  col('subcategory').setDataValidation(soft('B2:B'));
  col('status').setDataValidation(soft('C2:C6'));
  col('priority').setDataValidation(list('D2:D5'));
  col('currency').setDataValidation(list('E2:E'));
  col('repeatType').setDataValidation(list('F2:F5'));
  col('period').setDataValidation(list('G2:G8'));
  col('visible').setDataValidation(list('H2:H3'));
  ['url', 'url2', 'photo'].forEach(function (k) { col(k).setDataValidation(url); });
  ['price', 'qty', 'budget', 'periodDays', 'unitCost', 'amountMin', 'amountMax', 'timesDone'].forEach(function (k) { col(k).setDataValidation(num); });
  ['claimedAt', 'addedAt', 'lastDone', 'nextAvailable'].forEach(function (k) { col(k).setDataValidation(date).setNumberFormat('dd.mm.yyyy'); });
  col('month').setNumberFormat('@');
  ['price', 'budget', 'unitCost', 'amountMin', 'amountMax'].forEach(function (k) { col(k).setNumberFormat('#,##0.##'); });
  var rules = APP.STATUSES.map(function (s) {
    var c = APP.STATUS_COLORS[s];
    return SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(s).setBackground(c[0]).setFontColor(c[1]).setRanges([col('status')]).build();
  });
  rules.push(SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=$' + colLetter_(m.status) + '2="Больше не актуально"')
    .setFontColor('#A8A29C').setRanges([sh.getRange(2, 1, rows, sh.getLastColumn())]).build());
  sh.setConditionalFormatRules(rules);
  sh.setFrozenColumns(2);
  sh.setRowHeight(1, 42);
  sh.setColumnWidths(1, sh.getLastColumn(), 130);
  sh.setColumnWidth(m.id, 80);
  sh.setColumnWidth(m.title, 220);
  sh.setColumnWidth(m.description, 240);
  sh.hideColumns(m._hash);
  sh.hideColumns(m._prev);
  sh.getRange(1, m.repeatType, 1, 9).setBackground('#E4E9DE');
  sh.getRange(1, m.month, 1, 3).setBackground('#EDE5F0');
  sh.getRange(1, m.title).setNote('Желания удобнее добавлять из приложения (режим владельца). Здесь тоже можно: впишите название — ID, дата и статус заполнятся сами.');
}

function formatLogs_(ss) {
  [APP.SHEETS.LOG, APP.SHEETS.MONEY, APP.SHEETS.EXEC].forEach(function (n) {
    var sh = ss.getSheetByName(n);
    var h = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
    var d = h.indexOf('Дата и время') + 1;
    if (d) sh.getRange(2, d, sh.getMaxRows() - 1, 1).setNumberFormat('dd.mm.yyyy hh:mm');
    var s = h.indexOf('Сумма') + 1;
    if (s) sh.getRange(2, s, sh.getMaxRows() - 1, 1).setNumberFormat('#,##0.##');
    sh.setColumnWidths(1, sh.getLastColumn(), 140);
  });
}

function setupViews_(ss) {
  var wsh = ss.getSheetByName(APP.SHEETS.WISH);
  var m = headerMap_(wsh);
  var L = function (k) { return colLetter_(m[k]); };
  var src = 'WISHLIST!A1:' + colLetter_(wsh.getLastColumn());
  var base = ['id', 'title', 'subcategory', 'brand', 'price', 'currency', 'priority', 'status', 'claimedBy'];
  var sel = function (keys) { return keys.map(L).join(', '); };
  var notHidden = L('status') + " <> 'Больше не актуально'";
  var q = function (keys, where, order) {
    return '=IFERROR(QUERY(' + src + ', "select ' + sel(keys) + ' where ' + L('title') + " <> '' and " + where + (order ? ' order by ' + order : '') + '", 1), "Пока пусто")';
  };
  var views = [
    [APP.SHEETS.PERM, q(base.concat(['repeatType', 'period', 'timesDone', 'nextAvailable', 'url']), L('category') + " = 'Постоянные' and " + notHidden + ' and ' + L('status') + " <> 'Получено'", L('addedAt') + ' desc'), 'Постоянные хотелки (автоматически из WISHLIST)'],
    [APP.SHEETS.RARE, q(base.concat(['targetDate', 'budget', 'url']), L('category') + " = 'Редкие' and " + notHidden + ' and ' + L('status') + " <> 'Получено'", L('addedAt') + ' desc'), 'Редкие хотелки — с ориентировочной датой и бюджетом'],
    [APP.SHEETS.DONE, q(['id', 'title', 'category', 'subcategory', 'brand', 'price', 'currency', 'claimedBy', 'claimedAt', 'url'], L('status') + " = 'Получено'", L('claimedAt') + ' desc'), 'Архив полученных подарков. Исполнения повторяющихся желаний — на листе ИСПОЛНЕНИЯ']
  ];
  views.forEach(function (v) {
    var sh = ss.getSheetByName(v[0]);
    sh.clear();
    sh.getRange('A1').setValue(v[2]).setFontStyle('italic').setFontColor('#8A847E');
    sh.getRange('A2').setFormula(v[1]);
    sh.getRange('2:2').setFontWeight('bold').setBackground('#EFE7DC');
    sh.setFrozenRows(2);
    sh.setColumnWidths(1, 16, 130);
    sh.setColumnWidth(2, 220);
  });
  var sh = ss.getSheetByName(APP.SHEETS.MONTH);
  sh.clear();
  sh.getRange('A1').setValue('Ежемесячные — сводка по месяцам').setFontStyle('italic').setFontColor('#8A847E');
  sh.getRange('A2').setFormula('=IFERROR(QUERY(' + src + ', "select ' + L('month') + ', count(' + L('id') + ') where ' + L('category') + " = 'Ежемесячные' and " + L('title') + " <> '' and " + notHidden + ' group by ' + L('month') + ' order by ' + L('month') + " desc label " + L('month') + " 'Месяц', count(" + L('id') + ") 'Желаний'\", 1), \"Пока пусто\")");
  sh.getRange('D1').setValue('Все ежемесячные желания по месяцам (новые сверху)').setFontStyle('italic').setFontColor('#8A847E');
  sh.getRange('D2').setFormula(q(['month'].concat(base, ['url']), L('category') + " = 'Ежемесячные' and " + notHidden, L('month') + ' desc, ' + L('addedAt') + ' desc'));
  sh.getRange('2:2').setFontWeight('bold').setBackground('#EFE7DC');
  sh.setFrozenRows(2);
  sh.setColumnWidths(1, 16, 120);
  [APP.SHEETS.PERM, APP.SHEETS.MONTH, APP.SHEETS.RARE, APP.SHEETS.DONE].forEach(function (n) {
    var s = ss.getSheetByName(n);
    s.setConditionalFormatRules(APP.STATUSES.map(function (st) {
      var c = APP.STATUS_COLORS[st];
      return SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(st).setBackground(c[0]).setFontColor(c[1]).setRanges([s.getRange('A3:Z1000')]).build();
    }));
  });
}

function setupStats_(ss) {
  var m = headerMap_(ss.getSheetByName(APP.SHEETS.WISH));
  var R = function (k) { var l = colLetter_(m[k]); return 'WISHLIST!' + l + '2:' + l; };
  var st = R('status'), cat = R('category'), rep = R('repeatType');
  var sh = ss.getSheetByName(APP.SHEETS.STAT);
  sh.clear();
  var rows = [
    ['Статистика Wishlist', ''], ['', ''],
    ['Всего желаний', '=COUNTA(' + R('title') + ')'],
    ['Постоянные', '=COUNTIF(' + cat + ',"Постоянные")'],
    ['Ежемесячные', '=COUNTIF(' + cat + ',"Ежемесячные")'],
    ['Редкие', '=COUNTIF(' + cat + ',"Редкие")'],
    ['Из них повторяющиеся', '=COUNTIF(' + rep + ',"Неограниченно")+COUNTIF(' + rep + ',"Периодически")+COUNTIF(' + rep + ',"Впечатление")'],
    ['', ''],
    ['Свободные (В списке + Присмотрено)', '=COUNTIF(' + st + ',"В списке")+COUNTIF(' + st + ',"Присмотрено")'],
    ['Подарят (кто-то уже выбрал)', '=COUNTIF(' + st + ',"Подарят")+COUNTIF(' + st + ',"Забронировано")+COUNTIF(' + st + ',"Куплено")'],
    ['Получено', '=COUNTIF(' + st + ',"Получено")'],
    ['Больше не актуально', '=COUNTIF(' + st + ',"Больше не актуально")'],
    ['', ''],
    ['Исполнений повторяющихся желаний', "=COUNTA('ИСПОЛНЕНИЯ'!A2:A)"],
    ['Денежных вкладов (записей)', "=COUNTA('ДЕНЕЖНЫЕ ВКЛАДЫ'!A2:A)"]
  ];
  sh.getRange(1, 1, rows.length, 2).setValues(rows);
  sh.getRange('A1').setFontSize(14).setFontWeight('bold');
  var start = rows.length + 2;
  sh.getRange(start, 1, 1, 5).setValues([['Валюта', 'Стоимость актуальных желаний', 'Стоимость ещё не исполненных', 'Все денежные вклады', 'из них подарки-исполнения']]).setFontWeight('bold').setBackground('#EFE7DC').setWrap(true);
  var curs = readSettings_().currencies;
  var price = R('price'), cur = R('currency'), qty = R('qty');
  var qtyExpr = 'IF(' + qty + '="",1,' + qty + ')';
  var notRec = '((' + rep + '="")+(' + rep + '="Нет")>0)';
  var notTaken = '(' + st + '<>"Подарят")*(' + st + '<>"Забронировано")*(' + st + '<>"Куплено")';
  curs.forEach(function (c, i) {
    var r = start + 1 + i, a = '$A' + r;
    sh.getRange(r, 1, 1, 5).setValues([[c,
      '=ARRAYFORMULA(SUMPRODUCT((' + cur + '=' + a + ')*(' + st + '<>"Больше не актуально")*' + notRec + '*IFERROR(' + price + '*1,0)*' + qtyExpr + '))',
      '=ARRAYFORMULA(SUMPRODUCT((' + cur + '=' + a + ')*(' + st + '<>"Больше не актуально")*(' + st + '<>"Получено")*' + notTaken + '*' + notRec + '*IFERROR(' + price + '*1,0)*' + qtyExpr + '))',
      "=SUMIFS('ДЕНЕЖНЫЕ ВКЛАДЫ'!F2:F,'ДЕНЕЖНЫЕ ВКЛАДЫ'!G2:G," + a + ')',
      "=SUMIFS('ДЕНЕЖНЫЕ ВКЛАДЫ'!F2:F,'ДЕНЕЖНЫЕ ВКЛАДЫ'!G2:G," + a + ",'ДЕНЕЖНЫЕ ВКЛАДЫ'!I2:I,\"Подарок-исполнение\")"]]);
  });
  sh.getRange(start + 1, 2, curs.length, 4).setNumberFormat('#,##0.##');
  sh.getRange(start + curs.length + 2, 1).setValue('Стоимость = цена × количество. Повторяющиеся желания не входят — их суммы на листе «СТАТ. ПОВТОРОВ».').setFontColor('#8A847E');
  sh.setColumnWidth(1, 300);
  sh.setColumnWidths(2, 4, 170);
}

function setupRecurringStats_(ss) {
  var sh = ss.getSheetByName(APP.SHEETS.RSTAT);
  sh.clear();
  var src = "'ИСПОЛНЕНИЯ'!A1:K";
  [
    ['A', 'По желаниям', "select D, H, count(A), sum(G), max(B) where A <> '' group by D, H order by count(A) desc label D 'Желание', H 'Валюта', count(A) 'Исполнений', sum(G) 'Сумма подарков', max(B) 'Последнее'"],
    ['G', 'По участникам', "select F, H, count(A), sum(G) where A <> '' group by F, H order by count(A) desc label F 'Участник', H 'Валюта', count(A) 'Исполнений', sum(G) 'Сумма'"],
    ['L', 'Кто и что исполнял', "select F, D, H, count(A), sum(G), max(B) where A <> '' group by F, D, H order by F label F 'Участник', D 'Желание', H 'Валюта', count(A) 'Раз', sum(G) 'Сумма', max(B) 'Последний раз'"]
  ].forEach(function (b) {
    sh.getRange(b[0] + '1').setValue(b[1]).setFontWeight('bold').setFontSize(12);
    sh.getRange(b[0] + '2').setFormula('=IFERROR(QUERY(' + src + ', "' + b[2] + '", 1), "Пока нет исполнений")');
  });
  sh.getRange('2:2').setFontWeight('bold').setBackground('#E4E9DE');
  sh.setFrozenRows(2);
  sh.setColumnWidths(1, 18, 130);
  sh.getRange('E3:E1000').setNumberFormat('dd.mm.yyyy');
  sh.getRange('Q3:Q1000').setNumberFormat('dd.mm.yyyy');
}

function protect_(ss) {
  [APP.SHEETS.PERM, APP.SHEETS.MONTH, APP.SHEETS.RARE, APP.SHEETS.DONE, APP.SHEETS.STAT, APP.SHEETS.RSTAT,
   APP.SHEETS.LOG, APP.SHEETS.MONEY, APP.SHEETS.EXEC, APP.SHEETS.TRASH].forEach(function (n) {
    var sh = ss.getSheetByName(n);
    sh.getProtections(SpreadsheetApp.ProtectionType.SHEET).forEach(function (p) { p.remove(); });
    sh.protect().setDescription('Автоматический лист / журнал — редактировать не нужно').setWarningOnly(true);
  });
  var w = ss.getSheetByName(APP.SHEETS.WISH);
  w.getProtections(SpreadsheetApp.ProtectionType.RANGE).forEach(function (p) { p.remove(); });
  w.getRange('1:1').protect().setDescription('Заголовки столбцов — не переименовывайте').setWarningOnly(true);
}

// ===================== ПРИМЕРЫ =====================

function addDemo_(force) {
  var sh = ss_().getSheetByName(APP.SHEETS.WISH);
  var m = headerMap_(sh);
  var today = new Date();
  var ym = function (shift) { return Utilities.formatDate(new Date(today.getFullYear(), today.getMonth() + shift, 1), tz_(), 'yyyy-MM'); };
  var demo = [
    { title: 'Кофе в кофейне', description: 'Капучино и что-нибудь вкусное к нему. Куда идти — решу сама.', category: 'Постоянные', subcategory: 'Кафе и рестораны', priority: 'Хочу', repeatType: 'Неограниченно', unitCost: 450, amountMin: 300, amountMax: 1000, wishes: 'Можно дарить сколько угодно раз :)' },
    { title: 'Букет цветов', description: 'Сезонные цветы — порадовать себя.', category: 'Постоянные', subcategory: 'Цветы', priority: 'Очень хочу', repeatType: 'Периодически', period: 'Ежемесячно', unitCost: 3500, amountMin: 2000, amountMax: 6000 },
    { title: 'Ужин в ресторане', description: 'Хороший ужин вдвоём. Ресторан выберу сама.', category: 'Постоянные', subcategory: 'Впечатления', priority: 'Мечтаю', repeatType: 'Впечатление', period: 'Раз в 3 месяца', unitCost: 9000, amountMin: 5000, amountMax: 15000 },
    { title: 'Беспроводные наушники', description: 'Для прогулок и дороги', category: 'Постоянные', subcategory: 'Техника', brand: 'Sony', model: 'WH-1000XM5', shop: 'Любой официальный', price: 32990, priority: 'Очень хочу', specs: 'Цвет: бежевый / серебристый' },
    { title: 'Кашемировый шарф', description: 'Мягкий, без рисунка', category: 'Ежемесячные', subcategory: 'Аксессуары', brand: '12 STOREEZ', price: 12900, priority: 'Хочу', specs: 'Цвет: молочный или песочный', month: ym(0) },
    { title: 'Книга «Тонкое искусство пофигизма»', category: 'Ежемесячные', subcategory: 'Книги', price: 790, priority: 'Было бы приятно', month: ym(0), wishes: 'Бумажная, не электронная' },
    { title: 'Ароматическая свеча', description: 'Древесные или травяные ноты', category: 'Ежемесячные', subcategory: 'Дом и интерьер', price: 2400, priority: 'Хочу', month: ym(-1) },
    { title: 'Фотоаппарат Fujifilm X100VI', description: 'Компактная камера для путешествий', category: 'Редкие', subcategory: 'Техника', brand: 'Fujifilm', model: 'X100VI', price: 220000, priority: 'Мечтаю', budget: 220000, targetDate: 'День рождения' },
    { title: 'Поездка в Стамбул', description: 'Неделя весной: город, еда, Босфор', category: 'Редкие', subcategory: 'Путешествия', priority: 'Мечтаю', budget: 150000, targetDate: 'Весна ' + (today.getFullYear() + 1) }
  ];
  if (!force && sh.getLastRow() > 1) return;
  var width = sh.getLastColumn();
  var startId = 0;
  if (sh.getLastRow() > 1) sh.getRange(2, m.id, sh.getLastRow() - 1, 1).getValues().forEach(function (r) { var x = String(r[0]).match(/(\d+)$/); if (x) startId = Math.max(startId, Number(x[1])); });
  var rows = demo.map(function (d, i) {
    var row = new Array(width).fill('');
    var put = function (k, v) { if (m[k]) row[m[k] - 1] = v; };
    Object.keys(d).forEach(function (k) { put(k, d[k]); });
    put('id', 'W-' + ('0000' + (startId + i + 1)).slice(-4));
    put('status', 'В списке'); put('qty', 1); put('addedAt', new Date(today.getTime() - i * 86400000));
    put('visible', 'Да'); put('currency', 'RUB'); if (!d.repeatType) put('repeatType', 'Нет'); else put('timesDone', 0);
    return row;
  });
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, width).setValues(rows);
}
