# TMAIL — E2E-Encrypted Web3 Email

**Почтовое отделение, которое не вскрывает конверты.**

> 🔗 **Репозиторий:** <https://github.com/relikiler/tmail>

TMAIL — это нативный децентрализованный почтовый клиент с шифрованием
end-to-end. Сервер — *«слепой курьер»*: он видит только `from/to/ts/size`,
но никогда не видит темы, тела писем или ключи.

## Стек

| Слой | Технология |
|---|---|
| Blockchain | Polygon PoS (chainId 137) |
| Токен | TMAIL (ERC-20), подписки через Mailbox |
| Immutable-лог | MailLog (хеш `keccak256` зашифрованного тела + CID) |
| Lifetime Pass | LifetimePass (ERC-721, 390 вечных пассов, роялти 7.5%) |
| Хранилище вложений | IPFS (Pinata pinning) |
| Крипто | X25519 + AES-256-GCM, ed25519 подпись (клиентская) |
| Сервер | Node.js, Fastify, SQLite (WAL), Caddy |
| Клиент | React + Vite (web), Tauri v2 + Rust (desktop/Android) |

## Модель безопасности

- **E2E:** приватные ключи никогда не покидают устройство. Пароль не
  хранится на сервере (Argon2id → ключ → AES-обёртка).
- **Сервер «слепой курьер»:** видит только метаданные, не контент.
- **Восстановление:** никнейм + ed25519 recovery-ключ (QR / бумага).
  Потеря ключа+пароля = потеря писем (свойство E2E).

## Контракты (Polygon mainnet)

| Контракт | Адрес | Статус | Polygonscan |
|---|---|---|---|
| TokenMail (TMAIL) | `0xE683F5Cb2dFB9abb6D0d460B3E49AE760903e4fA` | deployed | [view](https://polygonscan.com/token/0xE683F5Cb2dFB9abb6D0d460B3E49AE760903e4fA) |
| Mailbox | `0xe8a2827db1fe0667aaa659a148645a409217f3d6` | deployed | [view](https://polygonscan.com/address/0xe8a2827db1fe0667aaa659a148645a409217f3d6) |
| MailLog | `0x6ae7773F5B9DDB4DF32DA753f820F3D7F08d0691` | verified | [view](https://polygonscan.com/address/0x6ae7773F5B9DDB4DF32DA753f820F3D7F08d0691) |
| LifetimePass | `0x2313D8c92D99240E34138419bC03b01769863039` | verified | [view](https://polygonscan.com/address/0x2313D8c92D99240E34138419bC03b01769863039) |

## Структура репозитория

```
server/src/     — Fastify API («слепой курьер»), SQLite, IPFS upload
contracts/      — Solidity: TokenMail, Mailbox, MailLog, LifetimePass
client/src/     — React + Vite web-клиент (6 языков)
landing/        — лендинг
```

## Запуск сервера

```bash
cd server
npm install
PINATA_JWT=<your-key> npm start   # экспорт в env, не коммитить
```

## Поддержка / Гранты

Проект развивается на открытых началах и финансируется грантами экосистем
Polygon и Filecoin/IPFS. Пожертвования и грантовая поддержка принимаются на
кошелёк (USDC / совместимые сети, 22 networks):

```
0x96a5488B4C9a95841F412a8fA7CdEBa0caD03E94
```

ENS: `senbazuru.uni.eth`

## Android — сборка APK (Tauri)

Требования: Rust, Android SDK (compileSdk 36), JDK 21, cargo-tauri.

```bash
cd client
npm install
# собрать фронтенд под Tauri
npx vite build --config vite.tauri.config.ts
# собрать APK (arm64)
export ANDROID_HOME=/path/to/android-sdk
export JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64
cargo tauri android build --apk --target aarch64
```

Результат: `client/src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-arm64-v8a-release.apk`.

**Подпись:** release-подпись через `tmail-release.keystore` (alias `tmail`).
**Версия (min):** Android 7.0 (minSdk 24), 64-bit arm64.

Готовый APK публикуется в GitHub Releases: `https://github.com/relikiler/tmail/releases`.

## Публикация

- **GitHub Releases:** подписанный APK + SHA-256 (см. тег `v0.1.0`).
- **Прямые ссылки:** лендинг `/downloads/`.
- Текущий процесс нацелен на прозрачную автономную дистрибуцию
  (из-за Rust/Tauri-сборки юзеры чаще ставят APK из релизов, чем через
  F-Droid-билд-серверы, не собирающие Rust).

## Лицензия

MIT
## Архитектурные оговорки (transparency)

Проект честно позиционируется как **централизованный E2E-сервис** на этом этапе
развития (MVP), а не полностью децентрализованная сеть:

- **Один сервер-«слепой курьер»** + одна SQLite (`server/src/db.js`). Сервер
  хранит только метаданные (`from/to/ts/size`) и зашифрованные блобы; контент и
  ключи он прочитать не может **технически**.
- **IPFS только для вложений**, pinning через Pinata (единственный внешний
  провайдер на текущем этапе). Полная децентрализация хранения (собственные
  ноды / Filecoin deals) — на роадмапе.
- **Лимиты (Free 7/день, хранилище 5/10/100 МБ) проверяются на сервере**
  (`server/src/index.js`), а не в смарт-контракте. Это осознанное решение для
  MVP: on-chain-проверка каждой отправки заметно дороже и добавляла бы задержки.
  Учёт `userMailsSent` в `Mailbox.sol` заложен для будущего переноса лимитов в сеть.
- **Cleanup** (`server/src/cleanup.js`): Free-письма «протухают» через 90 дней без
  входа и удаляются через 180; Premium/Pro живут, пока активна подписка + 90 дней.
  Это политика хранения и приватности — описанная и предсказуемая, не скрытая.
- **CORS ограничен** разрешёнными origin (лендинг/приложение), `/api/upload`
  требует зарегистрированный адрес отправителя.

E2E-криптография (Argon2id → обёртка ключей, X25519+HKDK-SHA256 → AES-256-GCM,
ed25519-подпись над шифротекстом) работает на клиенте и не зависит от доверия к
серверу.
