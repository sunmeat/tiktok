const tiktokConnector = require('tiktok-live-connector');
// Защита от разницы экспорта между версиями CommonJS и ESM
const WebcastPushConnection = tiktokConnector.WebcastPushConnection || tiktokConnector.default || tiktokConnector;

const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');

// Настройка веб-сервера
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// Раздаем статические файлы из папки public (там будет наша арена)
app.use(express.static(path.join(__dirname, 'public')));

// Укажите ваш никнейм в TikTok (без символа @)
const tiktokUsername = "alex.stream.games";
const tiktokLiveConnection = new WebcastPushConnection(tiktokUsername);

// Хранилище игроков (рейтинг)
const players = new Map(); // ключ: uniqueId, значение: { uniqueId, nickname, profilePictureUrl, score }

// Функция отправки данных всем подключенным веб-клиентам (в OBS)
function broadcast(type, data) {
    const message = JSON.stringify({ type, data });
    wss.clients.forEach(client => {
        if (client.readyState === client.OPEN) {
            client.send(message);
        }
    });
}

// Обработка подключения веб-клиента (OBS)
wss.on('connection', (ws) => {
    console.log('[OBS] Браузерная сцена подключена к серверу');
    // Отправляем текущий рейтинг новичку
    ws.send(JSON.stringify({ type: 'init', data: Array.from(players.values()) }));
});

// --- ТИКТОК СОБЫТИЯ ---

tiktokLiveConnection.connect().then(state => {
    console.info(`[УСПЕХ] Подключено к стриму! Room ID: ${state.roomId}`);
}).catch(err => {
    console.error('[ОШИБКА] Не удалось подключиться к стриму:', err);
});

// Помощник для добавления/обновления игрока
function updatePlayerScore(user, points, avatarUrl, nickname) {
    if (!players.has(user)) {
        players.set(user, {
            uniqueId: user,
            nickname: nickname || user,
            profilePictureUrl: avatarUrl || '',
            score: 0
        });
    }
    const player = players.get(user);
    player.score += points;
    if (avatarUrl) player.profilePictureUrl = avatarUrl;
    if (nickname) player.nickname = nickname;

    // Сортируем игроков по очкам (рейтинг)
    const sortedPlayers = Array.from(players.values()).sort((a, b) => b.score - a.score);

    // Рассылаем обновленный рейтинг на экран
    broadcast('update_leaderboard', sortedPlayers);
}

// 1. Зритель написал комментарий
tiktokLiveConnection.on('chat', data => {
    console.log(`💬 Чат | ${data.uniqueId}: ${data.comment}`);
    updatePlayerScore(data.uniqueId, 5, data.profilePictureUrl, data.nickname);
    broadcast('chat_message', { uniqueId: data.uniqueId, comment: data.comment });
});

// 2. Лайки
tiktokLiveConnection.on('like', data => {
    const points = Math.floor(data.likeCount / 10) || 1;
    updatePlayerScore(data.uniqueId, points, data.profilePictureUrl, data.nickname);
});

// 3. Подарки
tiktokLiveConnection.on('gift', data => {
    if (data.giftType === 1 || !data.repeatEnd) {
        const totalDiamonds = data.diamondCount * data.repeatCount;

        console.log(`🎁 Подарок! ${data.uniqueId} подарил ${data.giftName} (очки: +${totalDiamonds})`);
        updatePlayerScore(data.uniqueId, totalDiamonds, data.profilePictureUrl, data.nickname);

        broadcast('gift_alert', {
            uniqueId: data.uniqueId,
            nickname: data.nickname,
            giftName: data.giftName,
            count: data.repeatCount,
            avatarUrl: data.profilePictureUrl
        });
    }
});

// Запуск сервера на порту 3000
const PORT = 3000;
server.listen(PORT, () => {
    console.log(`[СЕРВЕР ЗАПУЩЕН] Открой в браузере или добавь в OBS: http://localhost:${PORT}`);
});