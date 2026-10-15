const CONFIG_KEY = 'youtrack_config';
const THEME_KEY = 'youtrack_theme';
let currentFilter = 'all';
let allIssues = [];
let currentConfig = null;

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
  const fields = 'id,idReadable,summary,customFields(projectCustomField(field(name)),value(name))';
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
    
    html += '<div class="task" style="border-left-color: ' + stateColor + '">';
    html += '<a href="' + config.url + '/issue/' + issue.idReadable + '" target="_blank" class="task-id">' + issue.idReadable + '</a>';
    html += '<div class="task-summary">' + (issue.summary || 'Без названия') + '</div>';
    html += '<div class="task-meta"><span class="badge" style="background: ' + stateColor + '; color: white">' + state + '</span>';
    if (priority) html += '<span class="badge">' + priority + '</span>';
    html += '</div></div>';
  }
  container.innerHTML = html;
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