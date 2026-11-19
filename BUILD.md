# Сборка TMAIL под Windows, macOS и Linux

TMAIL — нативный десктоп-клиент на **Tauri v2** (React/TS фронтенд + Rust
рантайм). Один и тот же код собирается в `.exe` (Windows), `.app`/`.dmg`
(macOS) и AppImage/`.deb` (Linux).

> Этот файл — практическая инструкция. Для автоматической сборки в облаке
> (GitHub Actions) см. `.github/workflows/build.yml` — он делает всё то же
> самое без твоей руки.

---

## 1. Обязательные компоненты (все ОС)

| Компонент | Мин. версия | Зачем |
|---|---|---|
| Rust | stable (1.77.2+, у нас 1.98) | компиляция `src-tauri` |
| Node.js | 20+ (у нас 22) | сборка фронтенда Vite |
| npm | 10+ | установка зависимостей клиента |
| Tauri CLI (`cargo tauri`) | v2 | упаковка приложения |

---

## 2. Установка Rust и toolchain

### Windows
1. Скачай и запусти `rustup-init.exe` с <https://rustup.rs> — установи **stable**.
2. Перезапусти терминал, проверь:
   ```powershell
   rustc --version
   cargo --version
   ```
3. При необходимости добавь `C:\Users\ТЫ\.cargo\bin` в PATH (rustup делает сам).

### macOS
```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"
rustc --version
```
> macOS может попросить установить Xcode Command Line Tools:
> `xcode-select --install`.

### Linux (Ubuntu/Debian)
```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"
sudo apt update
sudo apt install -y libwebkit2gtk-4.1-dev build-essential \
  libappindicator3-dev librsvg2-dev patchelf libssl-dev \
  libayatana-appindicator3-dev \
  libsoup-3.0-dev libjavascriptcoregtk-4.1-dev
```

---

## 3. Установка Node.js

### Windows
Скачай **LTS** с <https://nodejs.org> (setup `.msi`) — установит `node` и `npm`.

### macOS
```bash
brew install node
```

### Linux
```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
```

---

## 4. Установка Tauri CLI

```bash
cargo install tauri-cli --locked
cargo tauri --version
```
> Добавляет команду `cargo tauri`. На Windows также ставит WebView2 (есть в Win 10/11).

---

## 5. Сборка приложения

Из корня **клиента** (`client/`):

```bash
cd client
npm install

# 1) собрать фронтенд для Tauri (относительные пути под tauri://)
npx vite build --config vite.tauri.config.ts

# 2) собрать и упаковать приложение текущей ОС
cargo tauri build
```

### Что создаётся

| ОС | Папка bundle | Файлы |
|---|---|---|
| Windows | `src-tauri/target/release/bundle/` | `nsis/TMAIL_0.1.0_x64-setup.exe`, `msi/TMAIL_0.1.0_x64_en-US.msi`, `TMAIL.exe` |
| macOS | `src-tauri/target/release/bundle/` | `dmg/TMAIL_0.1.0_x64.dmg`, `macos/TMAIL.app`, `mas/*.app` |
| Linux | `src-tauri/target/release/bundle/` | `appimage/*.AppImage`, `deb/*.deb`, `rpm/*.rpm` |

---

## 6. Сборка под другую ОС с одной машины (cross-compile)

Чтобы из Linux получить `.exe` — потребуется дополнительный toolchain
(MSVC/Wine), это муторно. **Рекомендуется** собирать каждую ОС на её
собственной машине — ровно это делает CI, см. ниже.

---

## 7. Автоматическая сборка через GitHub Actions (рекомендуется)

В репо уже лежит `.github/workflows/build.yml`. Он на каждый пуш/тег
собирает Windows (`windows-latest`), macOS (`macos-latest`) и Linux
(`ubuntu-latest`) и кладёт готовые артефакты в **Actions → Run → Artifacts**
(или прикрепляет к GitHub Release при пуш-тега `v*`).

Чтобы подключить:

1. Убедись, что репо на GitHub: `https://github.com/relikiler/tmail`.
2. Запушь файлы (включая `.github/workflows/build.yml` и `client/src-tauri/icons/`).
3. Зайди в **Actions** вкладку — увидишь воркфлоу «Build TMAIL (Windows/macOS/Linux)».
4. Запустить вручную: Actions → workflow → **Run workflow**.

---

## 8. Частые проблемы

### «icons/icon.ico not found» / «icon.icns not found»
Папка `client/src-tauri/icons/` должна содержать `icon.ico` (Windows),
`icon.icns` (macOS) и PNG-иконки. Они уже в репо. Если сгенерировать заново:
```bash
cd client/src-tauri
cargo tauri icon <путь-к-512x512.png>
```

### На Windows — ошибка про MSVC link
Установи **Build Tools for Visual Studio** (C++ workload) с
<https://visualstudio.microsoft.com/visual-cpp-build-tools/> — это нужно
`cargo` для линковки под MSVC.

### Фронтенд не собран / пустой экран в десктопе
Всегда сначала `npm install`, потом `npx vite build --config vite.tauri.config.ts`,
иначе `cargo tauri build` заберёт старый `dist-tauri` или упадёт.

### API не отвечает в десктопе
`client/src/api.ts` для Tauri использует `https://tchainmail.cc/api` — он
прописан в CSP (`tauri.conf.json`). Если меняешь сервер — обнови и там, и в CSP.

---

## 9. Проверка после сборки

- Windows: запусти `TMAIL.exe` → должен открыться интерфейс почты,
  подключение к `tchainmail.cc` и кошелёк.
- macOS: открой `TMAIL.app` (при первом запуске через правый клик → Open,
  т.к. не подписан/не нотаризован).
- Linux: `chmod +x *.AppImage && ./TMAIL....AppImage`.

> Бинари не подписаны кодом (нет сертификатов). Windows/macOS могут
> показывать предупреждение SmartScreen/Gatekeeper — это ожидаемо без
> платной подписи.