---
name: publish-pcli
description: "Опубликовать новую версию расширения arqawa.pcli (ARQAWA PCLI, pcli-vscode/) в Visual Studio Marketplace по прямой просьбе выпустить или опубликовать его."
---

# Публикация ARQAWA PCLI

Триггер: прямая просьба выпустить или опубликовать новую версию расширения
`arqawa.pcli`. Обычная правка `pcli-vscode/` публикацию не запускает.
Устройство расширения описано в [AGENTS.md](../../../AGENTS.md), решения в
разделе PCLI файла [DECISIONS.md](../../../DECISIONS.md). Описания в Marketplace
быть не должно: не добавляй `description` в `package.json`, README и LICENSE в
папку расширения.

## Токен

Токен лежит в связке ключей macOS (login keychain), куда его один раз кладёт
`vsce login arqawa`. В репозитории, файлах и чате его нет; не проси его в чат и
не записывай. Если токена нет или он истёк, остановись и попроси владельца
повторить шаги ниже. Токен живёт не дольше года.

1. Войти на `https://dev.azure.com` под той же учётной записью Microsoft, что у
   издателя `arqawa`; при первом входе создать организацию с предложенными
   значениями.
2. Справа вверху открыть User settings → Personal access tokens → New Token.
3. Name: `vsce`; Organization: `All accessible organizations`; Expiration: до
   года; Scopes: Custom defined → Show all scopes → Marketplace → Manage.
4. Create и скопировать токен.
5. В терминале Mac выполнить `npx --yes @vscode/vsce@latest login arqawa` и
   вставить токен по запросу.

## Публикация

Все команды запускай с актуальным `@vscode/vsce` через `npx --yes
@vscode/vsce@latest`: установленный глобально `vsce` 2.x не годится. Команды
работы в папке расширения выполняй из `pcli-vscode/`.

1. `npx --yes @vscode/vsce@latest verify-pat arqawa`. При ошибке остановись:
   токена нет, он истёк или у него нет права Marketplace → Manage.
2. Узнай последнюю опубликованную версию:
   `curl -fsS -X POST 'https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery' -H 'Content-Type: application/json' -H 'Accept: application/json;api-version=7.1-preview.1' -d '{"filters":[{"criteria":[{"filterType":7,"value":"arqawa.pcli"}]}],"flags":950}'`;
   версии лежат в `results[0].extensions[0].versions[].version`. Если
   расширения ещё нет, ответ пустой: это первая публикация.
3. Подними `version` в `pcli-vscode/package.json` выше опубликованной
   (патч-версия, если не заказано другое): Marketplace не принимает повтор.
4. Проверь, что workflow `pcli` зелёный на ветке, из которой публикуешь:
   `gh run list --workflow pcli.yml --branch <ветка> --limit 1`. Если запуска
   нет или он красный, запусти `gh workflow run pcli.yml --ref <ветка>`, дождись
   результата и не публикуй при красном. Если менялся `extension.js`, выполни
   ещё `node --check extension.js` из `pcli-vscode/`.
5. `npx --yes @vscode/vsce@latest publish --target win32-x64 --skip-license`
   из `pcli-vscode/`. Перед упаковкой `vscode:prepublish` сам скачивает Pi 1.3.0
   (`fetch-pi.mjs`) и проверяет его SHA256; VSIX получается около 43 МБ.
   Токен vsce берёт из связки ключей сам.
6. Повтори запрос из шага 2: новая версия появилась. Marketplace проверяет пакет
   несколько минут, до этого версия может не отображаться.

Версию Pi эта процедура не меняет: она закреплена в `fetch-pi.mjs`. Для другой
версии правятся `VERSION`, `URL` и `SHA256` там и выпускается новый VSIX.

Commit и push результата выполняй только по отдельной просьбе.
