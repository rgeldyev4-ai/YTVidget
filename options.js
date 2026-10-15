const CONFIG_KEY = 'youtrack_config';

document.addEventListener('DOMContentLoaded', async () => {
  const result = await chrome.storage.sync.get([CONFIG_KEY]);
  const config = result[CONFIG_KEY] || { url: '', token: '' };
  document.getElementById('url').value = config.url;
  document.getElementById('token').value = config.token;
});

document.getElementById('save').addEventListener('click', async () => {
  const url = document.getElementById('url').value.trim().replace(/\/$/, '');
  const token = document.getElementById('token').value.trim();
  if (!url || !token) {
    alert('Заполните оба поля!');
    return;
  }
  await chrome.storage.sync.set({ [CONFIG_KEY]: { url, token } });
  document.getElementById('status').textContent = 'Сохранено!';
  setTimeout(() => { document.getElementById('status').textContent = ''; }, 2000);
});