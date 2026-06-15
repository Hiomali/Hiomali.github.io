// script.js — интеграция с Google Sheets (синхронизация между всеми пользователями)

(function() {
    // ⚠️ ВСТАВЬТЕ СЮДА ВАШ URL ОТ APPS SCRIPT
    const API_URL = 'https://script.google.com/macros/s/AKfycbwWI2kmemuZg-F9aNFg_IQH10KIEq8Mv3BE0QjZyc38v5fciOBRkl_M-1jF3heyWCSW0A/exec';   // замените на ваш https://script.google.com/macros/s/...

    const USER_ID_KEY = 'ozon_user_id';
    let currentUserId = localStorage.getItem(USER_ID_KEY);
    if (!currentUserId) {
        currentUserId = 'user_' + Date.now() + '_' + Math.random().toString(36).substr(2, 8);
        localStorage.setItem(USER_ID_KEY, currentUserId);
    }

    // DOM элементы
    const form = document.getElementById('suggestionForm');
    const userNameInput = document.getElementById('userName');
    const messageTextarea = document.getElementById('messageText');
    const messagesListDiv = document.getElementById('messagesList');
    const counterBadge = document.getElementById('counterBadge');
    const toastEl = document.getElementById('toastMessage');
    const charCountSpan = document.getElementById('charCount');

    // Модальное окно
    const editModal = document.getElementById('editModal');
    const editTextarea = document.getElementById('editTextarea');
    const saveEditBtn = document.getElementById('saveEditBtn');
    const cancelEditBtn = document.getElementById('cancelEditBtn');
    const modalCloseSpan = document.querySelector('.modal-close');

    let currentEditId = null;
    const MAX_MESSAGE_LEN = 500;

    // --- Вспомогательные ---
    function showToast(text, duration = 2500) {
        if (!toastEl) return;
        toastEl.textContent = text;
        toastEl.classList.remove('hidden');
        setTimeout(() => toastEl.classList.add('hidden'), duration);
    }

    function escapeHtml(str) {
        if (!str) return '';
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function formatDate(timestamp) {
        const date = new Date(timestamp);
        const now = new Date();
        const isToday = date.toDateString() === now.toDateString();
        if (isToday) {
            return `Сегодня в ${date.getHours().toString().padStart(2,'0')}:${date.getMinutes().toString().padStart(2,'0')}`;
        }
        const yesterday = new Date(now);
        yesterday.setDate(now.getDate() - 1);
        if (date.toDateString() === yesterday.toDateString()) {
            return `Вчера в ${date.getHours().toString().padStart(2,'0')}:${date.getMinutes().toString().padStart(2,'0')}`;
        }
        return `${date.getDate()}.${date.getMonth()+1}.${date.getFullYear()} ${date.getHours().toString().padStart(2,'0')}:${date.getMinutes().toString().padStart(2,'0')}`;
    }

    function declension(n, one, two, five) {
        n = Math.abs(n) % 100;
        if (n >= 5 && n <= 20) return five;
        n %= 10;
        if (n === 1) return one;
        if (n >= 2 && n <= 4) return two;
        return five;
    }

    // --- Запросы к API ---
    async function apiCall(action, params = {}) {
        const url = new URL(API_URL);
        url.searchParams.append('action', action);
        for (const [key, val] of Object.entries(params)) {
            url.searchParams.append(key, val);
        }
        try {
            const response = await fetch(url.toString(), { method: 'POST' });
            const json = await response.json();
            if (!json.success) throw new Error(json.error || 'Ошибка сервера');
            return json;
        } catch (err) {
            showToast(`Ошибка: ${err.message}`, 3000);
            throw err;
        }
    }

    // --- Загрузка всех сообщений с сервера ---
    async function loadMessagesFromServer() {
        try {
            const result = await apiCall('getAll');
            return result.data || [];
        } catch (err) {
            console.error(err);
            return [];
        }
    }

    // --- Рендер ---
    async function renderMessages() {
        const allMessages = await loadMessagesFromServer();
        if (!messagesListDiv) return;
        if (allMessages.length === 0) {
            messagesListDiv.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">💭</div>
                    <p>Пока нет ни одной идеи. Станьте первым, кто поможет улучшить ПВЗ!</p>
                </div>
            `;
            if (counterBadge) counterBadge.innerText = '0 предложений';
            return;
        }

        const sorted = [...allMessages].sort((a,b) => b.timestamp - a.timestamp);
        let html = '';
        for (let msg of sorted) {
            const displayName = msg.userName && msg.userName.trim() ? escapeHtml(msg.userName.trim()) : 'Друг Ozon';
            const message = escapeHtml(msg.messageText);
            const formattedDate = formatDate(msg.timestamp);
            const isOwn = (msg.userId === currentUserId);
            const actionsHtml = isOwn ? `
                <div class="message-actions">
                    <button class="edit-btn" data-id="${msg.id}" title="Редактировать">✏️</button>
                    <button class="delete-btn" data-id="${msg.id}" title="Удалить">🗑️</button>
                </div>
            ` : '';

            html += `
                <div class="message-card" data-id="${msg.id}">
                    <div class="message-header">
                        <span class="user-name">${displayName}</span>
                        <span class="message-date">${formattedDate}</span>
                    </div>
                    <div class="message-text">${message}</div>
                    ${actionsHtml}
                </div>
            `;
        }
        messagesListDiv.innerHTML = html;
        if (counterBadge) {
            const count = allMessages.length;
            counterBadge.innerText = `${count} ${declension(count, 'предложение', 'предложения', 'предложений')}`;
        }

        // Обработчики для кнопок редактирования/удаления
        document.querySelectorAll('.edit-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = parseInt(btn.getAttribute('data-id'));
                openEditModal(id);
            });
        });
        document.querySelectorAll('.delete-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const id = parseInt(btn.getAttribute('data-id'));
                await deleteSuggestion(id);
            });
        });
    }

    // --- Добавить предложение ---
    async function addSuggestion(userName, messageText) {
        if (!messageText || messageText.trim() === '') {
            showToast('❌ Напишите ваше предложение!', 1800);
            return false;
        }
        if (messageText.length > MAX_MESSAGE_LEN) {
            showToast(`❗ Максимум ${MAX_MESSAGE_LEN} символов`, 2200);
            return false;
        }
        try {
            await apiCall('add', {
                userName: userName || '',
                messageText: messageText.trim(),
                userId: currentUserId
            });
            await renderMessages(); // перезагрузка
            return true;
        } catch (err) {
            return false;
        }
    }

    // --- Удалить ---
    async function deleteSuggestion(id) {
        if (!confirm('Удалить это предложение?')) return;
        try {
            await apiCall('delete', { id: id, userId: currentUserId });
            await renderMessages();
            showToast('Предложение удалено', 1500);
        } catch (err) {
            showToast('Не удалось удалить: ' + err.message, 2500);
        }
    }

    // --- Редактирование ---
    async function openEditModal(id) {
        const all = await loadMessagesFromServer();
        const msg = all.find(m => m.id == id);
        if (!msg) {
            showToast('Сообщение не найдено', 1500);
            return;
        }
        if (msg.userId !== currentUserId) {
            showToast('Вы можете редактировать только свои предложения', 2000);
            return;
        }
        currentEditId = id;
        editTextarea.value = msg.messageText;
        editModal.classList.remove('hidden');
    }

    async function saveEdit() {
        if (currentEditId === null) return;
        const newText = editTextarea.value.trim();
        if (newText === '') {
            showToast('Текст не может быть пустым', 1500);
            return;
        }
        if (newText.length > MAX_MESSAGE_LEN) {
            showToast(`Максимум ${MAX_MESSAGE_LEN} символов`, 1500);
            return;
        }
        try {
            await apiCall('update', {
                id: currentEditId,
                messageText: newText,
                userId: currentUserId
            });
            await renderMessages();
            showToast('Предложение обновлено!', 1500);
            closeEditModal();
        } catch (err) {
            showToast('Ошибка: ' + err.message, 2500);
        }
    }

    function closeEditModal() {
        editModal.classList.add('hidden');
        currentEditId = null;
        editTextarea.value = '';
    }

    // --- Обработчики формы ---
    async function onFormSubmit(e) {
        e.preventDefault();
        const userName = userNameInput.value;
        const message = messageTextarea.value;
        const success = await addSuggestion(userName, message);
        if (success) {
            messageTextarea.value = '';
            userNameInput.value = '';
            updateCharCounter();
            messageTextarea.focus();
            showToast('✨ Спасибо! Ваша идея добавлена');
        }
    }

    function updateCharCounter() {
        if (charCountSpan) {
            const len = messageTextarea.value.length;
            charCountSpan.innerText = len;
            charCountSpan.style.color = len > MAX_MESSAGE_LEN ? '#e03a3a' : '#7e95a8';
        }
    }

    function enforceMaxLength(e) {
        if (e.target === messageTextarea && e.target.value.length > MAX_MESSAGE_LEN) {
            e.target.value = e.target.value.slice(0, MAX_MESSAGE_LEN);
            updateCharCounter();
        }
    }

    // --- Инициализация ---
    async function init() {
        await renderMessages();
        form.addEventListener('submit', onFormSubmit);
        messageTextarea.addEventListener('input', updateCharCounter);
        messageTextarea.addEventListener('input', enforceMaxLength);
        updateCharCounter();

        saveEditBtn.addEventListener('click', saveEdit);
        cancelEditBtn.addEventListener('click', closeEditModal);
        modalCloseSpan.addEventListener('click', closeEditModal);
        window.addEventListener('click', (e) => {
            if (e.target === editModal) closeEditModal();
        });
    }

    init();
})();