const CONFIG_KEY = 'youtrack_config';
const THEME_KEY = 'youtrack_theme';
let currentFilter = 'all';
let allIssues = [];
let currentConfig = null;
// Кэш доступных статусов (State) по проекту: { projectShortName: [ { name, number, sourceLocale } ] }
const statesCache = {};

document.addEventListener('DOMContentLoaded', async () => {
  console.log('=== Расширение загружено ===');
  
  // Загружаем тему
  await applySavedTheme();
  
  const config = await getConfig();
  currentConfig = config;
  console.log('Конфиг:', config);
  
  if (!config.token || !config.url) {
    console.log('Токен или URL не настроены');
    showConfigForm();
    return;
  }
  
  setupFilterButtons();
  setupThemeButton();
  await loadTasks(config);
  
  document.getElementById('refresh-btn').addEventListener('click', () => loadTasks(config));
  document.getElementById('open-yt').addEventListener('click', (e) => {
    e.preventDefault();
    window.open(config.url, '_blank');
  });
});

async function applySavedTheme() {
  return new Promise((resolve) => {
    chrome.storage.sync.get([THEME_KEY], (result) => {
      const theme = result[THEME_KEY] || 'light';
      if (theme === 'dark') {
        document.body.classList.add('dark');
        const themeBtn = document.getElementById('theme-btn');
        if (themeBtn) themeBtn.textContent = '☀️';
      }
      resolve();
    });
  });
}

function setupThemeButton() {
  const themeBtn = document.getElementById('theme-btn');
  if (!themeBtn) return;
  
  themeBtn.addEventListener('click', async () => {
    const isDark = document.body.classList.toggle('dark');
    themeBtn.textContent = isDark ? '☀️' : '🌙';
    
    await chrome.storage.sync.set({ [THEME_KEY]: isDark ? 'dark' : 'light' });
    console.log('Тема изменена на:', isDark ? 'тёмную' : 'светлую');
  });
}

function setupFilterButtons() {
  const buttons = document.querySelectorAll('.filter-btn');
  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      buttons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.dataset.filter;
      filterAndRender();
    });
  });
}

async function getConfig() {
  return new Promise((resolve) => {
    chrome.storage.sync.get([CONFIG_KEY], (result) => {
      resolve(result[CONFIG_KEY] || { url: '', token: '' });
    });
  });
}

async function loadTasks(config) {
  const container = document.getElementById('tasks-list');
  container.innerHTML = '<div class="loading">Загрузка...</div>';
  
  let baseUrl = config.url.trim();
  if (!baseUrl.startsWith('http://') && !baseUrl.startsWith('https://')) {
    baseUrl = 'https://' + baseUrl;
  }
  baseUrl = baseUrl.replace(/\/$/, '');
  
  const query = encodeURIComponent('for: me');
  // issue/... — стандартные префиксы полей YouTrack REST API (без них сервер возвращает пустые объекты)
  const fields = 'issue:id,issue:idReadable,issue:summary,issue:project(shortName,name),' +
    'issue:customFields(projectCustomField(field(name)),value(name))';
  const url = baseUrl + '/api/issues?query=' + query + '&fields=' + fields + '&$top=100';
  console.log('URL:', url);
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': 'Bearer ' + config.token,
        'Accept': 'application/json'
      },
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      if (response.status === 401) throw new Error('Неверный токен (401)');
      if (response.status === 403) throw new Error('Нет доступа (403)');
      if (response.status === 404) throw new Error('URL неверный (404)');
      throw new Error('HTTP ' + response.status);
    }
    
    allIssues = await response.json();
    console.log('Всего загружено задач:', allIssues.length);
    filterAndRender();
    
  } catch (error) {
    console.error('Ошибка:', error);
    let errorMsg = error.message;
    if (error.name === 'AbortError') {
      errorMsg = 'Превышено время ожидания';
    }
    container.innerHTML = '<div class="error"><strong>Ошибка:</strong><br>' + errorMsg + '</div>';
  }
}

function filterAndRender() {
  if (!currentConfig || !currentConfig.url) {
    console.error('Config не загружен');
    return;
  }
  
  let filteredIssues = allIssues;
  if (currentFilter !== 'all') {
    filteredIssues = allIssues.filter(issue => {
      const cf = issue.customFields || [];
      for (let j = 0; j < cf.length; j++) {
        const f = cf[j];
        if (f.projectCustomField && f.projectCustomField.field && f.projectCustomField.field.name === 'State') {
          if (f.value && f.value.name === currentFilter) {
            return true;
          }
        }
      }
      return false;
    });
  }
  
  console.log('Отфильтровано задач:', filteredIssues.length, 'по статусу:', currentFilter);
  renderTasks(filteredIssues, currentConfig);
}

