# IzzyOnDroid — информация о приложении TMAIL

Этот файл — полный комплект данных для оценки и публикации приложения.
Проект открытый (MIT), исходники в этом репозитории.

## Общие сведения

| Поле | Значение |
|---|---|
| **Приложение** | TMAIL — E2E-Encrypted Web3 Email |
| **Package ID** | `io.tmail.app` |
| **Версия (первая)** | 0.1.0 |
| **Version code** | 1 |
| **Licence** | MIT |
| **Repos [source]** | `https://github.com/relikiler/tmail` |
| **Min SDK** | 24 (Android 7.0) |
| **Target SDK** | 36 |
| **Compile SDK** | 36 |
| **Фреймворк** | Tauri v2 (Rust + WebView) |
| **Категория** | Communications · Privacy · Web3 |

## Краткое описание (Summary)

TMAIL — децентрализованная почта с end-to-end шифрованием. Сервер —
«слепой курьер»: он видит только `from/to/ts/size`, но не темы, тела писем
или ключи. Крипто: X25519 + AES-256-GCM, ed25519. Вход: пароль, MetaMask,
WalletConnect. Blockchain: Polygon (подписки и immutable-лог).

## Сборка

См. раздел README «Android — сборка APK». Кратко:

```
cd client
npm install
npx vite build --config vite.tauri.config.ts
export ANDROID_HOME=/path/to/android-sdk
export JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64
cargo tauri android build --apk --target aarch64
```

**Важно:** приложение использует Rust/Tauri. Это означает, что для сборки
APK нужен полный Rust-тулчейн + NDK. Стандартные F-Droid/Izzy билд-сервисы,
которые запускают только Gradle без Rust, не могут собрать проект из исходников.
Поэтому приложение распространяется **готовым подписанным APK** в GitHub
Releases (тег `v0.1.0`) + по прямым ссылкам.

## Подпись и опубликованные артефакты

- **Keystore:** релизный `tmail-release.keystore`, alias `tmail` (не в git, хранится у автора).
- **APK (arm64):** `TMAIL-arm64-v0.1.0.apk` (8.4 MB) — в GitHub Releases.
- **SHA-256:** `e22c585225f058e35ae054928539ee0075ad5a48ab671440a45e02557eb93ce0`

## Разрешения (манифест)

- `INTERNET` — сеть
- `USE_BIOMETRIC` — разблокировка ключей
- `POST_NOTIFICATIONS` — уведомления о новых письмах (запроса у user)

Лишних разрешений (NFC и др.) нет.

## Безопасность

- Приватные ключи X25519/ed25519 хранятся в **sessionStorage** web-обёртки
  (очищаются при закрытии приложения), не на диске.
- Серверная часть не содержит ключей (крипта — только на клиенте).
- CSP настроен (см. tauri.conf.json): только собственный origin + нужные
  API (WalletConnect, IPFS gateway, Polygon RPC).

## Дополнительно

- Декларируемая модель: freemium (Free 7 писем/день → Premium/Pro/Pass).
- Токен: TMAIL ERC-20 (Polygon).
- Gрид-кошелёк (если понадобится): `0x96a5488B4C9a95841F412a8fA7CdEBa0caD03E94`.