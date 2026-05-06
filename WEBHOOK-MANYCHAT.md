# Webhook ManyChat → CRM

Guia completo de como o webhook funciona, como testar local, configurar no ManyChat e publicar na Vercel.

## Arquitetura em uma linha

```
ManyChat (External Request POST) ──► /api/webhook ──► lib/db.js ──► database.json
                                                                          │
                       page.js ─── GET /api/students ◄──────────────────┘
```

- **`src/app/api/webhook/route.js`** — recebe POST do ManyChat, extrai nome/telefone/tag, chama `addStudent()`.
- **`src/app/api/students/route.js`** — GET que retorna a lista atual (lido pelo frontend a cada 60s).
- **`src/lib/db.js`** — abstrai o storage. Hoje grava em `database.json`. Tem bloco comentado pra trocar pra Vercel KV (Redis).

## 1. Testar localmente

```bash
npm install
npm run dev
```

Em outro terminal, simula o ManyChat:

```bash
curl -X POST http://localhost:3000/api/webhook \
  -H "Content-Type: application/json" \
  -d '{"name":"João da Silva","phone":"5511999991111","tag":"7 dias"}'
```

Resposta esperada: `{"ok":true,"student":{...}}`. Abra `http://localhost:3000` — em até 60s o aluno aparece na coluna "CHAMAR 7 dias".

Health check da rota: `GET http://localhost:3000/api/webhook` retorna `{"ok":true,"hint":"..."}`.

## 2. Configurar no ManyChat

Dentro de uma automação que dispara quando você quiser cadastrar o aluno (ex: depois da venda):

1. Adicione um **Action** → **External Request**.
2. **Method**: `POST`
3. **URL**: `https://SEU-DOMINIO-VERCEL.vercel.app/api/webhook` (rodando local: usar ngrok pra expor — `ngrok http 3000`).
4. **Headers**: `Content-Type: application/json`
5. **Body** (JSON):

```json
{
  "name": "{{full_name}}",
  "phone": "{{phone}}",
  "tag": "7 dias"
}
```

Os `{{...}}` são User Fields do ManyChat — substitua pelos campos correspondentes do contato. Pra "Tag de Tempo", você pode:
- **Hardcodar**: `"tag": "7 dias"` (se essa automação SEMPRE manda pra coluna de 7 dias)
- **Variável**: `"tag": "{{custom_tag_field}}"` (se você tem um Custom Field pra escolher dinâmico)

**Tags aceitas**: `"3 dias"`, `"7 dias"`, `"15 dias"`, `"30 dias"` (ou só o número — o webhook normaliza).

Campos opcionais que o webhook aceita:
- `seller`: nome do vendedor responsável
- `observations`: observação inicial

## 3. Publicar na Vercel

Pré-requisito: o código tem que estar no GitHub. Se ainda não tá:

```bash
git add .
git commit -m "Add webhook + storage abstraction"
git push origin main
```

Na Vercel:

1. Acessa https://vercel.com → **Add New** → **Project** → seleciona o repo `ghs0697-svg/CRM`.
2. Framework Preset: **Next.js** (auto-detecta).
3. Não precisa configurar nada extra. Clica **Deploy**.
4. Em ~1 min tu tem uma URL `https://crm-app-XXXX.vercel.app`.

Volta no ManyChat e troca a URL do External Request pra essa nova.

## 4. ⚠️ Storage em produção (CRÍTICO)

**`database.json` no filesystem NÃO funciona em serverless** (Vercel/Netlify/etc):
- Filesystem é read-only fora de `/tmp`.
- `/tmp` zera entre invocações (cold start).
- Cada região/instância tem `/tmp` próprio.

→ Em produção, o webhook vai aceitar a chamada e responder OK pro ManyChat, mas **os dados vão sumir** ao próximo cold start.

### Solução: Vercel KV (free tier 30k commands/mês)

Setup leva 2 minutos:

```bash
npm install @vercel/kv
```

No dashboard da Vercel:
1. Project → **Storage** → **Create Database** → **KV (Redis)**
2. Conecta no projeto. Variáveis de ambiente (`KV_URL`, `KV_REST_API_URL`, `KV_REST_API_TOKEN`, `KV_REST_API_READ_ONLY_TOKEN`) entram automaticamente.

No `src/lib/db.js`, descomenta o bloco KV (já tá lá pronto):

```js
import { kv } from "@vercel/kv";
const KEY = "crm:students";
const useKV = !!process.env.KV_REST_API_URL;

async function readKV() { return (await kv.get(KEY)) || []; }
async function writeKV(list) { await kv.set(KEY, list); }
```

E nas funções `getStudents` / `addStudent`, descomenta as 2 linhas `if (useKV)` que já estão lá.

Em **dev local**, sem as env vars, automaticamente usa filesystem (`database.json`). Em **prod** com env vars setadas, usa KV. Zero mudança em outros arquivos.

### Alternativa: Upstash Redis

Se preferir não amarrar a Vercel: https://upstash.com — free tier 10k commands/dia, mesma API do `@upstash/redis`. Funciona em qualquer host.

## 5. Debug

- **Webhook não recebeu**: testa o GET `/api/webhook` — se retorna `{ok:true}`, a rota tá no ar.
- **ManyChat manda mas não aparece**: olha **Vercel → Project → Logs** pra ver o request. O webhook loga erros via `console.error`.
- **Aluno aparece duplicado**: o `useEffect` da page mergeia por `id` e por `phone` (digits). Se vier o mesmo `phone` que já existe local, é ignorado.
- **Quero forçar reingestão**: no DevTools console, `localStorage.removeItem("crm-ingested-server-ids")` → recarrega a página.

## 6. Formato do payload aceito

O webhook é tolerante a variações de nome de campo. Aceita:

```json
{ "name": "...", "phone": "...", "tag": "7 dias" }
{ "Nome Completo": "...", "Telefone": "...", "Tag de Tempo": "7 dias" }
{ "full_name": "...", "whatsapp": "...", "time_tag": "7" }
```

Tag aceita: `"3 dias"`, `"7"`, `"15 days"`, `"30"` — qualquer string com um número entre 1–30 vira a tag mais próxima do conjunto fixo.
