// Режим подключения: true — свой эфир, false — поиск чужого.
export const USE_MY_STREAM = false;

// Ник для собственного эфира.
export const MY_TIKTOK_USERNAME = "alex.stream.games";

// Ищем эфир с числом зрителей примерно в этом диапазоне.
export const TARGET_VIEWERS = 10;
export const VIEWER_COUNT_TOLERANCE = 5;

// Кандидаты для поиска. Добавь сюда ники без символа @.
// Сервер проверит, кто из них сейчас в эфире и ближе к TARGET_VIEWERS.
// Пустые строки игнорируются.
export const DISCOVERY_USERNAMES = [
  // "streamer_username",
];

// Интервал между повторными проходами по списку, миллисекунды.
export const DISCOVERY_RETRY_MS = 60_000;

// Пауза между проверками аккаунтов, чтобы не отправлять много запросов подряд.
export const DISCOVERY_CHECK_DELAY_MS = 2_000;
