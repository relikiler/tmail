# TMAIL — E2E-Encrypted Web3 Email

**Почтовое отделение, которое не вскрывает конверты.**

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

| Контракт | Адрес | Статус |
|---|---|---|
| TokenMail (TMAIL) | `0xE683F5Cb2dFB9abb6D0d460B3E49AE760903e4fA` | deployed |
| Mailbox | `0xe8a2827db1fe0667aaa659a148645a409217f3d6` | deployed |
| MailLog | `0x6ae7773F5B9DDB4DF32DA753f820F3D7F08d0691` | verified |
| LifetimePass | `0x2313D8c92D99240E34138419bC03b01769863039` | verified |

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

## Лицензия

MIT