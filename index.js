// tiktok-live-connector v2: новый API (TikTokLiveConnection + WebcastEvent)
const { TikTokLiveConnection, WebcastEvent, ControlEvent } = require('tiktok-live-connector');

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
const tiktokLiveConnection = new TikTokLiveConnection(tiktokUsername, {});

// Хранилище игроков (рейтинг)
const players = new Map(); // ключ: uniqueId, значение: { uniqueId, nickname, profilePictureUrl, score }

// --- Помощники для разбора данных v2 (поля читаем с запасными вариантами) ---

function getUserId(user) {
    if (!user) return 'unknown';
    return String(user.uniqueId || user.displayId || user.userId || user.id || 'unknown');
}

function getAvatarUrl(user) {
    if (!user) return '';
    return user.profilePictureUrl
        || user.profilePicture?.url?.[0]
        || user.avatarThumb?.urlList?.[0]
        || user.avatarMedium?.urlList?.[0]
        || user.avatarLarge?.urlList?.[0]
        || '';
}

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

// --- ПОДКЛЮЧЕНИЕ К ТИКТОКУ (с автоповтором, если эфир еще не начался) ---

const RECONNECT_DELAY_MS = 30000;
let reconnectTimer = null;

function scheduleReconnect() {
    if (reconnectTimer) return;
    console.log(`Повторная попытка через ${RECONNECT_DELAY_MS / 1000} сек...`);
    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connectToTikTok();
    }, RECONNECT_DELAY_MS);
}

function connectToTikTok() {
    tiktokLiveConnection.connect().then(state => {
        console.info(`[УСПЕХ] Подключено к стриму! Room ID: ${state.roomId}`);
    }).catch(err => {
        console.error('[ОШИБКА] Не удалось подключиться к стриму:', err?.message || err);
        scheduleReconnect();
    });
}

tiktokLiveConnection.on(ControlEvent.DISCONNECTED, () => {
    console.log('[ОТКЛЮЧЕНО] Соединение со стримом потеряно');
    scheduleReconnect();
});

tiktokLiveConnection.on(ControlEvent.ERROR, err => {
    console.error('[ОШИБКА СОЕДИНЕНИЯ]', err?.message || err);
});

tiktokLiveConnection.on(WebcastEvent.STREAM_END, () => {
    console.log('[ЭФИР ЗАВЕРШЕН]');
});

connectToTikTok();

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

// --- ТИКТОК СОБЫТИЯ ---

// 1. Зритель написал комментарий
tiktokLiveConnection.on(WebcastEvent.CHAT, data => {
    const userId = getUserId(data.user);
    const comment = data.comment ?? data.content ?? '';
    console.log(`💬 Чат | ${userId}: ${comment}`);
    updatePlayerScore(userId, 5, getAvatarUrl(data.user), data.user?.nickname);
    broadcast('chat_message', { uniqueId: userId, comment });
});

// 2. Лайки
tiktokLiveConnection.on(WebcastEvent.LIKE, data => {
    const userId = getUserId(data.user);
    const likeCount = Number(data.likeCount ?? data.count ?? 1);
    const points = Math.floor(likeCount / 10) || 1;
    updatePlayerScore(userId, points, getAvatarUrl(data.user), data.user?.nickname);
});

// 3. Подарки
tiktokLiveConnection.on(WebcastEvent.GIFT, data => {
    const giftType = data.giftDetails?.giftType ?? data.gift?.type;
    const giftName = data.giftDetails?.giftName ?? data.gift?.name ?? 'подарок';
    const diamondCount = Number(data.giftDetails?.diamondCount ?? data.gift?.diamondCount ?? 0);
    const repeatCount = Number(data.repeatCount || 1);

    // Подарки со стриком (giftType 1) считаем только по завершении серии (repeatEnd)
    const streakInProgress = giftType === 1 && !data.repeatEnd;
    if (streakInProgress) return;

    const userId = getUserId(data.user);
    const nickname = data.user?.nickname;
    const avatarUrl = getAvatarUrl(data.user);
    const totalDiamonds = diamondCount * repeatCount;

    console.log(`🎁 Подарок! ${userId} подарил ${giftName} x${repeatCount} (очки: +${totalDiamonds})`);
    updatePlayerScore(userId, totalDiamonds, avatarUrl, nickname);

    broadcast('gift_alert', {
        uniqueId: userId,
        nickname,
        giftName,
        count: repeatCount,
        avatarUrl
    });
});

// Запуск сервера на порту 3000
const PORT = 3000;
server.listen(PORT, () => {
    console.log(`[СЕРВЕР ЗАПУЩЕН] Открой в браузере или добавь в OBS: http://localhost:${PORT}`);
});