function renderTasks(issues, config) {
  const container = document.getElementById('tasks-list');
  document.getElementById('task-count').textContent = issues.length + ' задач';
  
  if (issues.length === 0) {
    container.innerHTML = '<div class="empty">Нет задач с этим статусом</div>';
    return;
  }
  
  let html = '';
  for (let i = 0; i < issues.length; i++) {
    const issue = issues[i];
    const cf = issue.customFields || [];
    let state = '-';
    let priority = '';
    
    for (let j = 0; j < cf.length; j++) {
      const f = cf[j];
      if (f.projectCustomField && f.projectCustomField.field && f.projectCustomField.field.name === 'State') {
        if (f.value) state = f.value.name;
      }
      if (f.projectCustomField && f.projectCustomField.field && f.projectCustomField.field.name === 'Priority') {
        if (f.value) priority = f.value.name;
      }
    }
    
    const stateColor = getStateColor(state);
    const projectId = issue.id || '';
    const projectShortName = (issue.project && issue.project.shortName) || '';
    
    html += '<div class="task" style="border-left-color: ' + stateColor + '" data-issue-id="' + projectId + '" data-project="' + escapeHtml(projectShortName) + '">';
    html += '<a href="' + config.url + '/issue/' + issue.idReadable + '" target="_blank" class="task-id">' + issue.idReadable + '</a>';
    html += '<div class="task-summary">' + escapeHtml(issue.summary || 'Без названия') + '</div>';
    html += '<div class="task-meta">';
    // Селектор статуса вместо бейджа — позволяет менять статус прямо из виджета
    html += '<select class="state-select" data-current="' + escapeHtml(state) + '" style="--state-color: ' + stateColor + '" title="Изменить статус">';
    html += '<option value="" selected>' + escapeHtml(state) + '</option>';
    html += '</select>';
    if (priority) html += '<span class="badge">' + escapeHtml(priority) + '</span>';
    html += '</div></div>';
  }
  container.innerHTML = html;
  
  attachStateSelectHandlers();
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ---------- Изменение статуса задачи ----------

function getNormalizedBaseUrl() {
  let baseUrl = currentConfig.url.trim();
  if (!baseUrl.startsWith('http://') && !baseUrl.startsWith('https://')) {
    baseUrl = 'https://' + baseUrl;
  }
  return baseUrl.replace(/\/$/, '');
}

function apiFetch(path, options) {
  const url = getNormalizedBaseUrl() + path;
  return fetch(url, Object.assign({
    headers: {
      'Authorization': 'Bearer ' + currentConfig.token,
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    }
  }, options));
}

// Получает список доступных статусов (State) проекта через YouTrack REST API
async function fetchProjectStates(projectShortName) {
  if (statesCache[projectShortName]) return statesCache[projectShortName];

  let values = [];

  // Вариант 1: значения поля State, специфичные для проекта
  try {
    const fields = 'name,project(shortName),perProjectValues(name,number,presentation)';
    const query = encodeURIComponent('project: {' + projectShortName + '} and fieldName: State');
    const response = await apiFetch('/api/customFields?' + query + '&fields=' + fields);

    if (response.ok) {
      const data = await response.json();
      for (const cf of data) {
        const perProject = cf.perProjectValues || [];
        for (const v of perProject) {
          if (v.name && !values.some(x => x.name === v.name)) {
            values.push(v);
          }
        }
      }
    }
  } catch (e) {
    console.warn('Не удалось получить perProjectValues статусов:', e);
  }

  // Вариант 2 (запасной): общие значения EnumBundle Field "State"
  if (values.length === 0) {
    const fields = 'values(name,submittedValue,presentation)';
    const response = await apiFetch('/api/admin/customFields/State' + encodeURIComponent(':') + 'State/values?fields=' + fields);

    if (!response.ok) throw new Error('HTTP ' + response.status);

    const data = await response.json();
    for (const v of (data || [])) {
      const name = v.submittedValue || v.name;
      if (name && !values.some(x => x.name === name)) {
        values.push({ name: name, presentation: v.presentation || name });
      }
    }
  }

  if (values.length === 0) throw new Error('Статусы не найдены');

  statesCache[projectShortName] = values;
  return values;
}

// Подключает обработчики к селектам статусов и подгружает варианты по мере необходимости
function attachStateSelectHandlers() {
  const selects = document.querySelectorAll('.state-select');
  selects.forEach(sel => {
    if (sel.dataset.loaded === '1') return;
    sel.dataset.loaded = '1';
    
    const task = sel.closest('.task');
    const projectShortName = task ? task.dataset.project : '';
    
    // Лениво подгружаем варианты статусов при фокусе/наведении, чтобы не долбить API
    const loadOptions = () => {
      if (sel.dataset.optionsLoaded === '1' || !projectShortName) return;
      sel.dataset.optionsLoaded = '1';
      fetchProjectStates(projectShortName).then(values => {
        const current = sel.dataset.current;
        sel.innerHTML = '';
        for (const v of values) {
          const opt = document.createElement('option');
          opt.value = v.name;
          opt.textContent = v.presentation || v.name;
          if (v.name === current) opt.selected = true;
          sel.appendChild(opt);
        }
        if (!values.some(v => v.name === current)) {
          const opt = document.createElement('option');
          opt.value = current;
          opt.textContent = current;
          opt.selected = true;
          sel.insertBefore(opt, sel.firstChild);
        }
      }).catch(err => {
        console.error('Не удалось загрузить статусы проекта:', err);
        sel.dataset.optionsLoaded = '0';
      });
    };
    
    sel.addEventListener('focus', loadOptions);
    sel.addEventListener('mouseenter', loadOptions);
    sel.addEventListener('change', () => changeIssueState(task, sel));
  });
}

// Отправляет изменение статуса в YouTrack и обновляет локальные данные
async function changeIssueState(task, select) {
  const issueId = task.dataset.issueId;
  const newState = select.value;
  if (!issueId || !newState) return;
  
  select.disabled = true;
  select.classList.add('saving');
  
  try {
    const response = await apiFetch('/api/issues/' + issueId, {
      method: 'POST',
      body: JSON.stringify({
        customFields: [{
          name: 'State',
          value: { name: newState }
        }]
      })
    });
    
    if (!response.ok) {
      let msg = 'HTTP ' + response.status;
      try {
        const errBody = await response.json();
        if (errBody && errBody.detailMessage) msg = errBody.detailMessage;
      } catch (e) { /* ignore */ }
      throw new Error(msg);
    }
    
    // Обновляем локальные данные, чтобы не было рассинхрона с фильтрами
    updateLocalIssueState(issueId, newState);
    
    select.style.setProperty('--state-color', getStateColor(newState));
    select.dataset.current = newState;
    showStatusToast('Статус обновлён: ' + newState, 'success');
    
    // Если текущий фильтр по статусу больше не совпадает — перерисовываем список
    filterAndRender();
    
  } catch (error) {
    console.error('Ошибка изменения статуса:', error);
    showStatusToast('Не удалось изменить статус: ' + error.message, 'error');
    // Возвращаем прежнее значение
    select.value = select.dataset.current;
  } finally {
    select.disabled = false;
    select.classList.remove('saving');
  }
}

function updateLocalIssueState(issueId, newState) {
  for (const issue of allIssues) {
    if (String(issue.id) === String(issueId)) {
      const cf = issue.customFields || [];
      for (const f of cf) {
        if (f.projectCustomField && f.projectCustomField.field && f.projectCustomField.field.name === 'State') {
          f.value = { name: newState };
          return;
        }
      }
      // Статуса не было — добавляем
      cf.push({
        projectCustomField: { field: { name: 'State' } },
        value: { name: newState }
      });
      return;
    }
  }
}

let toastTimer = null;
function showStatusToast(message, type) {
  let toast = document.getElementById('status-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'status-toast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.className = 'toast ' + type + ' visible';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove('visible');
  }, 2500);
}

function getStateColor(state) {
  const colors = {
    'Open': '#95a5a6',
    'In Progress': '#3498db',
    'QA': '#f39c12',
    'To Prod': '#9b59b6',
    'Done': '#27ae60',
    'Closed': '#7f8c8d'
  };
  return colors[state] || '#6c5ce7';
}

function showConfigForm() {
  const container = document.getElementById('tasks-list');
  container.innerHTML = '<div class="task config-form"><h3 style="margin-bottom:12px">Настройка YouTrack</h3><label style="font-size:12px"><b>URL YouTrack</b></label><input type="text" id="cfg-url" placeholder="https://company.youtrack.cloud"><label style="font-size:12px"><b>Permanent Token</b></label><input type="password" id="cfg-token" placeholder="perm:..."><button id="save-config" style="margin-top:12px">Сохранить</button></div>';
  document.getElementById('save-config').addEventListener('click', async () => {
    const url = document.getElementById('cfg-url').value.trim().replace(/\/$/, '');
    const token = document.getElementById('cfg-token').value.trim();
    if (!url || !token) { alert('Заполните оба поля!'); return; }
    await chrome.storage.sync.set({ [CONFIG_KEY]: { url: url, token: token } });
    alert('Сохранено!');
    location.reload();
  });
}