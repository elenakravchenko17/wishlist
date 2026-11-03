/* Wishlist — логика страницы (гости + режим владельца). Данные приходят из Google Таблицы через Apps Script. */
(function () {
  'use strict';

  var API = (window.WISHLIST_API || '').trim();
  var S = { data: null, tab: 'all', sub: '', q: '', sort: 'priority', onlyFree: false, owner: null, preview: false, reveal: {} };
  var PRIO = { 'Мечтаю': 1, 'Очень хочу': 2, 'Хочу': 3, 'Было бы приятно': 4 };
  var CUR = { RUB: '₽', USD: '$', EUR: '€', GBP: '£', CNY: '¥', TRY: '₺', KZT: '₸', GEL: '₾', AMD: '֏' };
  var MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
  var TAKEN = ['Подарят', 'Забронировано', 'Куплено'];
  var mem = {};

  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function money(n, c) { if (!n && n !== 0) return ''; return Number(n).toLocaleString('ru-RU', { maximumFractionDigits: 2 }) + ' ' + (CUR[c] || c || ''); }
  function ruDate(s) { var m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? m[3] + '.' + m[2] + '.' + m[1] : s; }
  function monthLabel(ym) { var m = String(ym || '').match(/^(\d{4})-(\d{2})$/); return m ? MONTHS[+m[2] - 1] + ' ' + m[1] : 'Без месяца'; }
  function plural(n, a, b, c) { var m10 = n % 10, m100 = n % 100; return m10 === 1 && m100 !== 11 ? a : (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20) ? b : c); }

  function load(k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return k in mem ? mem[k] : d; } }
  function save(k, v) { mem[k] = v; try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } }
  function drop(k) { delete mem[k]; try { localStorage.removeItem(k); } catch (e) { } }
  function myClaims() { return load('wl_claims', []); }
  function myClaim(id) { return myClaims().filter(function (c) { return c.wishId === id; })[0]; }
  function myName() { return load('wl_name', ''); }

  // ---------- связь с таблицей ----------
  function req(payload) {
    var opts = payload ? { method: 'POST', body: JSON.stringify(payload), redirect: 'follow' } : { cache: 'no-store', redirect: 'follow' };
    var url = payload ? API : API + (API.indexOf('?') < 0 ? '?' : '&') + 'action=data&t=' + Date.now();
    return fetch(url, opts).then(function (r) { if (!r.ok) throw new Error(); return r.json(); }, function () { throw new Error('Нет связи. Проверьте интернет и попробуйте ещё раз.'); })
      .then(function (x) { if (!x || !x.ok) throw new Error((x && x.error) || 'Не получилось. Попробуйте ещё раз.'); return x; },
        function (e) { throw new Error(e.message || 'Сервер ответил странно. Обновите страницу.'); });
  }
  function call(action, p) { var b = Object.assign({ action: action }, p || {}); if (S.owner && /^(adminData|saveWish|deleteWish|uploadPhoto|saveSettings)$/.test(action)) b.key = S.owner; return req(b); }

  function isOwnerView() { return !!S.owner && !S.preview; }

  function refresh() {
    var p = S.owner ? call('adminData') : req();
    return p.then(function (d) {
      if (S.owner) d = fromAdmin(d);
      S.data = d;
      $('#pageTitle').textContent = d.settings.title || 'Wishlist';
      document.title = d.settings.title || 'Wishlist';
      $('#pageSubtitle').textContent = d.settings.subtitle || '';
      $('#tabDone').hidden = !d.settings.showFulfilled && !isOwnerView();
      $('#tabHidden').hidden = !isOwnerView();
      fillSubs(); render();
    }).catch(function (e) {
      if (S.owner && /не подходит|Подождите/.test(e.message)) { drop('wl_owner'); S.owner = null; setOwnerUi(); toast(e.message); return refresh(); }
      throw e;
    });
  }

  /** Данные владельца → общий вид + скрытые и полученные. */
  function fromAdmin(d) {
    var wishes = [], fulfilled = [], hidden = [];
    d.wishes.forEach(function (w) {
      if (!w.visible || w.rawStatus === 'Больше не актуально') hidden.push(w);
      else if (!w.recurring && w.rawStatus === 'Получено') fulfilled.push(w);
      else wishes.push(w);
    });
    d.wishesAll = d.wishes; d.wishes = wishes; d.fulfilled = fulfilled; d.hidden = hidden;
    return d;
  }

  // ---------- статусы ----------
  function isRec(w) { return !!w.recurring; }
  function isTaken(w) { return TAKEN.indexOf(w.status) >= 0; }
  function isFree(w) { return isRec(w) ? w.recurring.available : (w.status === 'В списке' || w.status === 'Присмотрено'); }
  function stInfo(w) {
    if (isRec(w)) return w.recurring.available ? ['st-recurring', 'Можно дарить'] : ['st-wait', 'Снова с ' + ruDate(w.recurring.nextAvailable)];
    if (isTaken(w)) return ['st-taken', 'Уже дарят'];
    return ({ 'В списке': ['st-free', 'Свободно'], 'Присмотрено': ['st-seen', 'Присмотрено'], 'Получено': ['st-got', 'Получено'], 'Больше не актуально': ['st-got', 'Не актуально'] })[w.status] || ['st-free', 'Свободно'];
  }
  function sortPrice(w) { return w.price || (w.recurring && (w.recurring.unitCost || w.recurring.min)) || w.budget || 0; }
  function phClass(id) { var h = 0; String(id).split('').forEach(function (c) { h = (h * 31 + c.charCodeAt(0)) % 997; }); return 'c' + (h % 5); }
  function photoHtml(w) {
    var ph = '<div class="ph ' + phClass(w.id || w.title) + '">' + esc((w.title || '?').trim().charAt(0).toUpperCase()) + '</div>';
    return w.photo ? ph + '<img loading="lazy" referrerpolicy="no-referrer" alt="" src="' + esc(w.photo) + '">' : ph;
  }
  function allWishes() { return S.data ? (S.data.wishesAll || S.data.wishes.concat(S.data.fulfilled || [])) : []; }
  function byId(id) { return allWishes().filter(function (w) { return w.id === id; })[0]; }

  // ---------- фильтры и отрисовка ----------
  function fillSubs() {
    var subs = {};
    (S.data.wishes || []).forEach(function (w) { if (w.subcategory && (S.tab === 'all' || w.category === S.tab)) subs[w.subcategory] = 1; });
    var sel = $('#sub');
    sel.innerHTML = '<option value="">Все подкатегории</option>' + Object.keys(subs).sort().map(function (s) { return '<option>' + esc(s) + '</option>'; }).join('');
    if (subs[S.sub]) sel.value = S.sub; else S.sub = '';
  }

  function visibleWishes() {
    var q = S.q.trim().toLowerCase();
    var cmp = {
      'priority': function (a, b) { return (PRIO[a.priority] || 9) - (PRIO[b.priority] || 9); },
      'new': function (a, b) { return String(b.addedAt).localeCompare(String(a.addedAt)); },
      'price-asc': function (a, b) { return sortPrice(a) - sortPrice(b); },
      'price-desc': function (a, b) { return sortPrice(b) - sortPrice(a); }
    }[S.sort];
    return S.data.wishes.filter(function (w) {
      if (S.tab !== 'all' && w.category !== S.tab) return false;
      if (S.sub && w.subcategory !== S.sub) return false;
      if (S.onlyFree && !isFree(w)) return false;
      if (q && [w.title, w.brand, w.model, w.description, w.subcategory].join(' ').toLowerCase().indexOf(q) < 0) return false;
      return true;
    }).sort(function (a, b) { return (isFree(a) ? 0 : 1) - (isFree(b) ? 0 : 1) || cmp(a, b) || a.title.localeCompare(b.title); });
  }

  function empty(t, s) { return '<div class="empty"><h3>' + esc(t) + '</h3><p>' + esc(s) + '</p></div>'; }

  function render() {
    var box = $('#content');
    var special = S.tab === 'done' || S.tab === 'hidden';
    $('#toolbar').hidden = special; $('#legend').hidden = special;
    if (S.tab === 'done') {
      var f = S.data.fulfilled || [];
      box.innerHTML = f.length ? '<div class="grid">' + f.map(doneCard).join('') + '</div>' : empty('Пока пусто', 'Здесь появятся желания, которые уже исполнились.');
      return;
    }
    if (S.tab === 'hidden') {
      var h = S.data.hidden || [];
      box.innerHTML = h.length ? '<div class="grid">' + h.map(card).join('') + '</div>' : empty('Скрытых нет', 'Сюда попадают желания, которые вы скрыли или отметили «Больше не актуально».');
      return;
    }
    var list = visibleWishes();
    if (!list.length) {
      box.innerHTML = S.data.wishes.length ? empty('Ничего не нашлось', 'Попробуйте изменить поиск или фильтры.')
        : (isOwnerView() ? empty('Список пока пуст', 'Нажмите «＋ Желание» внизу, чтобы добавить первое.') : empty('Список пока пуст', 'Скоро здесь появятся желания.'));
      return;
    }
    if (S.tab === 'Ежемесячные') {
      var g = {};
      list.forEach(function (w) { (g[w.month || ''] = g[w.month || ''] || []).push(w); });
      box.innerHTML = Object.keys(g).sort().reverse().map(function (m) {
        var n = g[m].length;
        return '<h2 class="month-head">' + esc(monthLabel(m)) + '<span>' + n + ' ' + plural(n, 'желание', 'желания', 'желаний') + '</span></h2><div class="grid">' + g[m].map(card).join('') + '</div>';
      }).join('');
    } else box.innerHTML = '<div class="grid">' + list.map(card).join('') + '</div>';
  }

  var EDIT_ICON = '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/></svg>';

  function card(w) {
    var st = stInfo(w), free = isFree(w), owner = isOwnerView();
    var hiddenCls = owner && (w.visible === false || w.rawStatus === 'Больше не актуально') ? ' is-hidden' : '';
    var h = '<article class="card' + (free ? '' : ' is-taken') + hiddenCls + '" data-id="' + esc(w.id) + '">';
    if (owner) h += '<button class="edit" type="button" data-act="edit" data-id="' + esc(w.id) + '" aria-label="Изменить">' + EDIT_ICON + '</button>';
    h += '<div class="photo">' + photoHtml(w) + '<span class="pill ' + st[0] + '">' + esc(st[1]) + '</span>';
    if (w.priority) h += '<span class="prio' + (PRIO[w.priority] === 1 ? ' p1' : '') + '">' + (PRIO[w.priority] === 1 ? '♥ ' : '') + esc(w.priority) + '</span>';
    h += '</div><div class="body">';
    var brand = [w.brand, w.model].filter(Boolean).join(' · ');
    if (brand) h += '<div class="brand">' + esc(brand) + '</div>';
    h += '<h3 class="title">' + esc(w.title) + '</h3>';
    if (w.description) h += '<p class="desc">' + esc(w.description) + '</p>';
    if (w.specs) h += '<p class="specs">' + esc(w.specs) + '</p>';
    var tags = [];
    if (S.tab === 'all' || S.tab === 'hidden') tags.push(w.category);
    if (w.subcategory) tags.push(w.subcategory);
    if (w.category === 'Редкие' && w.targetDate) tags.push('Когда: ' + w.targetDate);
    if (w.category === 'Редкие' && w.budget) tags.push('Бюджет: ' + money(w.budget, w.currency));
    if (w.shop) tags.push(w.shop);
    if (w.qty > 1) tags.push('× ' + w.qty);
    if (owner && w.visible === false) tags.push('Скрыто от гостей');
    if (tags.length) h += '<div class="meta">' + tags.map(function (t) { return '<span class="tag">' + esc(t) + '</span>'; }).join('') + '</div>';
    if (isRec(w)) {
      var r = w.recurring;
      h += '<div class="rec"><svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 0 1 14-5.3M20 12a8 8 0 0 1-14 5.3"/><path d="M18 3v4h-4M6 21v-4h4"/></svg>' + esc(r.period ? 'Повторяется ' + r.period : 'Можно дарить снова и снова') + '</div>';
      h += '<div class="note">Исполнено ' + r.timesDone + ' ' + plural(r.timesDone, 'раз', 'раза', 'раз') + '</div>';
    }
    if (w.wishes) h += '<div class="note">Пожелание: ' + esc(w.wishes) + '</div>';
    if (owner && w.comment) h += '<div class="note">🔒 ' + esc(w.comment) + '</div>';
    if (owner && isTaken(w)) {
      h += '<div class="owner-meta">' + (S.reveal[w.id] ? 'Дарит: <b>' + esc(w.claimedBy || '—') + '</b>' + (w.claimedAt ? ' · ' + ruDate(w.claimedAt) : '') + (w.claimNote ? '<br>«' + esc(w.claimNote) + '»' : '')
        : 'Кто-то уже выбрал этот подарок · <button class="btn-link" type="button" data-act="reveal" data-id="' + esc(w.id) + '">показать кто</button>') + '</div>';
    }
    h += '<div class="price">' + priceHtml(w) + '</div>';
    var links = [];
    if (w.url) links.push('<a href="' + esc(w.url) + '" target="_blank" rel="noopener noreferrer">В магазин ↗</a>');
    if (w.url2) links.push('<a href="' + esc(w.url2) + '" target="_blank" rel="noopener noreferrer">Ещё вариант ↗</a>');
    if (links.length) h += '<div class="links">' + links.join('') + '</div>';
    if (!owner) h += '<div class="actions">' + actionsHtml(w) + '</div>';
    return h + '</div></article>';
  }

  function priceHtml(w) {
    if (isRec(w)) {
      var r = w.recurring;
      if (r.min && r.max) return money(r.min, w.currency).replace(/ \S+$/, '') + '–' + money(r.max, w.currency);
      if (r.unitCost) return '≈ ' + money(r.unitCost, w.currency) + ' <small>за раз</small>';
      if (r.min) return 'от ' + money(r.min, w.currency);
      return '<small>Сумма на ваше усмотрение</small>';
    }
    if (w.price) return money(w.price, w.currency);
    if (w.budget) return '<small>Бюджет</small> ' + money(w.budget, w.currency);
    return '';
  }

  function actionsHtml(w) {
    var b = function (cls, act, label, dis) { return '<button type="button" class="btn ' + cls + '" data-act="' + act + '" data-id="' + esc(w.id) + '"' + (dis ? ' disabled' : '') + '>' + label + '</button>'; };
    if (isRec(w)) return w.recurring.available ? b('btn-accent', 'gift', 'Подарить') : b('btn-ghost', 'none', 'Снова с ' + esc(ruDate(w.recurring.nextAvailable)), true);
    if (isTaken(w)) return myClaim(w.id) ? '<span class="mine-note" style="align-self:center;flex:1">Это дарите вы</span>' + b('btn-ghost', 'undo', 'Отменить') : b('btn-ghost', 'none', 'Уже дарят', true) + b('btn-ghost', 'contrib', 'Вклад');
    return b('btn-primary', 'claim', 'Подарю это') + b('btn-ghost', 'contrib', 'Вклад');
  }

  function doneCard(w) {
    var owner = isOwnerView();
    return '<article class="card">' + (owner ? '<button class="edit" type="button" data-act="edit" data-id="' + esc(w.id) + '" aria-label="Изменить">' + EDIT_ICON + '</button>' : '') +
      '<div class="photo">' + photoHtml(w) + '<span class="pill st-got">Исполнено</span></div><div class="body">' +
      (w.brand ? '<div class="brand">' + esc(w.brand) + '</div>' : '') + '<h3 class="title">' + esc(w.title) + '</h3>' +
      '<div class="meta"><span class="tag">' + esc(w.category) + '</span>' + (w.subcategory ? '<span class="tag">' + esc(w.subcategory) + '</span>' : '') + '</div>' +
      (owner && w.claimedBy ? '<div class="note">Подарил(а): ' + esc(w.claimedBy) + '</div>' : '') + '</div></article>';
  }

  // ---------- окно ----------
  var lastFocus = null;
  function openSheet(html, mount, wide) {
    lastFocus = document.activeElement;
    $('#sheet').classList.toggle('wide', !!wide);
    $('#sheetBody').innerHTML = html;
    $('#overlay').hidden = false;
    document.body.style.overflow = 'hidden';
    $('#sheet').scrollTop = 0;
    if (mount) mount($('#sheetBody'));
  }
  function closeSheet() { $('#overlay').hidden = true; document.body.style.overflow = ''; if (lastFocus && lastFocus.focus) lastFocus.focus(); }
  function toast(msg) { var t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(function () { t.hidden = true; }, 3500); }
  function wishLine(w) { return w ? '<div class="wishline"><div class="mini">' + photoHtml(w) + '</div><div><b>' + esc(w.title) + '</b><span class="note">' + priceHtml(w) + '</span></div></div>' : ''; }
  function nameField() { return '<label class="field"><span>Ваше имя</span><input name="name" required minlength="2" maxlength="40" autocomplete="name" value="' + esc(myName()) + '" placeholder="Как вас представить"></label>'; }
  var HP = '<input class="hp" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">';
  var ERR = '<p class="err" hidden></p>';
  function need(c, m) { if (!c) throw new Error(m); }
  function amountOf(v) { var n = Number(String(v || '').replace(/\s/g, '').replace(',', '.')); return isFinite(n) ? n : NaN; }

  function wire(form, action, build, onOk) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var err = $('.err', form), btn = $('button[type=submit]', form), label = btn.textContent, p;
      err.hidden = true;
      try { p = build(new FormData(form), form); } catch (ex) { err.textContent = ex.message; err.hidden = false; err.scrollIntoView({ block: 'nearest' }); return; }
      if (form.website && form.website.value) p.website = form.website.value;
      if (p.name) save('wl_name', p.name);
      btn.disabled = true; btn.textContent = 'Секунду…';
      call(action, p).then(function (res) { onOk(res, p); refresh().catch(function () { }); })
        .catch(function (ex) { err.textContent = ex.message; err.hidden = false; err.scrollIntoView({ block: 'nearest' }); btn.disabled = false; btn.textContent = label; refresh().catch(function () { }); });
    });
  }
  function done(title, text) {
    openSheet('<h2>' + esc(title) + '</h2><p class="lead">' + text + '</p><button class="btn btn-primary btn-full" type="button" id="ok">Готово</button>', function (r) { $('#ok', r).onclick = closeSheet; });
  }

  // ---------- гость ----------
  function claimForm(id) {
    var w = byId(id);
    openSheet('<h2>Подарю это</h2><p class="lead">Желание сразу станет «Уже дарят» — так подарок не повторится.</p>' + wishLine(w) +
      '<form novalidate>' + ERR + nameField() +
      '<label class="field"><span>Комментарий <span class="note">(необязательно)</span></span><textarea name="comment" maxlength="300" placeholder="Например: подарю на Новый год"></textarea></label>' + HP +
      '<label class="check"><input type="checkbox" name="confirm"><span>Да, я подарю это желание</span></label>' +
      '<button class="btn btn-primary btn-full" type="submit">Подарю это</button></form>', function (root) {
        wire($('form', root), 'claim', function (fd) {
          need(String(fd.get('name') || '').trim().length >= 2, 'Укажите имя — от 2 символов.');
          need(fd.get('confirm'), 'Поставьте галочку «Да, я подарю».');
          return { wishId: id, name: String(fd.get('name')).trim(), comment: fd.get('comment'), confirm: true };
        }, function (res) {
          save('wl_claims', myClaims().filter(function (c) { return c.wishId !== res.wishId; }).concat([{ wishId: res.wishId, token: res.token, title: res.title }]));
          done('Спасибо!', '«' + esc(res.title) + '» теперь отмечено как «Уже дарят». Передумаете — нажмите «Отменить» на карточке с этого же телефона.');
        });
      });
  }

  function undoForm(id) {
    var c = myClaim(id), w = byId(id);
    if (!c) return;
    openSheet('<h2>Отменить?</h2><p class="lead">Желание снова станет свободным для других.</p>' + wishLine(w) +
      '<div class="actions"><button class="btn btn-ghost" type="button" id="keep">Оставить</button><button class="btn btn-accent" type="button" id="go">Отменить</button></div><p class="err" hidden></p>', function (root) {
        $('#keep', root).onclick = closeSheet;
        $('#go', root).onclick = function () {
          var btn = this; btn.disabled = true;
          call('undoClaim', { wishId: id, token: c.token }).then(function () {
            save('wl_claims', myClaims().filter(function (x) { return x.wishId !== id; }));
            closeSheet(); toast('Отменено'); refresh();
          }).catch(function (e) { var err = $('.err', root); err.textContent = e.message; err.hidden = false; btn.disabled = false; });
        };
      });
  }

  function contribForm(id) {
    var list = S.data.wishes.filter(function (w) { return !isTaken(w) || w.id === id; });
    var curs = S.data.settings.currencies || ['RUB'];
    openSheet('<h2>Денежный вклад</h2><p class="lead">Самостоятельный подарок любой суммы. Он не отмечает желание как подаренное.</p>' +
      '<form novalidate>' + ERR + '<label class="field"><span>На что <span class="note">(необязательно)</span></span><select name="wishId"><option value="">Без привязки — на любое желание</option>' +
      list.map(function (w) { return '<option value="' + esc(w.id) + '"' + (w.id === id ? ' selected' : '') + '>' + esc(w.title) + '</option>'; }).join('') + '</select></label>' + nameField() +
      '<div class="row2"><label class="field"><span>Сумма</span><input name="amount" inputmode="decimal" placeholder="Например, 3000"></label>' +
      '<label class="field"><span>Валюта</span><select name="currency">' + curs.map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('') + '</select></label></div>' +
      '<label class="field"><span>Комментарий <span class="note">(необязательно)</span></span><textarea name="comment" maxlength="500"></textarea></label>' + HP +
      '<label class="check"><input type="checkbox" name="confirm"><span>Подтверждаю. Деньги передам владельцу списка сам(а) — сайт только сохраняет запись о подарке.</span></label>' +
      '<button class="btn btn-primary btn-full" type="submit">Внести вклад</button></form>', function (root) {
        var form = $('form', root);
        var sync = function () { var w = byId(form.wishId.value); form.currency.value = (w && w.currency) || S.data.settings.currency || curs[0]; };
        form.wishId.addEventListener('change', sync); sync();
        wire(form, 'contribute', function (fd) {
          need(amountOf(fd.get('amount')) > 0, 'Укажите сумму больше нуля.');
          need(fd.get('confirm'), 'Подтвердите вклад галочкой.');
          return { wishId: fd.get('wishId') || '', name: String(fd.get('name') || '').trim(), amount: String(fd.get('amount')).trim(), currency: fd.get('currency'), comment: fd.get('comment'), confirm: true };
        }, function (res) { done('Спасибо!', 'Вклад ' + esc(money(res.amount, res.currency)) + ' записан. Не забудьте передать подарок владельцу списка.'); });
      });
  }

  function giftForm(id) {
    var w = byId(id); if (!w || !w.recurring) return;
    var r = w.recurring, cur = w.currency || S.data.settings.currency;
    var chips = []; [r.min, r.unitCost, r.max].forEach(function (v) { if (v && chips.indexOf(v) < 0) chips.push(v); });
    var range = r.min && r.max ? 'от ' + money(r.min, cur) + ' до ' + money(r.max, cur) : r.min ? 'от ' + money(r.min, cur) : r.max ? 'до ' + money(r.max, cur) : 'любая';
    openSheet('<h2>Подарить</h2><p class="lead">Вы дарите деньги на это желание. Где, когда и как его исполнить — решит владелец списка.</p>' + wishLine(w) +
      '<form novalidate>' + ERR + nameField() +
      '<label class="field"><span>Сумма, ' + esc(CUR[cur] || cur) + '</span><input name="amount" inputmode="decimal" value="' + esc(r.unitCost || r.min || '') + '"></label><p class="hint">Сумма: ' + esc(range) + '</p>' +
      (chips.length ? '<div class="chips">' + chips.map(function (c) { return '<button type="button" class="chip" data-v="' + c + '">' + esc(money(c, cur)) + '</button>'; }).join('') + '</div>' : '') +
      '<label class="field"><span>Пожелание <span class="note">(необязательно)</span></span><textarea name="comment" maxlength="500" placeholder="Пара тёплых слов"></textarea></label>' + HP +
      '<label class="check"><input type="checkbox" name="confirm"><span>Подтверждаю. Деньги передам владельцу списка сам(а).</span></label>' +
      '<button class="btn btn-accent btn-full" type="submit">Подарить</button></form>', function (root) {
        var form = $('form', root);
        $$('.chip', root).forEach(function (c) { c.onclick = function () { form.amount.value = c.getAttribute('data-v'); }; });
        wire(form, 'giftRecurring', function (fd) {
          var a = amountOf(fd.get('amount'));
          need(a > 0, 'Укажите сумму больше нуля.');
          need(!r.min || a >= r.min, 'Минимальная сумма — ' + money(r.min, cur) + '.');
          need(!r.max || a <= r.max, 'Максимальная сумма — ' + money(r.max, cur) + '.');
          need(fd.get('confirm'), 'Подтвердите подарок галочкой.');
          return { wishId: id, name: String(fd.get('name') || '').trim(), amount: String(fd.get('amount')).trim(), comment: fd.get('comment'), confirm: true };
        }, function (res) {
          done('Спасибо за подарок!', '«' + esc(w.title) + '» исполнено уже ' + res.timesDone + ' ' + plural(res.timesDone, 'раз', 'раза', 'раз') + '. ' +
            (res.available ? 'Желание снова доступно — его можно подарить ещё раз.' : 'Снова будет доступно с ' + esc(ruDate(res.nextAvailable)) + '.') + ' Не забудьте передать подарок владельцу списка.');
        });
      });
  }

  // ---------- владелец ----------
  function opt(list, val, empty) { return (empty !== undefined ? '<option value="">' + esc(empty) + '</option>' : '') + list.map(function (x) { return '<option' + (x === val ? ' selected' : '') + '>' + esc(x) + '</option>'; }).join(''); }
  function fld(label, html, cls) { return '<label class="field' + (cls ? ' ' + cls : '') + '"><span>' + label + '</span>' + html + '</label>'; }
  function inp(name, val, attrs) { return '<input name="' + name + '" value="' + esc(val == null ? '' : val) + '" ' + (attrs || '') + '>'; }

  function editForm(id) {
    var d = S.data, L = d.lists, w = id ? (d.wishesAll || []).filter(function (x) { return x.id === id; })[0] : null;
    w = w || { category: S.tab && ['Постоянные', 'Ежемесячные', 'Редкие'].indexOf(S.tab) >= 0 ? S.tab : 'Постоянные', currency: d.settings.currency, rawStatus: 'В списке', visible: true, repeatType: 'Нет', priority: 'Хочу', qty: 1 };
    var html = '<h2>' + (id ? 'Изменить желание' : 'Новое желание') + '</h2><form novalidate>' + ERR +
      '<fieldset class="fs"><legend>Главное</legend>' +
      fld('Название *', inp('title', w.title, 'required maxlength="200" placeholder="Например, кашемировый шарф"')) +
      fld('Описание', '<textarea name="description" maxlength="1000" placeholder="Пара слов, что именно хочется">' + esc(w.description) + '</textarea>') +
      '<div class="grid2">' + fld('Категория', '<select name="category">' + opt(L.categories, w.category) + '</select>') +
      fld('Приоритет', '<select name="priority">' + opt(L.priorities, w.priority, '—') + '</select>') + '</div>' +
      fld('Подкатегория', inp('subcategory', w.subcategory, 'list="subs" maxlength="60" placeholder="Выберите или впишите свою"') + '<datalist id="subs">' + L.subcategories.map(function (s) { return '<option value="' + esc(s) + '">'; }).join('') + '</datalist>') +
      '<div data-show="Ежемесячные">' + fld('Месяц', '<input type="month" name="month" value="' + esc(w.monthRaw || w.month || '') + '">') + '</div>' +
      '<div data-show="Редкие" class="grid2">' + fld('Когда примерно', inp('targetDate', w.targetDateRaw || w.targetDate, 'maxlength="60" placeholder="День рождения, весна 2027…"')) +
      fld('Желаемый бюджет', inp('budget', w.budget || '', 'inputmode="decimal"')) + '</div></fieldset>' +

      '<fieldset class="fs"><legend>Фото</legend><div class="photo-pick"><div class="thumb" id="thumb">' + photoHtml({ id: w.id || 'new', title: w.title || '?', photo: w.photo }) + '</div><div class="col">' +
      '<label class="btn btn-ghost upload-btn">📷 Загрузить фото<input type="file" accept="image/*" id="file"></label>' +
      inp('photo', w.photoRaw || w.photo, 'type="url" placeholder="или вставьте ссылку на картинку" inputmode="url"') + '<span class="note" id="upNote"></span></div></div></fieldset>' +

      '<fieldset class="fs"><legend>Цена и где купить</legend><div class="grid3">' + fld('Цена', inp('price', w.price || '', 'inputmode="decimal"')) +
      fld('Валюта', '<select name="currency">' + opt(L.currencies, w.currency) + '</select>') + fld('Кол-во', inp('qty', w.qty || 1, 'inputmode="numeric"')) + '</div>' +
      fld('Ссылка на товар', inp('url', w.url, 'type="url" inputmode="url" placeholder="https://"')) +
      fld('Альтернативная ссылка', inp('url2', w.url2, 'type="url" inputmode="url" placeholder="https://"')) +
      '<div class="grid2">' + fld('Бренд', inp('brand', w.brand, 'maxlength="300"')) + fld('Модель', inp('model', w.model, 'maxlength="300"')) + '</div>' +
      fld('Магазин', inp('shop', w.shop, 'maxlength="300"')) +
      fld('Размер, цвет, комплектация', inp('specs', w.specs, 'maxlength="300"')) +
      fld('Пожелания к подарку', inp('wishes', w.wishes, 'maxlength="300" placeholder="Видно гостям"')) +
      fld('Личный комментарий 🔒', inp('comment', w.comment, 'maxlength="1000" placeholder="Видите только вы"')) + '</fieldset>' +

      '<fieldset class="fs"><legend>Повторение</legend>' +
      fld('Тип', '<select name="repeatType">' + opt(L.repeat, w.repeatType || 'Нет') + '</select>') +
      '<p class="hint" id="repHint"></p><div data-rep>' +
      '<div class="grid2">' + fld('Периодичность', '<select name="period">' + opt(L.periods, w.period, 'Без интервала') + '</select>') +
      '<div data-custom>' + fld('Интервал, дней', inp('periodDays', w.periodDays || '', 'inputmode="numeric"')) + '</div></div>' +
      '<div class="grid3">' + fld('Обычно за раз', inp('unitCost', w.unitCost || '', 'inputmode="decimal"')) + fld('Сумма от', inp('amountMin', w.amountMin || '', 'inputmode="decimal"')) + fld('до', inp('amountMax', w.amountMax || '', 'inputmode="decimal"')) + '</div>' +
      (id && w.recurring ? '<p class="note">Исполнено ' + (w.timesDone || 0) + ' раз.' + (w.nextAvailableRaw ? ' Снова доступно с ' + ruDate(w.nextAvailableRaw) + ' · <button type="button" class="btn-link" id="resetNext">сделать доступным сейчас</button>' : '') + '</p>' : '') +
      '</div></fieldset>' +

      '<fieldset class="fs"><legend>Статус</legend>' + fld('Статус', '<select name="status">' + opt(L.statuses, TAKEN.indexOf(w.rawStatus) >= 0 ? 'Подарят' : w.rawStatus) + '</select>') +
      '<div class="switch-row"><span>Показывать гостям</span><label class="switch"><input type="checkbox" name="visible"' + (w.visible !== false ? ' checked' : '') + '><span></span></label></div></fieldset>' +
      '<div class="sticky-actions">' + (id ? '<button class="btn btn-danger" type="button" id="del">Удалить</button>' : '') + '<button class="btn btn-primary" type="submit">Сохранить</button></div></form>';

    openSheet(html, function (root) {
      var form = $('form', root), resetNext = false;
      var sync = function () {
        $$('[data-show]', form).forEach(function (el) { el.hidden = el.getAttribute('data-show') !== form.category.value; });
        var rep = form.repeatType.value !== 'Нет';
        $('[data-rep]', form).hidden = !rep;
        $('[data-custom]', form).hidden = form.period.value !== 'Свой интервал';
        $('#repHint', form).textContent = {
          'Нет': 'Обычное желание: гость нажимает «Подарю это», и оно становится занятым.',
          'Неограниченно': 'Можно дарить сколько угодно раз подряд — например, кофе.',
          'Периодически': 'После подарка снова доступно через выбранный интервал — например, цветы раз в месяц.',
          'Впечатление': 'Рестораны, кофейни, поездки. С интервалом или без.'
        }[form.repeatType.value] || '';
      };
      ['category', 'repeatType', 'period'].forEach(function (n) { form[n].addEventListener('change', sync); }); sync();
      form.photo.addEventListener('input', function () { $('#thumb', root).innerHTML = photoHtml({ id: 'x', title: form.title.value || '?', photo: form.photo.value.trim() }); });
      $('#file', root).addEventListener('change', function () { var f = this.files[0]; if (f) uploadPhoto(f, form, root); this.value = ''; });
      if ($('#resetNext', root)) $('#resetNext', root).onclick = function () { resetNext = true; this.parentNode.textContent = 'Будет доступно сразу после сохранения.'; };
      if ($('#del', root)) $('#del', root).onclick = function () { deleteWish(w, root); };
      wire(form, 'saveWish', function (fd) {
        need(String(fd.get('title') || '').trim(), 'Укажите название.');
        var o = { id: id || '' };
        ['title', 'description', 'category', 'subcategory', 'photo', 'price', 'currency', 'qty', 'url', 'url2', 'brand', 'model', 'shop', 'specs', 'wishes', 'comment',
          'month', 'targetDate', 'budget', 'repeatType', 'period', 'periodDays', 'unitCost', 'amountMin', 'amountMax', 'status', 'priority'].forEach(function (k) { o[k] = String(fd.get(k) == null ? '' : fd.get(k)).trim(); });
        if (o.category !== 'Ежемесячные') delete o.month;
        o.visible = !!fd.get('visible');
        if (resetNext) o.nextAvailable = '';
        ['url', 'url2', 'photo'].forEach(function (k) { need(!o[k] || /^https?:\/\//i.test(o[k]), 'Ссылки должны начинаться с https://'); });
        return { wish: o };
      }, function () { closeSheet(); toast(id ? 'Сохранено' : 'Желание добавлено'); });
    }, true);
  }

  function uploadPhoto(file, form, root) {
    var note = $('#upNote', root);
    note.textContent = 'Загружаю фото…';
    resizeImage(file, 1400).then(function (dataUrl) {
      $('#thumb', root).innerHTML = '<img alt="" src="' + dataUrl + '">';
      return call('uploadPhoto', { mime: 'image/jpeg', data: dataUrl.split(',')[1] });
    }).then(function (res) { form.photo.value = res.url; note.textContent = 'Фото загружено ✓ Не забудьте сохранить.'; })
      .catch(function (e) { note.textContent = e.message || 'Не удалось загрузить фото.'; });
  }

  function resizeImage(file, max) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        var k = Math.min(1, max / Math.max(img.width, img.height));
        var c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url); resolve(c.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = function () { reject(new Error('Это не похоже на фото. Попробуйте другой файл.')); };
      img.src = url;
    });
  }

  function deleteWish(w, root) {
    if (!confirm('Удалить «' + w.title + '»? Строка переместится на лист КОРЗИНА в таблице — её можно будет вернуть.')) return;
    call('deleteWish', { id: w.id }).then(function () { closeSheet(); toast('Удалено'); refresh(); })
      .catch(function (e) { var err = $('.err', root); err.textContent = e.message; err.hidden = false; });
  }

  function historyPanel(tab) {
    tab = tab || 'log';
    var d = S.data, body = '';
    var li = function (left, sub, right) { return '<li><div><b>' + left + '</b><div class="note">' + sub + '</div></div>' + (right ? '<span class="sum">' + right + '</span>' : '') + '</li>'; };
    if (tab === 'log') body = d.log.length ? '<ul class="hist">' + d.log.map(function (r) { return li(esc(r['Действие']) + ' · ' + esc(r['Название']), esc(r['Имя']) + ' · ' + esc(ruDate(r['Дата и время'])) + (r['Комментарий'] ? ' · «' + esc(r['Комментарий']) + '»' : ''), ''); }).join('') + '</ul>' : '<p class="note">Пока пусто.</p>';
    if (tab === 'money') {
      var t = d.stats.moneyTotals, keys = Object.keys(t);
      body = (keys.length ? '<div class="totals">' + keys.map(function (c) { return '<div><span class="note">Всего, ' + esc(c) + '</span><b>' + esc(money(t[c], c)) + '</b></div>'; }).join('') + '</div>' : '') +
        (d.money.length ? '<ul class="hist">' + d.money.map(function (r) { return li(esc(r['Имя']), esc(r['Название желания']) + ' · ' + esc(ruDate(r['Дата и время'])) + (r['Комментарий'] ? ' · «' + esc(String(r['Комментарий']).replace(/^'/, '')) + '»' : ''), esc(money(r['Сумма'], r['Валюта']))); }).join('') + '</ul>' : '<p class="note">Вкладов пока нет.</p>');
    }
    if (tab === 'rec') {
      body = '<h3 class="fs" style="font-family:var(--serif);font-size:22px;margin:0 0 6px">По желаниям</h3>' +
        (d.stats.recurringByWish.length ? '<ul class="hist">' + d.stats.recurringByWish.map(function (x) { return li(esc(x.title), x.count + ' ' + plural(x.count, 'раз', 'раза', 'раз') + ' · последний ' + esc(ruDate(x.last)), esc(money(x.sum, x.currency))); }).join('') + '</ul>' : '<p class="note">Пока нет исполнений.</p>') +
        '<h3 style="font-family:var(--serif);font-size:22px;margin:18px 0 6px">Кто дарил</h3>' +
        (d.stats.recurringByPerson.length ? '<ul class="hist">' + d.stats.recurringByPerson.map(function (x) { return li(esc(x.name), x.count + ' ' + plural(x.count, 'подарок', 'подарка', 'подарков'), esc(money(x.sum, x.currency))); }).join('') + '</ul>' : '<p class="note">—</p>') +
        '<h3 style="font-family:var(--serif);font-size:22px;margin:18px 0 6px">Все исполнения</h3>' +
        (d.exec.length ? '<ul class="hist">' + d.exec.map(function (r) { return li(esc(r['Название']) + ' №' + esc(r['№ исполнения']), esc(r['Имя']) + ' · ' + esc(ruDate(r['Дата и время'])), esc(money(r['Сумма'], r['Валюта']))); }).join('') + '</ul>' : '<p class="note">—</p>');
    }
    openSheet('<h2>История</h2><p class="lead">Кто, что и когда дарил. Только для вас.</p><div class="seg">' +
      [['log', 'Действия'], ['money', 'Деньги'], ['rec', 'Повторы']].map(function (x) { return '<button type="button" data-h="' + x[0] + '"' + (x[0] === tab ? ' class="is-on"' : '') + '>' + x[1] + '</button>'; }).join('') + '</div>' + body,
      function (root) { $$('[data-h]', root).forEach(function (b) { b.onclick = function () { historyPanel(b.getAttribute('data-h')); }; }); }, true);
  }

  function settingsPanel() {
    var s = S.data.settings, guest = s.pageUrl || (location.origin + location.pathname);
    openSheet('<h2>Настройки</h2><form novalidate>' + ERR +
      fld('Название страницы', inp('title', s.title, 'maxlength="80"')) +
      fld('Подзаголовок', '<textarea name="subtitle" maxlength="300">' + esc(s.subtitle) + '</textarea>') +
      fld('Валюта по умолчанию', '<select name="currency">' + opt(s.currencies, s.currency) + '</select>') +
      '<div class="switch-row"><span>Показывать гостям «Исполненные»</span><label class="switch"><input type="checkbox" name="showFulfilled"' + (s.showFulfilled ? ' checked' : '') + '><span></span></label></div>' +
      fld('Адрес страницы', inp('pageUrl', s.pageUrl || (location.origin + location.pathname), 'type="url"')) +
      '<button class="btn btn-primary btn-full" type="submit">Сохранить</button></form>' +
      '<h3 style="font-family:var(--serif);font-size:22px;margin:24px 0 8px">Ссылка для гостей</h3><div class="actions"><button class="btn btn-ghost" type="button" id="copyGuest">Скопировать ссылку</button></div>' +
      '<p class="note" style="margin-top:20px">Режим владельца запомнен на этом устройстве. <button class="btn-link" type="button" id="logout">Выйти из режима владельца</button></p>', function (root) {
        wire($('form', root), 'saveSettings', function (fd) {
          return { settings: { title: String(fd.get('title') || '').trim(), subtitle: String(fd.get('subtitle') || '').trim(), currency: fd.get('currency'), showFulfilled: !!fd.get('showFulfilled'), pageUrl: String(fd.get('pageUrl') || '').trim() } };
        }, function () { closeSheet(); toast('Настройки сохранены'); });
        $('#copyGuest', root).onclick = function () { copy(guest); };
        $('#logout', root).onclick = function () { if (confirm('Выйти из режима владельца на этом устройстве? Вернуться можно по секретной ссылке.')) { drop('wl_owner'); S.owner = null; closeSheet(); setOwnerUi(); refresh(); } };
      });
  }

  function copy(text) {
    try { navigator.clipboard.writeText(text).then(function () { toast('Ссылка скопирована'); }, function () { prompt('Скопируйте ссылку:', text); }); }
    catch (e) { prompt('Скопируйте ссылку:', text); }
  }

  function setOwnerUi() {
    var o = !!S.owner;
    document.body.classList.toggle('is-owner', o && !S.preview);
    $('#ownerBar').hidden = !o;
    $('#ownerBadge').hidden = !o || S.preview;
    $('#guestActions').hidden = o && !S.preview;
    $('#footNote').hidden = o && !S.preview;
    $('#obPreview').classList.toggle('is-on', S.preview);
    $('#obPreview').textContent = S.preview ? '↩ Назад' : '👁';
    if (!o && S.tab === 'hidden') S.tab = 'all';
  }

  // ---------- события ----------
  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-act]');
    if (!t || t.disabled || !S.data) return;
    var id = t.getAttribute('data-id'), a = t.getAttribute('data-act');
    if (a === 'claim') claimForm(id);
    else if (a === 'undo') undoForm(id);
    else if (a === 'contrib') contribForm(id);
    else if (a === 'gift') giftForm(id);
    else if (a === 'edit') editForm(id);
    else if (a === 'reveal') { S.reveal[id] = true; render(); }
  });
  document.addEventListener('error', function (e) { if (e.target.tagName === 'IMG') e.target.remove(); }, true);
  $('#tabs').addEventListener('click', function (e) {
    var t = e.target.closest('.tab'); if (!t) return;
    $$('.tab').forEach(function (x) { x.classList.toggle('is-active', x === t); x.setAttribute('aria-selected', x === t); });
    S.tab = t.getAttribute('data-tab');
    if (S.data) { fillSubs(); render(); }
  });
  $('#q').addEventListener('input', function () { S.q = this.value; render(); });
  $('#sub').addEventListener('change', function () { S.sub = this.value; render(); });
  $('#sort').addEventListener('change', function () { S.sort = this.value; render(); });
  $('#onlyFree').addEventListener('change', function () { S.onlyFree = this.checked; render(); });
  $('#btnMoney').addEventListener('click', function () { if (S.data) contribForm(''); });
  $('#obAdd').addEventListener('click', function () { if (S.data) { S.preview = false; setOwnerUi(); editForm(''); } });
  $('#obHistory').addEventListener('click', function () { if (S.data) historyPanel(); });
  $('#obSettings').addEventListener('click', function () { if (S.data) settingsPanel(); });
  $('#obPreview').addEventListener('click', function () { S.preview = !S.preview; setOwnerUi(); $('#tabHidden').hidden = !isOwnerView(); if (!isOwnerView() && S.tab === 'hidden') S.tab = 'all'; render(); });
  $('#sheetClose').addEventListener('click', closeSheet);
  $('#overlay').addEventListener('click', function (e) { if (e.target === this) closeSheet(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !$('#overlay').hidden) closeSheet(); });

  // ---------- старт ----------
  var m = location.hash.match(/owner=([A-Za-z0-9]{20,})/);
  if (m) { save('wl_owner', m[1]); history.replaceState(null, '', location.pathname + location.search); }
  S.owner = load('wl_owner', null);
  setOwnerUi();

  if (!/^https:\/\/script\.google(usercontent)?\.com\//.test(API) && !window.WISHLIST_DEV) {
    $('#content').innerHTML = '<div class="setup"><h3>Почти готово</h3><p>Откройте файл <code>config.js</code> в репозитории на GitHub и вставьте адрес веб-приложения Apps Script (заканчивается на <code>/exec</code>). Его можно взять в таблице: меню <b>Wishlist → Ссылки</b>.</p></div>';
    $('#toolbar').hidden = true; $('#legend').hidden = true;
    return;
  }
  refresh().catch(function (e) { $('#content').innerHTML = empty('Не удалось загрузить список', e.message); });
  setInterval(function () { if ($('#overlay').hidden && document.visibilityState === 'visible') refresh().catch(function () { }); }, 60000);
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(function () { });
})();
