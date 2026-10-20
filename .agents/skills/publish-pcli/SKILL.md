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

Отдельного токена и связки ключей нет. Публикация идёт от входа владельца
`chuark@gmail.com` в Azure CLI (`az`, ставится `brew install azure-cli`): вход
лежит в `~/.azure`, короткий токен Marketplace берёт из него
[`mp_token.py`](mp_token.py). Токен не записывай и в чат не выводи.

Если `mp_token.py` пишет `no token`, вход истёк: выполни
`az login --allow-no-subscriptions --use-device-code`, открой владельцу
`https://login.microsoft.com/device`, дай ему код из вывода и дождись входа.

## Публикация

Все команды запускай с актуальным `@vscode/vsce` через `npx --yes
@vscode/vsce@latest`: установленный глобально `vsce` 2.x не годится. Команды
работы в папке расширения выполняй из `pcli-vscode/`.

1. Проверь вход: `T=$(PYTHONPATH=$(ls -d /opt/homebrew/Caskroom/azure-cli/*/libexec/lib/python3*/site-packages | tail -1) python3 ../.agents/skills/publish-pcli/mp_token.py)`
   из `pcli-vscode/`. При `no token` пройди вход из раздела «Токен».
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
5. `npx --yes @vscode/vsce@latest publish --target win32-x64 --skip-license --pat "$T"`
   из `pcli-vscode/`. Перед упаковкой `vscode:prepublish` сам скачивает Pi 1.3.0
   (`fetch-pi.mjs`) и проверяет его SHA256; VSIX получается около 43 МБ.
6. Повтори запрос из шага 2: новая версия появилась. Marketplace проверяет пакет
   несколько минут, до этого версия может не отображаться.

Версию Pi эта процедура не меняет: она закреплена в `fetch-pi.mjs`. Для другой
версии правятся `VERSION`, `URL` и `SHA256` там и выпускается новый VSIX.

Commit и push результата выполняй только по отдельной просьбе.
