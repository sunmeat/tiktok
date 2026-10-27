
import 'dotenv/config';

import {
    TikTokLiveConnection,
    WebcastEvent,
    ControlEvent
} from 'tiktok-live-connector';

import express from 'express';
import http from 'node:http';
import { WebSocketServer } from 'ws';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Настройка веб-сервера
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.static(path.join(__dirname, 'public')));

// Никнейм TikTok без символа @
const tiktokUsername = 'neversleep.420';

// Подключение к TikTok с API-ключом EulerStream из .env
const tiktokLiveConnection = new TikTokLiveConnection(tiktokUsername, {
    signApiKey: process.env.SIGN_API_KEY
});

// Хранилище игроков
const players = new Map();

// Настройки повторного подключения
const DEFAULT_RECONNECT_DELAY_MS = 30000;
let reconnectTimer = null;
let isConnecting = false;
let isConnected = false;

// Получение идентификатора пользователя
function getUserId(user) {
    if (!user) return 'unknown';

    return String(
        user.uniqueId ||
        user.displayId ||
        user.userId ||
        user.id ||
        'unknown'
    );
}

// Получение аватарки пользователя
function getAvatarUrl(user) {
    if (!user) return '';

    return (
        user.profilePictureUrl ||
        user.profilePicture?.url?.[0] ||
        user.avatarThumb?.urlList?.[0] ||
        user.avatarMedium?.urlList?.[0] ||
        user.avatarLarge?.urlList?.[0] ||
        ''
    );
}

// Отправка события подключённым браузерам и OBS
function broadcast(type, data) {
    const message = JSON.stringify({ type, data });

    wss.clients.forEach(client => {
        if (client.readyState === client.OPEN) {
            client.send(message);
        }
    });
}

// Подключение браузерной сцены
wss.on('connection', ws => {
    console.log('[OBS] Браузерная сцена подключена');

    ws.send(JSON.stringify({
        type: 'init',
        data: Array.from(players.values()).sort(
            (a, b) => b.score - a.score
        )
    }));
});

// Добавление игрока и обновление его статистики
function updatePlayerScore(userId, points, avatarUrl, nickname, activity = {}) {
    if (!players.has(userId)) {
        players.set(userId, {
            uniqueId: userId,
            nickname: nickname || userId,
            profilePictureUrl: avatarUrl || '',
            score: 0,
            likes: 0,
            comments: 0,
            gifts: 0,
            isFollowing: false
        });
    }

    const player = players.get(userId);

    player.score += points;

    if (avatarUrl) {
        player.profilePictureUrl = avatarUrl;
    }

    if (nickname) {
        player.nickname = nickname;
    }

    if (activity.likes) {
        player.likes += activity.likes;
    }

    if (activity.comments) {
        player.comments += activity.comments;
    }

    if (activity.gifts) {
        player.gifts += activity.gifts;
    }

    if (activity.isFollowing) {
        player.isFollowing = true;
    }

    const sortedPlayers = Array.from(players.values()).sort(
        (a, b) => b.score - a.score
    );

    broadcast('update_leaderboard', sortedPlayers);
}

// Планирование повторного подключения
function scheduleReconnect(delayMs = DEFAULT_RECONNECT_DELAY_MS) {
    if (reconnectTimer) return;

    const safeDelay = Math.max(1000, delayMs);

    console.log(
        `[ПОДКЛЮЧЕНИЕ] Следующая попытка через ${Math.ceil(safeDelay / 1000)} сек.`
    );

    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connectToTikTok();
    }, safeDelay);
}

// Подключение к TikTok
function connectToTikTok() {
    if (isConnecting || isConnected) return;

    isConnecting = true;

    tiktokLiveConnection.connect()
        .then(state => {
            isConnected = true;

            console.log(
                `[УСПЕХ] Подключено к стриму! Room ID: ${state.roomId}`
            );
        })
        .catch(err => {
            const message = err?.message || String(err);

            console.error('[ОШИБКА] Не удалось подключиться:', message);

            // При наличии retryAfter учитываем задержку сервиса.
            // Значение retryAfter у этой ошибки передаётся в миллисекундах.
            const retryAfter = Number(err?.retryAfter);

            const delay = Number.isFinite(retryAfter) && retryAfter > 0
                ? retryAfter
                : DEFAULT_RECONNECT_DELAY_MS;

            scheduleReconnect(delay);
        })
        .finally(() => {
            isConnecting = false;
        });
}

// Обработка отключения
tiktokLiveConnection.on(ControlEvent.DISCONNECTED, () => {
    console.log('[ОТКЛЮЧЕНО] Соединение со стримом потеряно');

    isConnected = false;
    scheduleReconnect();
});

// Обработка ошибок соединения
tiktokLiveConnection.on(ControlEvent.ERROR, err => {
    console.error(
        '[ОШИБКА СОЕДИНЕНИЯ]',
        err?.message || err
    );
});

// Завершение эфира
tiktokLiveConnection.on(WebcastEvent.STREAM_END, () => {
    console.log('[ЭФИР ЗАВЕРШЁН]');

    isConnected = false;
});

// 1. Комментарии
tiktokLiveConnection.on(WebcastEvent.CHAT, data => {
    const userId = getUserId(data.user);
    const nickname = data.user?.nickname || userId;
    const avatarUrl = getAvatarUrl(data.user);
    const comment = data.comment ?? data.content ?? '';

    console.log(`💬 Чат | ${nickname}: ${comment}`);

    updatePlayerScore(
        userId,
        5,
        avatarUrl,
        nickname,
        { comments: 1 }
    );

    broadcast('chat_message', {
        uniqueId: userId,
        nickname,
        avatarUrl,
        comment
    });
});

// 2. Лайки
tiktokLiveConnection.on(WebcastEvent.LIKE, data => {
    const userId = getUserId(data.user);
    const nickname = data.user?.nickname || userId;
    const avatarUrl = getAvatarUrl(data.user);

    const likeCount = Math.max(
        1,
        Number(data.likeCount ?? data.count ?? 1) || 1
    );

    const points = Math.max(1, Math.floor(likeCount / 10));

    updatePlayerScore(
        userId,
        points,
        avatarUrl,
        nickname,
        { likes: likeCount }
    );
});

// 3. Новые подписки
if (WebcastEvent.FOLLOW) {
    tiktokLiveConnection.on(WebcastEvent.FOLLOW, data => {
        const userId = getUserId(data.user);
        const nickname = data.user?.nickname || userId;
        const avatarUrl = getAvatarUrl(data.user);

        updatePlayerScore(
            userId,
            0,
            avatarUrl,
            nickname,
            { isFollowing: true }
        );

        console.log(`⭐ Новая подписка: ${nickname}`);
    });
}

// 4. Подарки
tiktokLiveConnection.on(WebcastEvent.GIFT, data => {
    const giftType = data.giftDetails?.giftType ?? data.gift?.type;
    const giftName =
        data.giftDetails?.giftName ??
        data.gift?.name ??
        'подарок';

    const diamondCount = Number(
        data.giftDetails?.diamondCount ??
        data.gift?.diamondCount ??
        0
    );

    const repeatCount = Math.max(
        1,
        Number(data.repeatCount || 1)
    );

    // Подарки со стриком учитываем после завершения серии
    const streakInProgress = giftType === 1 && !data.repeatEnd;

    if (streakInProgress) return;

    const userId = getUserId(data.user);
    const nickname = data.user?.nickname || userId;
    const avatarUrl = getAvatarUrl(data.user);
    const totalDiamonds = diamondCount * repeatCount;

    console.log(
        `🎁 ${nickname}: ${giftName} x${repeatCount} (+${totalDiamonds} очков)`
    );

    updatePlayerScore(
        userId,
        totalDiamonds,
        avatarUrl,
        nickname,
        { gifts: repeatCount }
    );

    broadcast('gift_alert', {
        uniqueId: userId,
        nickname,
        giftName,
        count: repeatCount,
        avatarUrl
    });
});

// Запуск сервера
const PORT = 3000;

server.listen(PORT, () => {
    console.log(
        `[СЕРВЕР ЗАПУЩЕН] Открой в браузере или добавь в OBS: http://localhost:${PORT}`
    );

    if (!process.env.SIGN_API_KEY) {
        console.warn(
            '[ПРЕДУПРЕЖДЕНИЕ] SIGN_API_KEY не найден в .env'
        );
    }

    connectToTikTok();
});
